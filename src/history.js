const fs = require('fs');
const path = require('path');

const DEFAULT_HISTORY_PATH = '.oracle-history.jsonl';

function resolveHistoryPath(options = {}) {
  return path.resolve(
    process.cwd(),
    options.historyPath || process.env.ORACLE_HISTORY_PATH || DEFAULT_HISTORY_PATH
  );
}

function compactSnapshot(result) {
  return {
    timestamp: result.timestamp,
    vault: result.vault,
    chainId: result.network.chainId,
    blockNumber: result.diagnostics.blockNumber,
    verdict: result.intelligence.verdict,
    confidenceScore: result.intelligence.confidenceScore,
    syncStatus: result.distribution.syncStatus,
    coverage: result.distribution.coverage,
    tokenSymbol: result.vault_state.tokenSymbol,
    codeSize: result.vault_state.codeSize,
    totalSupplyRaw: result.proof.source.state.totalSupplyRaw,
    totalAssetsRaw: result.proof.source.state.totalAssetsRaw,
    routerOwner: result.ccipRouter.owner,
    proofHash: result.passport?.proofHash || null,
    destinationStatuses: (result.crossChain.destinations || []).map((destination) => ({
      id: destination.id,
      chainId: destination.chainId,
      status: destination.status,
      blockNumber: destination.blockNumber,
      comparisons: destination.comparisons,
    })),
  };
}

function readHistory(options = {}) {
  const historyPath = resolveHistoryPath(options);
  if (!fs.existsSync(historyPath)) return [];

  const maxEntries = options.maxEntries || 500;

  const entries = fs
    .readFileSync(historyPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_err) {
        return null;
      }
    })
    .filter(Boolean);

  // Return only the most recent entries to prevent OOM on large history files
  return entries.length > maxEntries
    ? entries.slice(entries.length - maxEntries)
    : entries;
}

function appendHistory(result, options = {}) {
  if (options.recordHistory === false) return null;

  const historyPath = resolveHistoryPath(options);
  const dir = path.dirname(historyPath);
  fs.mkdirSync(dir, { recursive: true });
  const snapshot = compactSnapshot(result);
  fs.appendFileSync(historyPath, `${JSON.stringify(snapshot)}\n`);
  return { path: historyPath, snapshot };
}

function findVaultHistory(vault, chainId, options = {}) {
  return readHistory(options)
    .filter(
      (entry) =>
        entry.vault?.toLowerCase() === vault.toLowerCase() &&
        Number(entry.chainId) === Number(chainId)
    )
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function latestBeforeCurrent(history, currentTimestamp) {
  const currentMs = Date.parse(currentTimestamp);
  return [...history].reverse().find((entry) => Date.parse(entry.timestamp) < currentMs) || null;
}

function summarizeHistory(result, options = {}) {
  const history = findVaultHistory(result.vault, result.network.chainId, options);
  const previous = latestBeforeCurrent(history, result.timestamp);
  return {
    enabled: options.recordHistory !== false,
    sampleCount: history.length,
    previous,
    trend: previous
      ? {
          previousVerdict: previous.verdict,
          previousConfidenceScore: previous.confidenceScore,
          confidenceDelta: result.intelligence.confidenceScore - previous.confidenceScore,
          previousSyncStatus: previous.syncStatus,
          previousBlockNumber: previous.blockNumber,
          blocksSincePrevious:
            result.diagnostics.blockNumber && previous.blockNumber
              ? result.diagnostics.blockNumber - previous.blockNumber
              : null,
        }
      : null,
  };
}

module.exports = {
  DEFAULT_HISTORY_PATH,
  resolveHistoryPath,
  compactSnapshot,
  readHistory,
  appendHistory,
  findVaultHistory,
  summarizeHistory,
};
