const { amountDriftBps } = require('./intelligence');
const { withRetry, withTimeout } = require('./retry');

// EIP-1967 implementation slot for proxy detection
const EIP1967_IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

function anomaly(severity, code, message, evidence = {}) {
  return { severity, code, message, evidence };
}

async function detectProxy(client, address) {
  try {
    const storage = await withTimeout(
      () => client.getStorageAt({ address, slot: EIP1967_IMPL_SLOT }),
      8_000,
      'proxy-detection'
    );

    if (!storage || storage === '0x' || storage === '0x' + '0'.repeat(64)) {
      return null;
    }

    // last 20 bytes of the 32-byte slot
    const implAddress = '0x' + storage.slice(-40);
    if (implAddress === '0x' + '0'.repeat(40)) return null;

    return implAddress;
  } catch (_err) {
    return null;
  }
}

async function checkPausedState(client, address) {
  try {
    const result = await withTimeout(
      () => client.readContract({
        address,
        abi: [{
          name: 'paused',
          type: 'function',
          stateMutability: 'view',
          inputs: [],
          outputs: [{ name: '', type: 'bool' }],
        }],
        functionName: 'paused',
      }),
      8_000,
      'paused-check'
    );
    return { hasPausable: true, isPaused: Boolean(result) };
  } catch (_err) {
    return { hasPausable: false, isPaused: false };
  }
}

async function readOwner(client, address) {
  try {
    const owner = await withTimeout(
      () => client.readContract({
        address,
        abi: [{
          name: 'owner',
          type: 'function',
          stateMutability: 'view',
          inputs: [],
          outputs: [{ name: '', type: 'address' }],
        }],
        functionName: 'owner',
      }),
      8_000,
      'owner-check'
    );
    return owner;
  } catch (_err) {
    return null;
  }
}

function detectAnomalies(result, historySummary = {}) {
  const anomalies = [];
  const previous = historySummary.previous;


  if (!result.vault_state.exists) {
    anomalies.push(
      anomaly('critical', 'source_contract_missing', 'Canonical source contract code is missing')
    );
  }

  if (result.distribution.coverage === 'PHAROS_SOURCE_ONLY') {
    anomalies.push(
      anomaly('medium', 'source_only_coverage', 'No destination targets were configured for cross-chain proof')
    );
  } else if (result.distribution.coverage === 'PHAROS_SELF_CHECK') {
    anomalies.push(
      anomaly('low', 'self_check_only', 'All configured destinations are on the same chain as the source — this is a self-check, not a true cross-chain proof')
    );
  }


  if (result._proxyInfo?.implementationAddress) {
    anomalies.push(
      anomaly('medium', 'proxy_contract_detected', 'Source vault is a proxy contract — implementation can be upgraded', {
        implementationAddress: result._proxyInfo.implementationAddress,
      })
    );
  }

  if (result._proxyInfo?.previousImplementation &&
      result._proxyInfo.implementationAddress !== result._proxyInfo.previousImplementation) {
    anomalies.push(
      anomaly('critical', 'proxy_implementation_changed', 'Proxy implementation address changed since previous check — possible upgrade or attack', {
        previous: result._proxyInfo.previousImplementation,
        current: result._proxyInfo.implementationAddress,
      })
    );
  }


  if (result._pauseInfo?.isPaused) {
    anomalies.push(
      anomaly('critical', 'contract_paused', 'Source vault contract is currently paused — operations are frozen')
    );
  }


  if (result._ownerInfo?.owner) {
    const owner = result._ownerInfo.owner;
    if (owner === '0x0000000000000000000000000000000000000000') {
      anomalies.push(
        anomaly('medium', 'ownership_renounced', 'Vault owner is the zero address — ownership has been renounced', {
          owner,
        })
      );
    } else if (result._ownerInfo.ownerCodeSize && result._ownerInfo.ownerCodeSize > 0) {
      anomalies.push(
        anomaly('low', 'owner_is_contract', 'Vault owner is a contract (likely multi-sig or governance)', {
          owner,
          codeSize: result._ownerInfo.ownerCodeSize,
        })
      );
    }
  }


  for (const destination of result.crossChain.destinations || []) {
    if (destination.blockNumber && result.diagnostics.blockNumber) {
      const lag = Math.abs(result.diagnostics.blockNumber - destination.blockNumber);
      if (lag > 2500 && destination.chainId === result.network.chainId) {
        anomalies.push(
          anomaly('medium', 'destination_block_lag', 'Destination block is unexpectedly far from source block', {
            destination: destination.id,
            lag,
          })
        );
      }
    }


    if (result.vault_state.decimals !== null &&
        destination.state?.decimals !== null &&
        destination.state?.decimals !== undefined &&
        result.vault_state.decimals !== destination.state.decimals) {
      anomalies.push(
        anomaly('critical', 'decimal_mismatch', `Token decimals mismatch between source (${result.vault_state.decimals}) and destination ${destination.name} (${destination.state.decimals})`, {
          destination: destination.id,
          sourceDecimals: result.vault_state.decimals,
          destinationDecimals: destination.state.decimals,
        })
      );
    }

    for (const comparison of destination.comparisons || []) {
      if (comparison.status === 'FAIL') {
        anomalies.push(
          anomaly('critical', 'comparison_failed', `${comparison.label} drift exceeded tolerance`, {
            destination: destination.id,
            driftBps: comparison.driftBps,
            toleranceBps: comparison.toleranceBps,
          })
        );
      }
    }
  }


  if (previous) {
    if (previous.codeSize && previous.codeSize !== result.vault_state.codeSize) {
      anomalies.push(
        anomaly('critical', 'source_code_size_changed', 'Source contract bytecode size changed since previous check', {
          previous: previous.codeSize,
          current: result.vault_state.codeSize,
        })
      );
    }

    if (previous.routerOwner && previous.routerOwner !== result.ccipRouter.owner) {
      anomalies.push(
        anomaly('high', 'router_owner_changed', 'CCIP router owner changed since previous check', {
          previous: previous.routerOwner,
          current: result.ccipRouter.owner,
        })
      );
    }

    const supplyDrift = amountDriftBps(previous.totalSupplyRaw, result.proof.source.state.totalSupplyRaw);
    if (supplyDrift !== null && supplyDrift > 500) {
      anomalies.push(
        anomaly('high', 'source_supply_jump', 'Source total supply changed by more than 5% since previous check', {
          driftBps: supplyDrift,
          previous: previous.totalSupplyRaw,
          current: result.proof.source.state.totalSupplyRaw,
        })
      );
    }

    if (previous.verdict === 'GO' && result.intelligence.verdict !== 'GO') {
      anomalies.push(
        anomaly('medium', 'verdict_regressed', 'Oracle verdict regressed from GO since previous check', {
          previous: previous.verdict,
          current: result.intelligence.verdict,
        })
      );
    }
  }

  return anomalies;
}

module.exports = { detectAnomalies, detectProxy, checkPausedState, readOwner };
