
const {
  createPharosClient,
  createFallbackClient,
  createReadOnlyClient,
  verifyCCIPRouter,
  checkCCIPDestination,
} = require('./ccip');
const { readVaultState, readWalletPosition } = require('./vault');
const { CHAINS, CCIP_ROUTER_ADDRESS } = require('./chains');
const { withRetry, withTimeout } = require('./retry');
const { resolveDestinationTargets, DEFAULT_TOLERANCE_BPS } = require('./destinations');
const { evaluateDestination, buildIntelligence } = require('./intelligence');
const { buildCCIPMessageProof } = require('./ccipProof');
const { createPassport } = require('./proof');
const { summarizeHistory, appendHistory } = require('./history');
const { detectAnomalies, detectProxy, checkPausedState, readOwner } = require('./anomalies');
const { buildAgentPlan } = require('./planner');

const SKILL_META = {
  skill: 'pharos-cross-chain-rwa-distribution-oracle',
  version: '2.0.0',
};

function assessSyncStatus(ccipResult, vaultState) {
  const pharosCanonical = vaultState.exists;
  const ccipVerified = ccipResult.reachable;

  let syncStatus = 'UNKNOWN';

  if (pharosCanonical && ccipVerified) {
    const hasErrors =
      vaultState.errors.length > 0 || ccipResult.errors.length > 0;
    syncStatus = hasErrors ? 'PARTIAL' : 'SYNCED';
  } else if (pharosCanonical && !ccipVerified) {
    syncStatus = 'DESYNC';
  } else if (!pharosCanonical && ccipVerified) {
    syncStatus = 'DESYNC';
  } else {
    syncStatus = 'UNKNOWN';
  }

  return { syncStatus, pharosCanonical, ccipVerified };
}

function applyDestinationSyncStatus(baseDistribution, destinationResults) {
  if (!destinationResults || destinationResults.length === 0) {
    return baseDistribution;
  }

  if (
    baseDistribution.syncStatus === 'DESYNC' ||
    baseDistribution.syncStatus === 'UNKNOWN'
  ) {
    return baseDistribution;
  }

  if (destinationResults.some((destination) => destination.status === 'DESYNC')) {
    return { ...baseDistribution, syncStatus: 'DESYNC' };
  }

  if (
    destinationResults.some(
      (destination) =>
        destination.status === 'PARTIAL' || destination.status === 'UNKNOWN'
    )
  ) {
    return { ...baseDistribution, syncStatus: 'PARTIAL' };
  }

  return { ...baseDistribution, syncStatus: 'SYNCED' };
}

async function runDestinationCheck({
  target,
  sourceClient,
  sourceChainId = null,
  sourceState,
  walletAddress,
  sourceWalletPosition,
}) {
  let destinationClient;

  try {
    destinationClient = createReadOnlyClient({
      id: target.chainId,
      name: target.name,
      rpc: target.rpc,
      nativeCurrency: target.nativeCurrency,
      blockExplorer: target.blockExplorer,
    });
  } catch (err) {
    return evaluateDestination({
      target,
      sourceState,
      readError: err.message,
    });
  }

  const blockPromise = withRetry(
    () =>
      withTimeout(
        () => destinationClient.getBlockNumber(),
        10_000,
        `${target.id}-getBlockNumber`
      ),
    { retries: 1, label: `${target.id}-getBlockNumber` }
  );

  const statePromise = readVaultState(destinationClient, target.address);
  const lanePromise = target.ccipSelector
    ? checkCCIPDestination(sourceClient, BigInt(target.ccipSelector))
    : Promise.resolve(null);

  const [blockResult, stateResult, laneResult] = await Promise.allSettled([
    blockPromise,
    statePromise,
    lanePromise,
  ]);

  const blockNumber =
    blockResult.status === 'fulfilled' ? Number(blockResult.value) : 0;
  const destinationState =
    stateResult.status === 'fulfilled' ? stateResult.value : null;
  const ccipLane =
    laneResult.status === 'fulfilled'
      ? laneResult.value
      : {
          destChainSelector: target.ccipSelector,
          supported: false,
          onRampAddress: null,
          error: laneResult.reason?.message || 'CCIP lane check failed',
        };
  const readError =
    stateResult.status === 'rejected' ? stateResult.reason.message : null;

  let destinationWalletPosition = null;
  if (walletAddress && destinationState?.exists) {
    try {
      destinationWalletPosition = await readWalletPosition(
        destinationClient,
        target.address,
        walletAddress
      );
    } catch (err) {
      destinationWalletPosition = {
        wallet: walletAddress,
        vaultAddress: target.address,
        balance: '0',
        balanceRaw: '0',
        decimals: destinationState.decimals ?? 18,
        error: err.message,
      };
    }
  }

  return evaluateDestination({
    target,
    sourceChainId,
    sourceState,
    destinationState,
    sourceWalletPosition,
    destinationWalletPosition,
    ccipLane,
    blockNumber,
    readError,
  });
}

