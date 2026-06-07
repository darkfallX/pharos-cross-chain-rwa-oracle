const { getContract, formatUnits } = require('viem');
const { ERC20_ABI, VAULT_ABI } = require('./abi');
const { withRetry, withTimeout } = require('./retry');

async function readVaultState(client, vaultAddress) {
  const state = {
    address: vaultAddress,
    exists: false,
    codeSize: 0,
    balance: '0',
    balanceRaw: '0',
    tokenName: null,
    tokenSymbol: null,
    decimals: null,
    totalSupply: null,
    totalSupplyRaw: null,
    underlyingAsset: null,
    totalAssets: null,
    totalAssetsRaw: null,
    isERC20: false,
    isERC4626: false,
    errors: [],
  };

  try {
    const [code, balance] = await Promise.all([
      withRetry(
        () =>
          withTimeout(
            () => client.getCode({ address: vaultAddress }),
            10_000,
            'vault-getCode'
          ),
        { retries: 2, label: 'vault-getCode' }
      ),
      withRetry(
        () =>
          withTimeout(
            () => client.getBalance({ address: vaultAddress }),
            10_000,
            'vault-getBalance'
          ),
        { retries: 2, label: 'vault-getBalance' }
      ),
    ]);

    if (!code || code === '0x') {
      state.errors.push('No contract code found at this address');
      state.balance = formatUnits(balance || 0n, 18);
      state.balanceRaw = (balance || 0n).toString();
      return state;
    }

    state.exists = true;
    state.codeSize = Math.floor((code.length - 2) / 2);
    state.balance = formatUnits(balance, 18);
    state.balanceRaw = balance.toString();

    // ERC-20 reads
    const erc20Contract = getContract({
      address: vaultAddress,
      abi: ERC20_ABI,
      client,
    });

    const erc20Reads = await Promise.allSettled([
      withRetry(
        () => withTimeout(() => erc20Contract.read.name(), 10_000, 'erc20-name'),
        { retries: 1, label: 'erc20-name' }
      ),
      withRetry(
        () => withTimeout(() => erc20Contract.read.symbol(), 10_000, 'erc20-symbol'),
        { retries: 1, label: 'erc20-symbol' }
      ),
      withRetry(
        () => withTimeout(() => erc20Contract.read.decimals(), 10_000, 'erc20-decimals'),
        { retries: 1, label: 'erc20-decimals' }
      ),
      withRetry(
        () => withTimeout(() => erc20Contract.read.totalSupply(), 10_000, 'erc20-totalSupply'),
        { retries: 1, label: 'erc20-totalSupply' }
      ),
    ]);

    const [nameRes, symbolRes, decimalsRes, supplyRes] = erc20Reads;

    if (nameRes.status === 'fulfilled') {
      state.tokenName = nameRes.value;
      state.isERC20 = true;
    }
    if (symbolRes.status === 'fulfilled') {
      state.tokenSymbol = symbolRes.value;
    }
    if (decimalsRes.status === 'fulfilled') {
      state.decimals = Number(decimalsRes.value);
    }
    if (supplyRes.status === 'fulfilled') {
      const dec = state.decimals ?? 18;
      state.totalSupplyRaw = supplyRes.value.toString();
      state.totalSupply = formatUnits(supplyRes.value, dec);
    }

    // ERC-4626 reads
    const vaultContract = getContract({
      address: vaultAddress,
      abi: VAULT_ABI,
      client,
    });

    const vaultReads = await Promise.allSettled([
      withRetry(
        () => withTimeout(() => vaultContract.read.asset(), 10_000, 'vault-asset'),
        { retries: 1, label: 'vault-asset' }
      ),
      withRetry(
        () => withTimeout(() => vaultContract.read.totalAssets(), 10_000, 'vault-totalAssets'),
        { retries: 1, label: 'vault-totalAssets' }
      ),
    ]);

    const [assetRes, totalAssetsRes] = vaultReads;

    if (assetRes.status === 'fulfilled') {
      state.underlyingAsset = assetRes.value;
      state.isERC4626 = true;
    }
    if (totalAssetsRes.status === 'fulfilled') {
      const dec = state.decimals ?? 18;
      state.totalAssetsRaw = totalAssetsRes.value.toString();
      state.totalAssets = formatUnits(totalAssetsRes.value, dec);
    }
  } catch (err) {
    state.errors.push(`Vault read failed: ${err.message}`);
  }

  return state;
}

async function readWalletPosition(client, vaultAddress, wallet) {
  const result = {
    wallet,
    vaultAddress,
    balance: '0',
    balanceRaw: '0',
    decimals: 18,
    error: null,
  };

  try {
    const contract = getContract({
      address: vaultAddress,
      abi: ERC20_ABI,
      client,
    });

    const [balance, decimals] = await Promise.all([
      withRetry(
        () =>
          withTimeout(
            () => contract.read.balanceOf([wallet]),
            10_000,
            'balanceOf'
          ),
        { retries: 2, label: 'balanceOf' }
      ),
      withRetry(
        () =>
          withTimeout(
            () => contract.read.decimals(),
            10_000,
            'decimals'
          ),
        { retries: 1, label: 'decimals' }
      ).catch(() => 18),
    ]);

    const dec = Number(decimals);
    result.decimals = dec;
    result.balanceRaw = balance.toString();
    result.balance = formatUnits(balance, dec);
  } catch (err) {
    result.error = err.message;
  }

  return result;
}

module.exports = { readVaultState, readWalletPosition };
