const crypto = require('crypto');

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

function hashObject(value) {
  return `sha256:${crypto
    .createHash('sha256')
    .update(stableStringify(value))
    .digest('hex')}`;
}

function createPassport({ skill, version, vault, network, distribution, intelligence, proof }, options = {}) {
  const ttlMinutes = options.passportTTLMinutes || 5;
  const checkedAt = proof.generatedAt;
  const validUntil = new Date(Date.parse(checkedAt) + ttlMinutes * 60 * 1000).toISOString();
  const proofHash = hashObject(proof);

  return {
    passportId: hashObject({
      skill,
      version,
      vault,
      chainId: network.chainId,
      checkedAt,
      proofHash,
    }),
    skill,
    version,
    vault,
    chainId: network.chainId,
    verdict: intelligence.verdict,
    confidenceScore: intelligence.confidenceScore,
    syncStatus: distribution.syncStatus,
    coverage: distribution.coverage,
    proofHash,
    checkedAt,
    validUntil,
    ttlMinutes,
  };
}

module.exports = { stableStringify, hashObject, createPassport };
