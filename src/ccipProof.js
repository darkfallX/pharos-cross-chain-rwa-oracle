const { withRetry, withTimeout } = require('./retry');

function includesMessageId(log, messageId) {
  if (!messageId) return false;
  const needle = messageId.toLowerCase().replace(/^0x/, '');
  return (
    log.transactionHash?.toLowerCase().includes(needle) ||
    log.data?.toLowerCase().includes(needle) ||
    (log.topics || []).some((topic) => topic.toLowerCase().includes(needle))
  );
}

async function findSourceTransactionEvidence(client, sourceTx, messageId) {
  if (!sourceTx) return null;

  try {
    const receipt = await withRetry(
      () =>
        withTimeout(
          () => client.getTransactionReceipt({ hash: sourceTx }),
          10_000,
          'ccip-source-tx-receipt'
        ),
      { retries: 1, label: 'ccip-source-tx-receipt' }
    );

    const matchingLogs = messageId
      ? receipt.logs.filter((log) => includesMessageId(log, messageId))
      : receipt.logs;

    return {
      status: matchingLogs.length > 0 ? 'FOUND' : 'NOT_FOUND',
      sourceTx,
      blockNumber: Number(receipt.blockNumber),
      logCount: receipt.logs.length,
      matchingLogCount: matchingLogs.length,
      transactionStatus: receipt.status,
    };
  } catch (err) {
    return {
      status: 'UNAVAILABLE',
      sourceTx,
      error: err.message,
    };
  }
}

async function scanLaneLogs(client, destination, latestBlock, options = {}) {
  const onRampAddress = destination.lane?.onRampAddress;

  if (!onRampAddress) {
    return {
      destinationId: destination.id,
      status: 'SKIPPED',
      reason: 'No on-ramp address available for this destination',
    };
  }

  const lookbackBlocks = BigInt(options.lookbackBlocks || 2000);
  const toBlock = BigInt(latestBlock || 0);
  const fromBlock = toBlock > lookbackBlocks ? toBlock - lookbackBlocks : 0n;

  try {
    const logs = await withRetry(
      () =>
        withTimeout(
          () =>
            client.getLogs({
              address: onRampAddress,
              fromBlock,
              toBlock,
            }),
          15_000,
          `${destination.id}-ccip-log-scan`
        ),
      { retries: 1, label: `${destination.id}-ccip-log-scan` }
    );

    const matchingLogs = options.messageId
      ? logs.filter((log) => includesMessageId(log, options.messageId))
      : [];

    return {
      destinationId: destination.id,
      status: options.messageId
        ? matchingLogs.length > 0
          ? 'FOUND'
          : 'NOT_FOUND'
        : logs.length > 0
          ? 'ACTIVITY_FOUND'
          : 'NO_RECENT_ACTIVITY',
      onRampAddress,
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
      logCount: logs.length,
      matchingLogCount: matchingLogs.length,
      sampleTxHashes: logs.slice(0, 3).map((log) => log.transactionHash),
    };
  } catch (err) {
    return {
      destinationId: destination.id,
      status: 'UNAVAILABLE',
      onRampAddress,
      error: err.message,
    };
  }
}

async function buildCCIPMessageProof({
  client,
  latestBlock,
  destinations = [],
  sourceTx = null,
  messageId = null,
  lookbackBlocks = 2000,
}) {
  const sourceTxEvidence = await findSourceTransactionEvidence(
    client,
    sourceTx,
    messageId
  );

  const laneScans = await Promise.all(
    destinations.map((destination) =>
      scanLaneLogs(client, destination, latestBlock, {
        messageId,
        lookbackBlocks,
      })
    )
  );

  const foundEvidence =
    sourceTxEvidence?.status === 'FOUND' ||
    laneScans.some((scan) => scan.status === 'FOUND' || scan.status === 'ACTIVITY_FOUND');

  const unavailable = laneScans.every((scan) => scan.status === 'SKIPPED') && !sourceTxEvidence;

  return {
    status: foundEvidence ? 'PROVEN' : unavailable ? 'UNAVAILABLE' : 'NOT_FOUND',
    messageId,
    sourceTx,
    lookbackBlocks,
    sourceTxEvidence,
    laneScans,
    note:
      messageId || sourceTx
        ? 'CCIP proof searched for user-provided message/transaction evidence.'
        : 'No message id or source transaction was provided; proof is limited to recent lane activity.',
  };
}

module.exports = { buildCCIPMessageProof, includesMessageId };
