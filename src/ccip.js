const { createPublicClient, http, getContract } = require('viem');
const { CCIP_ROUTER_ABI } = require('./abi');
const { CHAINS, CCIP_ROUTER_ADDRESS, toViemChain } = require('./chains');
const { withRetry, withTimeout } = require('./retry');

function createPharosClient(rpcOverride) {
  const rpcUrl = rpcOverride || process.env.PHAROS_RPC_URL || CHAINS.pharosMainnet.rpc;

  return createPublicClient({
    chain: toViemChain(CHAINS.pharosMainnet),
    transport: http(rpcUrl, {
      timeout: 15_000,
      retryCount: 2,
      retryDelay: 1000,
    }),
  });
}

function createFallbackClient() {
  const rpcUrl =
    process.env.PHAROS_TESTNET_RPC_URL || CHAINS.pharosTestnet.rpc;

  return createPublicClient({
    chain: toViemChain(CHAINS.pharosTestnet),
    transport: http(rpcUrl, {
      timeout: 15_000,
      retryCount: 2,
      retryDelay: 1000,
    }),
  });
}

function createReadOnlyClient(chainConfig) {
  const rpcUrl = chainConfig.rpc;

  if (!rpcUrl) {
    throw new Error(`Missing RPC URL for ${chainConfig.name || chainConfig.id}`);
  }

  return createPublicClient({
    chain: toViemChain(chainConfig),
    transport: http(rpcUrl, {
      timeout: 15_000,
      retryCount: 2,
      retryDelay: 1000,
    }),
  });
}

async function verifyCCIPRouter(client) {
  const routerAddress = CCIP_ROUTER_ADDRESS;

  const result = {
    address: routerAddress,
    reachable: false,
    typeAndVersion: null,
    owner: null,
    codeSize: 0,
    errors: [],
  };

  try {
    const code = await withRetry(
      () =>
        withTimeout(
          () => client.getCode({ address: routerAddress }),
          10_000,
          'ccip-getCode'
        ),
      { retries: 2, label: 'ccip-getCode' }
    );

    if (!code || code === '0x') {
      result.errors.push('CCIP Router has no deployed code at this address');
      return result;
    }

    result.codeSize = Math.floor((code.length - 2) / 2);
    result.reachable = true;

    try {
      const contract = getContract({
        address: routerAddress,
        abi: CCIP_ROUTER_ABI,
        client,
      });

      const typeAndVersion = await withRetry(
        () =>
          withTimeout(
            () => contract.read.typeAndVersion(),
            10_000,
            'ccip-typeAndVersion'
          ),
        { retries: 2, label: 'ccip-typeAndVersion' }
      );

      result.typeAndVersion = typeAndVersion;
    } catch (err) {
      result.errors.push(`typeAndVersion read failed: ${err.message}`);
    }

    try {
      const contract = getContract({
        address: routerAddress,
        abi: CCIP_ROUTER_ABI,
        client,
      });

      const owner = await withRetry(
        () =>
          withTimeout(
            () => contract.read.owner(),
            10_000,
            'ccip-owner'
          ),
        { retries: 1, label: 'ccip-owner' }
      );

      result.owner = owner;
    } catch (err) {
      result.errors.push(`owner read failed: ${err.message}`);
    }
  } catch (err) {
    result.errors.push(`Router verification failed: ${err.message}`);
  }

  return result;
}

// Checks if the CCIP Router has an on-ramp for a given destination chain selector
async function checkCCIPDestination(client, destChainSelector) {
  const result = {
    destChainSelector: destChainSelector.toString(),
    supported: false,
    onRampAddress: null,
    error: null,
  };

  try {
    const contract = getContract({
      address: CCIP_ROUTER_ADDRESS,
      abi: CCIP_ROUTER_ABI,
      client,
    });

    const onRamp = await withRetry(
      () =>
        withTimeout(
          () => contract.read.getOnRamp([destChainSelector]),
          10_000,
          'ccip-getOnRamp'
        ),
      { retries: 2, label: 'ccip-getOnRamp' }
    );

    const isSupported =
      onRamp && onRamp !== '0x0000000000000000000000000000000000000000';

    result.supported = isSupported;
    result.onRampAddress = onRamp;
  } catch (err) {
    result.error = err.message;
  }

  return result;
}

module.exports = {
  createPharosClient,
  createFallbackClient,
  createReadOnlyClient,
  verifyCCIPRouter,
  checkCCIPDestination,
};
