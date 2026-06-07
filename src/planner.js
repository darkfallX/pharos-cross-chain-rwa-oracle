function determineUrgency(verdict, anomalies) {
  const criticalAnomalies = anomalies.filter(
    (a) => a.severity === 'critical'
  );
  if (verdict === 'STOP' || criticalAnomalies.length > 0) return 'IMMEDIATE';
  if (verdict === 'CAUTION') return 'WITHIN_1H';
  return 'ROUTINE';
}

function suggestRerunInterval(verdict, confidence) {
  if (verdict === 'STOP') return '30s';
  if (verdict === 'CAUTION' && confidence < 70) return '60s';
  if (verdict === 'CAUTION') return '120s';
  if (confidence >= 95) return '300s';
  return '180s';
}

function buildContextualSteps(result) {
  const steps = [];
  const checks = result.intelligence?.checks || [];
  const destinations = result.crossChain?.destinations || [];
  const anomalies = result.anomalies || [];


  if (!result.vault_state?.exists) {
    steps.push('Verify the vault address is correct and the contract has been deployed on Pharos.');
  }


  if (!result.ccipRouter?.reachable) {
    steps.push('Pause cross-chain operations — the CCIP router is unreachable. Try again with a different RPC endpoint.');
  }


  if (anomalies.some((a) => a.code === 'contract_paused')) {
    steps.push('The vault contract is currently paused. Wait for the owner to unpause before any distribution action.');
  }


  if (anomalies.some((a) => a.code === 'proxy_implementation_changed')) {
    steps.push('CRITICAL: The proxy implementation was upgraded since the last check. Verify the new implementation contract before proceeding.');
  }


  if (anomalies.some((a) => a.code === 'decimal_mismatch')) {
    steps.push('Token decimal mismatch detected between chains. Do not compare raw amounts — this could indicate a different token or a misconfigured destination.');
  }


  const failedDests = destinations.filter((d) => d.status === 'DESYNC');
  for (const dest of failedDests) {
    const driftIssues = (dest.issues || []).filter((i) => i.code?.includes('drift'));
    if (driftIssues.length > 0) {
      steps.push(
        `Investigate drift on ${dest.name} (chain ${dest.chainId}): ${driftIssues.map((i) => i.message).join('; ')}`
      );
    } else {
      steps.push(`Destination ${dest.name} is desynced — check contract deployment and RPC health on chain ${dest.chainId}.`);
    }
  }


  const missingSelectorDests = destinations.filter((d) =>
    (d.issues || []).some((i) => i.code === 'ccip_selector_missing')
  );
  if (missingSelectorDests.length > 0) {
    steps.push(
      `Add CCIP chain selectors for: ${missingSelectorDests.map((d) => d.name).join(', ')} to enable lane verification.`
    );
  }


  if (destinations.length === 0) {
    steps.push('Configure destination chain targets with RPCs, vault addresses, and CCIP selectors for true cross-chain proof.');
  }


  if (anomalies.some((a) => a.code === 'source_supply_jump')) {
    steps.push('Total supply changed by more than 5% since the last check. Investigate minting/burning events before distribution.');
  }


  if (steps.length === 0) {
    steps.push('Use the oracle passport as the decision receipt for this verification run.');
    steps.push('Re-run the oracle before any state-changing workflow to ensure freshness.');
    steps.push('Monitor history for regressions or supply jumps between runs.');
  }

  return steps;
}

function buildDependencies(result) {
  const deps = [];

  if (result.anomalies?.some((a) => a.code === 'contract_paused')) {
    deps.push('check-vault-pause-state');
  }

  if (result.anomalies?.some((a) => a.code === 'proxy_implementation_changed')) {
    deps.push('verify-proxy-implementation-bytecode');
  }

  const desynced = (result.crossChain?.destinations || []).filter(
    (d) => d.status === 'DESYNC'
  );
  if (desynced.length > 0) {
    deps.push('verify-ccip-message-delivery');
  }

  if (result.intelligence?.confidenceScore < 70) {
    deps.push('retry-with-alternative-rpc');
  }

  return deps;
}

function shouldEscalate(result) {
  const anomalies = result.anomalies || [];


  if (anomalies.some((a) =>
    ['proxy_implementation_changed', 'source_code_size_changed', 'router_owner_changed'].includes(a.code)
  )) {
    return {
      required: true,
      reason: 'Structural change detected (proxy upgrade, bytecode change, or ownership transfer). Human review required before any automated action.',
    };
  }


  const critCount = anomalies.filter((a) => a.severity === 'critical').length;
  if (critCount >= 2) {
    return {
      required: true,
      reason: `${critCount} critical anomalies detected simultaneously. This pattern requires human judgment.`,
    };
  }

  return { required: false, reason: null };
}

function buildAgentPlan(result) {
  const verdict = result.intelligence.verdict;
  const confidence = result.intelligence.confidenceScore;
  const anomalies = result.anomalies || [];
  const criticalAnomalies = anomalies.filter(
    (item) => item.severity === 'critical' || item.severity === 'high'
  );

  const urgency = determineUrgency(verdict, anomalies);
  const rerunInterval = suggestRerunInterval(verdict, confidence);
  const safeNextSteps = buildContextualSteps(result);
  const dependencies = buildDependencies(result);
  const escalation = shouldEscalate(result);

  if (verdict === 'STOP' || criticalAnomalies.length > 0) {
    return {
      action: 'STOP',
      urgency,
      reason:
        criticalAnomalies[0]?.message ||
        result.intelligence.summary ||
        'Critical oracle evidence failed.',
      suggestedRerunInterval: rerunInterval,
      dependencies,
      humanEscalation: escalation.required,
      humanEscalationReason: escalation.reason,
      safeNextSteps,
    };
  }

  if (verdict === 'CAUTION') {
    return {
      action: 'WAIT',
      urgency,
      reason: result.intelligence.summary,
      suggestedRerunInterval: rerunInterval,
      dependencies,
      humanEscalation: escalation.required,
      humanEscalationReason: escalation.reason,
      safeNextSteps,
    };
  }

  return {
    action: 'PROCEED_READ_ONLY',
    urgency,
    reason: 'All configured checks passed within tolerance.',
    suggestedRerunInterval: rerunInterval,
    dependencies,
    humanEscalation: escalation.required,
    humanEscalationReason: escalation.reason,
    safeNextSteps,
  };
}

module.exports = { buildAgentPlan };
