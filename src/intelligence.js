const { DEFAULT_TOLERANCE_BPS } = require('./destinations');

function clampScore(score) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function rawToBigInt(value) {
  if (value === null || value === undefined || value === '') return null;
  try {
    return BigInt(value.toString());
  } catch (_err) {
    return null;
  }
}

function amountDriftBps(sourceRaw, destinationRaw) {
  const source = rawToBigInt(sourceRaw);
  const destination = rawToBigInt(destinationRaw);

  if (source === null || destination === null) return null;
  if (source === 0n && destination === 0n) return 0;
  if (source === 0n || destination === 0n) return 10000;

  const delta = source > destination ? source - destination : destination - source;
  const scaled = (delta * 1_000_000n) / source;
  return Number(scaled) / 100;
}

function compareRawAmounts(label, sourceRaw, destinationRaw, toleranceBps = DEFAULT_TOLERANCE_BPS, formatted = {}) {
  const driftBps = amountDriftBps(sourceRaw, destinationRaw);
  const status = driftBps === null ? 'UNKNOWN' : driftBps <= toleranceBps ? 'PASS' : 'FAIL';

  return {
    label,
    status,
    sourceRaw: sourceRaw ?? null,
    destinationRaw: destinationRaw ?? null,
    sourceValue: formatted.sourceValue ?? null,
    destinationValue: formatted.destinationValue ?? null,
    driftBps,
    toleranceBps,
  };
}

function issue(severity, code, message) {
  return { severity, code, message };
}

function summarizeState(state) {
  if (!state) return null;
  return {
    exists: Boolean(state.exists),
    codeSize: state.codeSize || 0,
    tokenName: state.tokenName || null,
    tokenSymbol: state.tokenSymbol || null,
    decimals: state.decimals ?? null,
    totalSupply: state.totalSupply || null,
    totalSupplyRaw: state.totalSupplyRaw || null,
    isERC20: Boolean(state.isERC20),
    isERC4626: Boolean(state.isERC4626),
    underlyingAsset: state.underlyingAsset || null,
    totalAssets: state.totalAssets || null,
    totalAssetsRaw: state.totalAssetsRaw || null,
    errors: state.errors || [],
  };
}

function evaluateDestination({
  target,
  sourceChainId = null,
  sourceState,
  destinationState,
  sourceWalletPosition = null,
  destinationWalletPosition = null,
  ccipLane = null,
  blockNumber = 0,
  readError = null,
}) {
  const issues = [];
  const comparisons = [];
  const toleranceBps = target.toleranceBps ?? DEFAULT_TOLERANCE_BPS;
  const isSourceChainSelfCheck =
    sourceChainId !== null && Number(target.chainId) === Number(sourceChainId);

  if (readError) {
    issues.push(issue('high', 'destination_read_failed', readError));
    return {
      target,
      status: 'UNKNOWN',
      blockNumber,
      lane: ccipLane,
      state: summarizeState(destinationState),
      walletPosition: destinationWalletPosition,
      comparisons,
      issues,
    };
  }

  if (!destinationState || !destinationState.exists) {
    issues.push(issue('critical', 'destination_contract_missing', 'No contract code was found on the destination address'));
  }

  if (target.ccipSelector) {
    if (!ccipLane) {
      issues.push(issue('medium', 'ccip_lane_not_checked', 'CCIP lane was not checked'));
    } else if (ccipLane.error) {
      issues.push(issue('medium', 'ccip_lane_error', `CCIP lane check failed: ${ccipLane.error}`));
    } else if (!ccipLane.supported) {
      issues.push(issue('critical', 'ccip_lane_unsupported', 'Pharos CCIP router has no on-ramp for this destination selector'));
    }
  } else if (!isSourceChainSelfCheck) {
    issues.push(issue('medium', 'ccip_selector_missing', 'Destination has no CCIP chain selector, so lane support cannot be proven'));
  }

  if (sourceState?.totalSupplyRaw && destinationState?.totalSupplyRaw) {
    comparisons.push(
      compareRawAmounts('totalSupply', sourceState.totalSupplyRaw, destinationState.totalSupplyRaw, toleranceBps, {
        sourceValue: sourceState.totalSupply,
        destinationValue: destinationState.totalSupply,
      })
    );
  } else {
    issues.push(issue('medium', 'total_supply_unavailable', 'Total supply could not be compared on both chains'));
  }

  if (sourceState?.totalAssetsRaw || destinationState?.totalAssetsRaw) {
    if (sourceState?.totalAssetsRaw && destinationState?.totalAssetsRaw) {
      comparisons.push(
        compareRawAmounts('totalAssets', sourceState.totalAssetsRaw, destinationState.totalAssetsRaw, toleranceBps, {
          sourceValue: sourceState.totalAssets,
          destinationValue: destinationState.totalAssets,
        })
      );
    } else {
      issues.push(issue('medium', 'total_assets_unavailable', 'ERC-4626 total assets are not available on both chains'));
    }
  }

  if (sourceWalletPosition || destinationWalletPosition) {
    if (sourceWalletPosition?.balanceRaw && destinationWalletPosition?.balanceRaw && !destinationWalletPosition.error) {
      comparisons.push(
        compareRawAmounts('walletBalance', sourceWalletPosition.balanceRaw, destinationWalletPosition.balanceRaw, toleranceBps, {
          sourceValue: sourceWalletPosition.balance,
          destinationValue: destinationWalletPosition.balance,
        })
      );
    } else {
      issues.push(issue('medium', 'wallet_balance_unavailable', 'Wallet balance could not be compared on both chains'));
    }
  }

  for (const comparison of comparisons) {
    if (comparison.status === 'FAIL') {
      issues.push(
        issue(
          'critical',
          `${comparison.label}_drift_exceeded`,
          `${comparison.label} drift is ${comparison.driftBps} bps, above the ${comparison.toleranceBps} bps tolerance`
        )
      );
    } else if (comparison.status === 'UNKNOWN') {
      issues.push(issue('medium', `${comparison.label}_drift_unknown`, `${comparison.label} drift could not be calculated`));
    }
  }

  for (const err of destinationState?.errors || []) {
    issues.push(issue('medium', 'destination_warning', err));
  }

  const hasCritical = issues.some((item) => item.severity === 'critical');
  const hasWarnings = issues.length > 0 || comparisons.length === 0;

  return {
    target,
    status: hasCritical ? 'DESYNC' : hasWarnings ? 'PARTIAL' : 'SYNCED',
    blockNumber,
    lane: ccipLane,
    state: summarizeState(destinationState),
    walletPosition: destinationWalletPosition,
    comparisons,
    issues,
  };
}

