const CHAINS = {
  pharosMainnet: {
    id: 1672,
    name: 'Pharos Pacific Mainnet',
    rpc: 'https://rpc.pharos.xyz',
    nativeCurrency: {
      name: 'GAS',
      symbol: 'GAS',
      decimals: 18,
    },
    blockExplorer: 'https://pharosscan.xyz',
    ccipRouter: '0x4e52dD94e9BCfeFE3C78153bDfB0AB1d30687297',
    isMainnet: true,
  },

  pharosTestnet: {
    id: 688689,
    name: 'Pharos Atlantic Testnet',
    rpc: 'https://atlantic.dplabs-internal.com',
    nativeCurrency: {
      name: 'GAS',
      symbol: 'GAS',
      decimals: 18,
    },
    blockExplorer: '',
    ccipRouter: null,
    isMainnet: false,
  },
};

const CCIP_ROUTER_ADDRESS = '0x4e52dD94e9BCfeFE3C78153bDfB0AB1d30687297';
const DEMO_VAULT_ADDRESS = '0xC879C018dB60520F4355C26eD1a6D572cdAC1815';

function getChainById(chainId) {
  return (
    Object.values(CHAINS).find((c) => c.id === chainId) || null
  );
}

function toViemChain(chainConfig) {
  return {
    id: chainConfig.id,
    name: chainConfig.name,
    nativeCurrency: chainConfig.nativeCurrency,
    rpcUrls: {
      default: { http: [chainConfig.rpc] },
      public: { http: [chainConfig.rpc] },
    },
    blockExplorers: chainConfig.blockExplorer
      ? {
          default: {
            name: chainConfig.name,
            url: chainConfig.blockExplorer,
          },
        }
      : undefined,
  };
}

module.exports = {
  CHAINS,
  CCIP_ROUTER_ADDRESS,
  DEMO_VAULT_ADDRESS,
  getChainById,
  toViemChain,
};