async function runOracle(vaultAddress, options = {}) {
  const startTime = Date.now();
  const errors = [];
  const toleranceBps =
    options.toleranceBps !== undefined &&
    Number.isFinite(Number(options.toleranceBps)) &&
    Number(options.toleranceBps) >= 0
      ? Number(options.toleranceBps)
      : DEFAULT_TOLERANCE_BPS;
  const destinationTargets = resolveDestinationTargets({
    destinationSource: options.destinationSource,
    destinations: options.destinations,
    vaultAddress,
    toleranceBps,
  });

  let client;
  let networkInfo;

  if (options.useFallback) {
    client = createFallbackClient();
    networkInfo = {
      name: CHAINS.pharosTestnet.name,
      chainId: CHAINS.pharosTestnet.id,
      rpc: process.env.PHAROS_TESTNET_RPC_URL || CHAINS.pharosTestnet.rpc,
    };
  } else {
    client = createPharosClient(options.rpcUrl);
    networkInfo = {
      name: CHAINS.pharosMainnet.name,
      chainId: CHAINS.pharosMainnet.id,
      rpc: options.rpcUrl || process.env.PHAROS_RPC_URL || CHAINS.pharosMainnet.rpc,
    };
  }

  let blockNumber = 0;
  try {
    blockNumber = await withRetry(
      () =>
        withTimeout(
          () => client.getBlockNumber(),
          10_000,
          'getBlockNumber'
        ),
      { retries: 2, label: 'getBlockNumber' }
    );
    blockNumber = Number(blockNumber);
  } catch (err) {
    errors.push(`Block number fetch failed: ${err.message}`);

    // If mainnet fails, try fallback
    if (!options.useFallback) {
      try {
        client = createFallbackClient();
        networkInfo = {
          name: CHAINS.pharosTestnet.name,
          chainId: CHAINS.pharosTestnet.id,
          rpc:
            process.env.PHAROS_TESTNET_RPC_URL || CHAINS.pharosTestnet.rpc,
        };
        blockNumber = Number(
          await withTimeout(
            () => client.getBlockNumber(),
            10_000,
            'getBlockNumber-fallback'
          )
        );
        errors.push('Fell back to Pharos Atlantic Testnet');
      } catch (fallbackErr) {
        errors.push(`Fallback also failed: ${fallbackErr.message}`);
      }
    }
  }

  const [ccipResult, vaultState] = await Promise.all([
    verifyCCIPRouter(client).catch((err) => ({
      address: CCIP_ROUTER_ADDRESS,
      reachable: false,
      typeAndVersion: null,
      owner: null,
      codeSize: 0,
      errors: [`CCIP verification error: ${err.message}`],
    })),
    readVaultState(client, vaultAddress).catch((err) => ({
      address: vaultAddress,
      exists: false,
      codeSize: 0,
      balance: '0',
      errors: [`Vault read error: ${err.message}`],
    })),
  ]);

  let walletPosition = null;
  if (options.walletAddress && vaultState.exists) {
    try {
      walletPosition = await readWalletPosition(
        client,
        vaultAddress,
        options.walletAddress
      );
    } catch (err) {
      errors.push(`Wallet position read failed: ${err.message}`);
    }
  }

  let proxyInfo = null;
  let pauseInfo = null;
  let ownerInfo = null;

  if (vaultState.exists) {
    const [proxyResult, pauseResult, ownerResult] = await Promise.allSettled([
      detectProxy(client, vaultAddress),
      checkPausedState(client, vaultAddress),
      readOwner(client, vaultAddress),
    ]);

    proxyInfo = {
      isProxy: false,
      implementationAddress: null,
    };
    if (proxyResult.status === 'fulfilled' && proxyResult.value) {
      proxyInfo.isProxy = true;
      proxyInfo.implementationAddress = proxyResult.value;
    }

    pauseInfo = pauseResult.status === 'fulfilled'
      ? pauseResult.value
      : { hasPausable: false, isPaused: false };

    const ownerAddr = ownerResult.status === 'fulfilled' ? ownerResult.value : null;
    ownerInfo = { owner: ownerAddr, ownerCodeSize: 0 };
    if (ownerAddr && ownerAddr !== '0x0000000000000000000000000000000000000000') {
      try {
        const ownerCode = await client.getCode({ address: ownerAddr });
        ownerInfo.ownerCodeSize = ownerCode && ownerCode !== '0x'
          ? Math.floor((ownerCode.length - 2) / 2)
          : 0;
      } catch (_err) {
        // non-fatal
      }
    }
  }

  const destinationResults = destinationTargets.length > 0
    ? await Promise.all(
        destinationTargets.map((target) =>
          runDestinationCheck({
            target,
            sourceClient: client,
            sourceChainId: networkInfo.chainId,
            sourceState: vaultState,
            walletAddress: options.walletAddress,
            sourceWalletPosition: walletPosition,
          })
        )
      )
    : [];

  const baseDistribution = assessSyncStatus(ccipResult, vaultState);
  const distribution = applyDestinationSyncStatus(baseDistribution, destinationResults);
  const now = new Date().toISOString();
  distribution.lastChecked = now;
  distribution.destinationCount = destinationResults.length;
  distribution.syncedDestinationCount = destinationResults.filter(
    (destination) => destination.status === 'SYNCED'
  ).length;
  distribution.coverage = (() => {
    if (destinationResults.length === 0) return 'PHAROS_SOURCE_ONLY';
    const hasTrueCrossChain = destinationResults.some(
      (d) => Number(d.target.chainId) !== Number(networkInfo.chainId)
    );
    return hasTrueCrossChain ? 'CROSS_CHAIN' : 'PHAROS_SELF_CHECK';
  })();

  const destinationIssues = destinationResults.flatMap((destination) =>
    destination.issues.map(
      (item) =>
        `${destination.target.name}: ${item.severity.toUpperCase()} ${item.code} - ${item.message}`
    )
  );

  const allErrors = [
    ...errors,
    ...ccipResult.errors,
    ...(vaultState.errors || []),
    ...destinationIssues,
  ];

  const rpcLatencyMs = Date.now() - startTime;

  const intelligence = buildIntelligence({
    distribution,
    ccipResult,
    vaultState,
    destinationResults,
    diagnosticsErrors: allErrors,
    hasConfiguredDestinations: destinationTargets.length > 0,
  });

  const serializedDestinations = destinationResults.map((destination) => ({
    id: destination.target.id,
    name: destination.target.name,
    chainId: destination.target.chainId,
    rpc: destination.target.rpc,
    address: destination.target.address,
    ccipSelector: destination.target.ccipSelector,
    status: destination.status,
    blockNumber: destination.blockNumber,
    lane: destination.lane,
    state: destination.state,
    walletPosition: destination.walletPosition,
    comparisons: destination.comparisons,
    issues: destination.issues,
  }));

  const ccipMessageProof = await buildCCIPMessageProof({
    client,
    latestBlock: blockNumber,
    destinations: serializedDestinations,
    sourceTx: options.sourceTx || null,
    messageId: options.messageId || null,
    lookbackBlocks: options.ccipLookbackBlocks || 2000,
  });

  const result = {
    ...SKILL_META,
    timestamp: now,
    vault: vaultAddress,
    network: networkInfo,
    ccipRouter: {
      address: ccipResult.address,
      reachable: ccipResult.reachable,
      typeAndVersion: ccipResult.typeAndVersion || null,
      owner: ccipResult.owner || null,
      codeSize: ccipResult.codeSize || 0,
    },
    vault_state: {
      exists: vaultState.exists,
      codeSize: vaultState.codeSize || 0,
      balance: vaultState.balance || '0',
      tokenName: vaultState.tokenName || null,
      tokenSymbol: vaultState.tokenSymbol || null,
      totalSupply: vaultState.totalSupply || null,
      decimals: vaultState.decimals ?? null,
      isERC20: vaultState.isERC20 || false,
      isERC4626: vaultState.isERC4626 || false,
      underlyingAsset: vaultState.underlyingAsset || null,
      totalAssets: vaultState.totalAssets || null,
    },
    distribution,
    intelligence,
    crossChain: {
      enabled: destinationTargets.length > 0,
      targetCount: destinationTargets.length,
      syncedTargetCount: distribution.syncedDestinationCount,
      destinations: serializedDestinations,
    },
    proof: {
      generatedAt: now,
      toleranceBps,
      source: {
        network: networkInfo,
        blockNumber,
        vault: vaultAddress,
        ccipRouter: {
          address: ccipResult.address,
          reachable: ccipResult.reachable,
          typeAndVersion: ccipResult.typeAndVersion || null,
          owner: ccipResult.owner || null,
          codeSize: ccipResult.codeSize || 0,
        },
        state: {
          exists: vaultState.exists,
          codeSize: vaultState.codeSize || 0,
          tokenSymbol: vaultState.tokenSymbol || null,
          decimals: vaultState.decimals ?? null,
          totalSupplyRaw: vaultState.totalSupplyRaw || null,
          totalAssetsRaw: vaultState.totalAssetsRaw || null,
        },
        walletPosition: walletPosition || null,
      },
      destinations: serializedDestinations.map((destination) => ({
        id: destination.id,
        name: destination.name,
        chainId: destination.chainId,
        address: destination.address,
        ccipSelector: destination.ccipSelector,
        blockNumber: destination.blockNumber,
        status: destination.status,
        lane: destination.lane,
        comparisons: destination.comparisons,
        issues: destination.issues,
      })),
      ccipMessageProof,
    },
    walletPosition: walletPosition || undefined,
    securityAnalysis: {
      proxy: proxyInfo || { isProxy: false, implementationAddress: null },
      pausable: pauseInfo || { hasPausable: false, isPaused: false },
      ownership: ownerInfo || { owner: null, ownerCodeSize: 0 },
    },
    diagnostics: {
      rpcLatencyMs,
      blockNumber,
      errors: allErrors,
    },
  };

  if (!result.walletPosition) {
    delete result.walletPosition;
  }

  result._proxyInfo = proxyInfo;
  result._pauseInfo = pauseInfo;
  result._ownerInfo = ownerInfo;

  result.history = summarizeHistory(result, options);
  result.anomalies = detectAnomalies(result, result.history);

  delete result._proxyInfo;
  delete result._pauseInfo;
  delete result._ownerInfo;

  const severeAnomalies = result.anomalies.filter((item) =>
    ['critical', 'high'].includes(item.severity)
  );

  if (severeAnomalies.length > 0) {
    result.intelligence.verdict = 'STOP';
    result.intelligence.riskLevel = 'HIGH';
    result.intelligence.confidenceScore = Math.min(
      result.intelligence.confidenceScore,
      50
    );
    result.intelligence.summary =
      'The oracle found a severe historical or structural anomaly and recommends stopping automated distribution.';
    result.intelligence.riskFlags.push(
      ...severeAnomalies.map((item) => ({
        severity: item.severity,
        code: item.code,
        message: item.message,
      }))
    );
  }

  result.agentPlan = buildAgentPlan(result);
  result.passport = createPassport(result);

  const historyWrite = appendHistory(result, options);
  result.history.recorded = Boolean(historyWrite);
  result.history.path = historyWrite?.path || null;

  return result;
}

module.exports = {
  runOracle,
  assessSyncStatus,
  applyDestinationSyncStatus,
  runDestinationCheck,
  SKILL_META,
};