function buildCheck(id, label, status, severity, evidence = {}) {
  return { id, label, status, severity, evidence };
}

function buildIntelligence({
  distribution,
  ccipResult,
  vaultState,
  destinationResults = [],
  diagnosticsErrors = [],
  hasConfiguredDestinations = false,
}) {
  const checks = [];

  checks.push(
    buildCheck(
      'source_contract_exists',
      'Canonical Pharos contract exists',
      vaultState.exists ? 'PASS' : 'FAIL',
      'critical',
      { codeSize: vaultState.codeSize || 0 }
    )
  );

  checks.push(
    buildCheck(
      'ccip_router_reachable',
      'Pharos CCIP router is reachable',
      ccipResult.reachable ? 'PASS' : 'FAIL',
      'critical',
      { address: ccipResult.address, typeAndVersion: ccipResult.typeAndVersion || null }
    )
  );

  if (!hasConfiguredDestinations) {
    checks.push(
      buildCheck(
        'destination_coverage',
        'Cross-chain destinations configured',
        'WARN',
        'medium',
        { configuredDestinations: 0 }
      )
    );
  }

  for (const destination of destinationResults) {
    checks.push(
      buildCheck(
        `destination_${destination.target.id}`,
        `${destination.target.name} destination status`,
        destination.status === 'SYNCED' ? 'PASS' : destination.status === 'DESYNC' ? 'FAIL' : 'WARN',
        destination.status === 'DESYNC' ? 'critical' : 'medium',
        {
          chainId: destination.target.chainId,
          address: destination.target.address,
          status: destination.status,
          comparisons: destination.comparisons,
          issues: destination.issues,
        }
      )
    );
  }

  let score = 100;
  if (!vaultState.exists) score -= 45;
  if (!ccipResult.reachable) score -= 30;
  if (!hasConfiguredDestinations) score -= 20;
  if (distribution.syncStatus === 'DESYNC') score -= 25;
  if (distribution.syncStatus === 'UNKNOWN') score -= 35;
  if (distribution.syncStatus === 'PARTIAL') score -= 10;

  for (const destination of destinationResults) {
    if (destination.status === 'DESYNC') score -= 30;
    else if (destination.status === 'UNKNOWN') score -= 22;
    else if (destination.status === 'PARTIAL') score -= 12;
  }

  score -= Math.min(20, diagnosticsErrors.length * 3);

  const confidenceScore = clampScore(score);
  const failedChecks = checks.filter((check) => check.status === 'FAIL');
  const warningChecks = checks.filter((check) => check.status === 'WARN');
  const riskFlags = [
    ...failedChecks.map((check) => ({
      severity: check.severity,
      code: check.id,
      message: check.label,
    })),
    ...warningChecks.map((check) => ({
      severity: check.severity,
      code: check.id,
      message: check.label,
    })),
  ];

  const verdict =
    failedChecks.some((check) => check.severity === 'critical') || confidenceScore < 55
      ? 'STOP'
      : confidenceScore < 85 || warningChecks.length > 0
        ? 'CAUTION'
        : 'GO';

  const riskLevel = verdict === 'GO' ? 'LOW' : verdict === 'CAUTION' ? 'MEDIUM' : 'HIGH';
  const recommendations = [];

  if (!vaultState.exists) {
    recommendations.push('Do not treat this address as a canonical RWA vault until deployed code is present on Pharos.');
  }
  if (!ccipResult.reachable) {
    recommendations.push('Pause cross-chain distribution decisions until the Pharos CCIP router can be verified.');
  }
  if (!hasConfiguredDestinations) {
    recommendations.push('Configure destination chain RPCs, vault addresses, and CCIP selectors to produce a true cross-chain proof.');
  }
  if (destinationResults.some((destination) => destination.status === 'DESYNC')) {
    recommendations.push('Pause automated capital movement and investigate destination drift before distribution.');
  }
  if (destinationResults.some((destination) => destination.status === 'PARTIAL' || destination.status === 'UNKNOWN')) {
    recommendations.push('Treat the result as advisory and resolve unknown destination reads or missing lane metadata.');
  }
  if (recommendations.length === 0) {
    recommendations.push('Proceed with read-only confidence; all configured checks are within tolerance.');
  }

  const summary =
    verdict === 'GO'
      ? 'All configured oracle checks passed within tolerance.'
      : verdict === 'CAUTION'
        ? 'The oracle found usable evidence but coverage or warnings require human review.'
        : 'The oracle found a critical integrity issue and recommends stopping automated distribution.';

  return {
    verdict,
    confidenceScore,
    riskLevel,
    summary,
    checks,
    riskFlags,
    recommendations,
  };
}

module.exports = {
  amountDriftBps,
  compareRawAmounts,
  evaluateDestination,
  buildIntelligence,
};
