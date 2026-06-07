const CHAIN_PRESETS = {
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum Mainnet',
    chainId: 1,
    rpc: 'https://ethereum.publicnode.com',
    ccipSelector: '5009297550715157269',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://etherscan.io',
  },
  base: {
    id: 'base',
    name: 'Base Mainnet',
    chainId: 8453,
    rpc: 'https://mainnet.base.org',
    ccipSelector: '15971525489660198786',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://basescan.org',
  },
  arbitrum: {
    id: 'arbitrum',
    name: 'Arbitrum One',
    chainId: 42161,
    rpc: 'https://arb1.arbitrum.io/rpc',
    ccipSelector: '4949039107694359620',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://arbiscan.io',
  },
  optimism: {
    id: 'optimism',
    name: 'OP Mainnet',
    chainId: 10,
    rpc: 'https://mainnet.optimism.io',
    ccipSelector: '3734403246176062136',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://optimistic.etherscan.io',
  },
  avalanche: {
    id: 'avalanche',
    name: 'Avalanche C-Chain',
    chainId: 43114,
    rpc: 'https://api.avax.network/ext/bc/C/rpc',
    ccipSelector: '6433500567565415381',
    nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
    blockExplorer: 'https://snowtrace.io',
  },
  polygon: {
    id: 'polygon',
    name: 'Polygon Mainnet',
    chainId: 137,
    rpc: 'https://polygon-rpc.com',
    ccipSelector: '4051577828743386545',
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    blockExplorer: 'https://polygonscan.com',
  },
};

function getPreset(id) {
  if (!id) return null;
  return CHAIN_PRESETS[id.toLowerCase()] || null;
}

function listPresets() {
  return Object.values(CHAIN_PRESETS).map((preset) => ({ ...preset }));
}

module.exports = { CHAIN_PRESETS, getPreset, listPresets };
