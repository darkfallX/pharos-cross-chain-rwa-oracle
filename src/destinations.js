const fs = require('fs');
const path = require('path');
const { isValidAddress, createInputError } = require('./validation');
const { getPreset } = require('./presets');

const DEFAULT_TOLERANCE_BPS = 10;

function parseJsonSource(source, label = 'destinations') {
  if (!source) return [];
  if (Array.isArray(source)) return source;

  if (typeof source !== 'string') {
    throw createInputError(`${label} must be a JSON array or a path to a JSON file`);
  }

  const trimmed = source.trim();
  if (!trimmed) return [];

  if (!trimmed.startsWith('[') && !trimmed.startsWith('{') && trimmed.includes(':')) {
    return trimmed
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  const possiblePath = path.resolve(process.cwd(), trimmed);
  const jsonText = fs.existsSync(possiblePath)
    ? fs.readFileSync(possiblePath, 'utf8')
    : trimmed;

  try {
    const parsed = JSON.parse(jsonText);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (err) {
    throw createInputError(`Invalid ${label} JSON: ${err.message}`);
  }
}

function targetFromPresetSpec(spec) {
  const [presetId, address, alias] = spec.split(':');
  const preset = getPreset(presetId);

  if (!preset) {
    throw createInputError(`Unknown chain preset: ${presetId}`);
  }

  if (!isValidAddress(address)) {
    throw createInputError(`Invalid target address for preset ${presetId}`);
  }

  return {
    ...preset,
    id: alias || preset.id,
    address,
  };
}

function normalizeDestinationTarget(raw, index, defaults = {}) {
  if (typeof raw === 'string') {
    raw = targetFromPresetSpec(raw);
  }

  if (!raw || typeof raw !== 'object') {
    throw createInputError(`Destination #${index + 1} must be an object`);
  }

  const chainId = Number(raw.chainId ?? raw.id);
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw createInputError(`Destination #${index + 1} is missing a valid chainId`);
  }

  const rpc = raw.rpc || raw.rpcUrl;
  if (!rpc || typeof rpc !== 'string') {
    throw createInputError(`Destination #${index + 1} is missing an rpc URL`);
  }

  const address = raw.vault || raw.token || raw.address || defaults.vaultAddress;
  if (!isValidAddress(address)) {
    throw createInputError(`Destination #${index + 1} is missing a valid vault/token address`);
  }

  let ccipSelector = raw.ccipSelector ?? raw.chainSelector ?? null;
  if (ccipSelector !== null && ccipSelector !== undefined && ccipSelector !== '') {
    try {
      ccipSelector = BigInt(ccipSelector).toString();
    } catch (_err) {
      throw createInputError(`Destination #${index + 1} has an invalid CCIP selector`);
    }
  } else {
    ccipSelector = null;
  }

  const toleranceBps = Number(raw.toleranceBps ?? defaults.toleranceBps ?? DEFAULT_TOLERANCE_BPS);
  if (!Number.isFinite(toleranceBps) || toleranceBps < 0) {
    throw createInputError(`Destination #${index + 1} has an invalid toleranceBps`);
  }

  return {
    id: raw.id || raw.slug || `destination-${index + 1}`,
    name: raw.name || `Destination ${chainId}`,
    chainId,
    rpc,
    address,
    ccipSelector,
    blockExplorer: raw.blockExplorer || '',
    nativeCurrency: raw.nativeCurrency || {
      name: raw.nativeCurrencyName || 'Ether',
      symbol: raw.nativeCurrencySymbol || 'ETH',
      decimals: Number(raw.nativeCurrencyDecimals || 18),
    },
    toleranceBps,
  };
}

function resolveDestinationTargets(options = {}) {
  const rawSource =
    options.destinationSource ??
    options.destinations ??
    process.env.ORACLE_DESTINATIONS ??
    null;

  const parsed = parseJsonSource(rawSource);
  return parsed.map((target, index) =>
    normalizeDestinationTarget(target, index, {
      vaultAddress: options.vaultAddress,
      toleranceBps: options.toleranceBps,
    })
  );
}

module.exports = {
  DEFAULT_TOLERANCE_BPS,
  parseJsonSource,
  normalizeDestinationTarget,
  resolveDestinationTargets,
};
