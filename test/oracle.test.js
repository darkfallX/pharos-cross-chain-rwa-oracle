require('dotenv').config();

const {
  runOracle,
  assessSyncStatus,
  applyDestinationSyncStatus,
  SKILL_META,
} = require('../src/oracle');
const { DEMO_VAULT_ADDRESS, CHAINS, CCIP_ROUTER_ADDRESS } = require('../src/chains');
const { withRetry } = require('../src/retry');
const { toJSON, shortAddr } = require('../src/formatter');
const {
  amountDriftBps,
  compareRawAmounts,
  evaluateDestination,
} = require('../src/intelligence');
const { normalizeDestinationTarget } = require('../src/destinations');
const { getPreset } = require('../src/presets');
const { hashObject, createPassport } = require('../src/proof');
const { compactSnapshot } = require('../src/history');

let passed = 0;
let failed = 0;
let skipped = 0;

function test(name, fn) {
  return { name, fn };
}

async function runTests(tests) {
  console.log('\n  ⬡ Pharos RWA Oracle — Test Suite');
  console.log('  ─────────────────────────────────────────\n');

  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✓ ${t.name}`);
    } catch (err) {
      if (err.message && err.message.startsWith('SKIP:')) {
        skipped++;
        console.log(`  ○ ${t.name} (${err.message})`);
      } else {
        failed++;
        console.log(`  ✗ ${t.name}`);
        console.log(`    Error: ${err.message}`);
      }
    }
  }

  console.log(`\n  ─────────────────────────────────────────`);
  console.log(`  Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log('');

  if (failed > 0) process.exit(1);
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEquals(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(
      msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function assertType(value, type, msg) {
  if (typeof value !== type) {
    throw new Error(msg || `Expected type ${type}, got ${typeof value}`);
  }
}

// ── Unit Tests ───────────────────────────────────────────────

const unitTests = [
  // ── Metadata ───────────────────────────────────────────
  test('SKILL_META has correct name', () => {
    assertEquals(
      SKILL_META.skill,
      'pharos-cross-chain-rwa-distribution-oracle'
    );
  }),

  test('SKILL_META has version 2.0.0', () => {
    assertEquals(SKILL_META.version, '2.0.0');
  }),

  // ── Chain config ───────────────────────────────────────
  test('Pharos Mainnet chain ID is 1672', () => {
    assertEquals(CHAINS.pharosMainnet.id, 1672);
  }),

  test('Pharos Testnet chain ID is 688689', () => {
    assertEquals(CHAINS.pharosTestnet.id, 688689);
  }),

  test('CCIP Router address matches spec', () => {
    assertEquals(
      CCIP_ROUTER_ADDRESS,
      '0x4e52dD94e9BCfeFE3C78153bDfB0AB1d30687297'
    );
  }),

  test('Demo vault address is correct', () => {
    assertEquals(
      DEMO_VAULT_ADDRESS,
      '0xC879C018dB60520F4355C26eD1a6D572cdAC1815'
    );
  }),

  // ── Sync assessment logic ──────────────────────────────
  test('assessSyncStatus returns SYNCED for valid state', () => {
    const result = assessSyncStatus(
      { reachable: true, errors: [] },
      { exists: true, errors: [] }
    );
    assertEquals(result.syncStatus, 'SYNCED');
    assert(result.pharosCanonical);
    assert(result.ccipVerified);
  }),

  test('assessSyncStatus returns PARTIAL when errors present', () => {
    const result = assessSyncStatus(
      { reachable: true, errors: ['some warning'] },
      { exists: true, errors: [] }
    );
    assertEquals(result.syncStatus, 'PARTIAL');
  }),

  test('assessSyncStatus returns DESYNC when vault missing', () => {
    const result = assessSyncStatus(
      { reachable: true, errors: [] },
      { exists: false, errors: [] }
    );
    assertEquals(result.syncStatus, 'DESYNC');
  }),

  test('assessSyncStatus returns DESYNC when CCIP unreachable', () => {
    const result = assessSyncStatus(
      { reachable: false, errors: [] },
      { exists: true, errors: [] }
    );
    assertEquals(result.syncStatus, 'DESYNC');
  }),

  test('assessSyncStatus returns UNKNOWN when both fail', () => {
    const result = assessSyncStatus(
      { reachable: false, errors: [] },
      { exists: false, errors: [] }
    );
    assertEquals(result.syncStatus, 'UNKNOWN');
  }),

  // ── Formatter ──────────────────────────────────────────
  test('applyDestinationSyncStatus returns DESYNC for failed destination', () => {
    const result = applyDestinationSyncStatus(
      { syncStatus: 'SYNCED', pharosCanonical: true, ccipVerified: true },
      [{ status: 'DESYNC' }]
    );
    assertEquals(result.syncStatus, 'DESYNC');
  }),

  test('amountDriftBps calculates raw amount drift', () => {
    assertEquals(amountDriftBps('1000', '1001'), 10);
  }),

  test('compareRawAmounts fails when tolerance is exceeded', () => {
    const result = compareRawAmounts('totalSupply', '1000', '1002', 10);
    assertEquals(result.status, 'FAIL');
    assertEquals(result.driftBps, 20);
  }),

  test('evaluateDestination returns SYNCED when lane and supply match', () => {
    const target = normalizeDestinationTarget(
      {
        chainId: 1,
        name: 'Ethereum',
        rpc: 'http://localhost:8545',
        address: DEMO_VAULT_ADDRESS,
        ccipSelector: '5009297550715157269',
      },
      0
    );
    const result = evaluateDestination({
      target,
      sourceState: {
        exists: true,
        totalSupplyRaw: '1000',
        totalSupply: '1000',
        errors: [],
      },
      destinationState: {
        exists: true,
        totalSupplyRaw: '1000',
        totalSupply: '1000',
        errors: [],
      },
      ccipLane: {
        destChainSelector: target.ccipSelector,
        supported: true,
        onRampAddress: DEMO_VAULT_ADDRESS,
        error: null,
      },
      blockNumber: 1,
    });
    assertEquals(result.status, 'SYNCED');
  }),

  test('evaluateDestination allows same-chain self-check without CCIP selector', () => {
    const target = normalizeDestinationTarget(
      {
        chainId: 1672,
        name: 'Pharos Self-Check',
        rpc: 'https://rpc.pharos.xyz',
        address: DEMO_VAULT_ADDRESS,
      },
      0
    );
    const result = evaluateDestination({
      target,
      sourceChainId: 1672,
      sourceState: {
        exists: true,
        totalSupplyRaw: '1000',
        totalSupply: '1000',
        errors: [],
      },
      destinationState: {
        exists: true,
        totalSupplyRaw: '1000',
        totalSupply: '1000',
        errors: [],
      },
      blockNumber: 1,
    });
    assertEquals(result.status, 'SYNCED');
    assertEquals(result.issues.length, 0);
  }),

  test('chain preset registry resolves Base', () => {
    const preset = getPreset('base');
    assert(preset, 'Missing Base preset');
    assertEquals(preset.chainId, 8453);
    assertType(preset.ccipSelector, 'string');
  }),

  test('normalizeDestinationTarget accepts preset address shorthand', () => {
    const result = normalizeDestinationTarget(
      `base:${DEMO_VAULT_ADDRESS}`,
      0
    );
    assertEquals(result.chainId, 8453);
    assertEquals(result.address, DEMO_VAULT_ADDRESS);
  }),

  test('hashObject is stable regardless of object key order', () => {
    assertEquals(hashObject({ b: 2, a: 1 }), hashObject({ a: 1, b: 2 }));
  }),

  test('createPassport returns proof hash and expiry', () => {
    const passport = createPassport({
      skill: 'test-skill',
      version: '1.2.0',
      vault: DEMO_VAULT_ADDRESS,
      network: { chainId: 1672 },
      distribution: { syncStatus: 'SYNCED', coverage: 'CROSS_CHAIN' },
      intelligence: { verdict: 'GO', confidenceScore: 100 },
      proof: { generatedAt: '2026-06-06T00:00:00.000Z', source: {}, destinations: [] },
    });
    assert(passport.passportId.startsWith('sha256:'));
    assert(passport.proofHash.startsWith('sha256:'));
    assertEquals(passport.validUntil, '2026-06-06T00:05:00.000Z');
  }),

  test('compactSnapshot extracts history fields', () => {
    const snapshot = compactSnapshot({
      timestamp: '2026-06-06T00:00:00.000Z',
      vault: DEMO_VAULT_ADDRESS,
      network: { chainId: 1672 },
      diagnostics: { blockNumber: 1 },
      intelligence: { verdict: 'GO', confidenceScore: 100 },
      distribution: { syncStatus: 'SYNCED', coverage: 'CROSS_CHAIN' },
      vault_state: { tokenSymbol: 'USDC', codeSize: 1 },
      ccipRouter: { owner: '0x0000000000000000000000000000000000000000' },
      proof: { source: { state: { totalSupplyRaw: '1', totalAssetsRaw: null } } },
      passport: { proofHash: 'sha256:test' },
      crossChain: { destinations: [] },
    });
    assertEquals(snapshot.vault, DEMO_VAULT_ADDRESS);
    assertEquals(snapshot.proofHash, 'sha256:test');
  }),

  test('shortAddr truncates correctly', () => {
    const addr = '0x1234567890abcdef1234567890abcdef12345678';
    const short = shortAddr(addr);
    assert(short.startsWith('0x1234'));
    assert(short.endsWith('5678'));
  }),

  test('toJSON produces valid JSON', () => {
    const obj = { test: true, num: 42 };
    const json = toJSON(obj);
    const parsed = JSON.parse(json);
    assertEquals(parsed.test, true);
    assertEquals(parsed.num, 42);
  }),

  test('toJSON pretty mode includes newlines', () => {
    const obj = { test: true };
    const json = toJSON(obj, true);
    assert(json.includes('\n'));
  }),

  // ── Retry logic ────────────────────────────────────────
  test('withRetry succeeds on first attempt', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        return 'ok';
      },
      { retries: 3, label: 'test' }
    );
    assertEquals(result, 'ok');
    assertEquals(calls, 1);
  }),

  test('withRetry retries on failure', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error('fail');
        return 'recovered';
      },
      { retries: 3, delayMs: 50, label: 'test' }
    );
    assertEquals(result, 'recovered');
    assertEquals(calls, 3);
  }),

  test('withRetry throws after exhausting retries', async () => {
    try {
      await withRetry(
        async () => {
          throw new Error('permanent');
        },
        { retries: 2, delayMs: 50, label: 'test' }
      );
      assert(false, 'Should have thrown');
    } catch (err) {
      assert(err.message.includes('Failed after 3 attempts'));
    }
  }),

  // ── Security analysis helpers ───────────────────────────
  test('detectAnomalies flags paused contracts', () => {
    const { detectAnomalies } = require('../src/anomalies');
    const result = {
      vault_state: { exists: true, codeSize: 100, decimals: 18 },
      distribution: { coverage: 'CROSS_CHAIN' },
      crossChain: { destinations: [] },
      diagnostics: { blockNumber: 100 },
      intelligence: { verdict: 'GO', confidenceScore: 100 },
      ccipRouter: { owner: '0x1234' },
      proof: { source: { state: { totalSupplyRaw: '1000' } } },
      _proxyInfo: null,
      _pauseInfo: { hasPausable: true, isPaused: true },
      _ownerInfo: { owner: '0x1234', ownerCodeSize: 0 },
    };
    const anomalies = detectAnomalies(result, {});
    assert(anomalies.some(a => a.code === 'contract_paused'), 'Should flag paused contract');
  }),

  test('detectAnomalies flags decimal mismatch', () => {
    const { detectAnomalies } = require('../src/anomalies');
    const result = {
      vault_state: { exists: true, codeSize: 100, decimals: 18 },
      distribution: { coverage: 'CROSS_CHAIN' },
      crossChain: {
        destinations: [{
          id: 'test',
          name: 'Test',
          chainId: 1,
          status: 'SYNCED',
          state: { decimals: 6 },
          comparisons: [],
          issues: [],
        }],
      },
      diagnostics: { blockNumber: 100 },
      intelligence: { verdict: 'GO', confidenceScore: 100 },
      ccipRouter: { owner: '0x1234' },
      proof: { source: { state: { totalSupplyRaw: '1000' } } },
      _proxyInfo: null,
      _pauseInfo: null,
      _ownerInfo: null,
    };
    const anomalies = detectAnomalies(result, {});
    assert(anomalies.some(a => a.code === 'decimal_mismatch'), 'Should flag decimal mismatch');
  }),

  // ── Planner tests ──────────────────────────────────────
  test('buildAgentPlan returns IMMEDIATE urgency for STOP verdict', () => {
    const { buildAgentPlan } = require('../src/planner');
    const plan = buildAgentPlan({
      intelligence: { verdict: 'STOP', confidenceScore: 30, summary: 'Critical failure' },
      anomalies: [{ severity: 'critical', code: 'test', message: 'test' }],
      crossChain: { destinations: [] },
      vault_state: { exists: false },
      ccipRouter: { reachable: false },
    });
    assertEquals(plan.urgency, 'IMMEDIATE');
    assertEquals(plan.action, 'STOP');
    assertType(plan.suggestedRerunInterval, 'string');
    assert(Array.isArray(plan.dependencies));
    assertType(plan.humanEscalation, 'boolean');
  }),

  test('buildAgentPlan returns ROUTINE urgency for GO verdict', () => {
    const { buildAgentPlan } = require('../src/planner');
    const plan = buildAgentPlan({
      intelligence: { verdict: 'GO', confidenceScore: 100, summary: 'All good' },
      anomalies: [],
      crossChain: { destinations: [] },
      vault_state: { exists: true },
      ccipRouter: { reachable: true },
    });
    assertEquals(plan.urgency, 'ROUTINE');
    assertEquals(plan.action, 'PROCEED_READ_ONLY');
  }),

  test('buildAgentPlan triggers human escalation for proxy changes', () => {
    const { buildAgentPlan } = require('../src/planner');
    const plan = buildAgentPlan({
      intelligence: { verdict: 'STOP', confidenceScore: 40, summary: 'Critical' },
      anomalies: [{ severity: 'critical', code: 'proxy_implementation_changed', message: 'Proxy changed' }],
      crossChain: { destinations: [] },
      vault_state: { exists: true },
      ccipRouter: { reachable: true },
    });
    assert(plan.humanEscalation, 'Should require human escalation for proxy changes');
  }),
];

// ── Integration Tests (network-dependent) ────────────────────

const integrationTests = [
  test('runOracle returns structured result for demo vault', async () => {
    const result = await runOracle(DEMO_VAULT_ADDRESS, { recordHistory: false });

    // Verify envelope structure
    assertEquals(result.skill, 'pharos-cross-chain-rwa-distribution-oracle');
    assertEquals(result.version, '2.0.0');
    assertType(result.timestamp, 'string');
    assertEquals(result.vault, DEMO_VAULT_ADDRESS);

    // Verify network info
    assert(result.network, 'Missing network info');
    assertType(result.network.chainId, 'number');
    assertType(result.network.name, 'string');

    // Verify CCIP router section
    assert(result.ccipRouter, 'Missing ccipRouter');
    assertEquals(result.ccipRouter.address, CCIP_ROUTER_ADDRESS);
    assertType(result.ccipRouter.reachable, 'boolean');

    // Verify vault state section
    assert(result.vault_state, 'Missing vault_state');
    assertType(result.vault_state.exists, 'boolean');

    // Verify distribution verdict
    assert(result.distribution, 'Missing distribution');
    assert(
      ['SYNCED', 'PARTIAL', 'DESYNC', 'UNKNOWN'].includes(
        result.distribution.syncStatus
      ),
      `Unexpected syncStatus: ${result.distribution.syncStatus}`
    );

    // Verify diagnostics
    assert(result.diagnostics, 'Missing diagnostics');
    assertType(result.diagnostics.rpcLatencyMs, 'number');
    assertType(result.diagnostics.blockNumber, 'number');
    assert(Array.isArray(result.diagnostics.errors));

    // Verify intelligence envelope
    assert(result.intelligence, 'Missing intelligence');
    assert(
      ['GO', 'CAUTION', 'STOP'].includes(result.intelligence.verdict),
      `Unexpected verdict: ${result.intelligence.verdict}`
    );
    assertType(result.intelligence.confidenceScore, 'number');
    assert(result.crossChain, 'Missing crossChain');
    assert(result.proof, 'Missing proof');
    assert(result.passport, 'Missing passport');
    assert(result.agentPlan, 'Missing agentPlan');
    assert(Array.isArray(result.anomalies));

    // Verify new v2 fields
    assert(result.securityAnalysis, 'Missing securityAnalysis');
    assertType(result.securityAnalysis.proxy.isProxy, 'boolean');
    assertType(result.securityAnalysis.pausable.hasPausable, 'boolean');

    // Verify upgraded agent plan
    assert(result.agentPlan.urgency, 'Missing agentPlan.urgency');
    assertType(result.agentPlan.suggestedRerunInterval, 'string');
    assert(Array.isArray(result.agentPlan.dependencies));
    assertType(result.agentPlan.humanEscalation, 'boolean');
  }),

  test('runOracle JSON is parseable', async () => {
    const result = await runOracle(DEMO_VAULT_ADDRESS, { recordHistory: false });
    const json = toJSON(result);
    const parsed = JSON.parse(json);
    assertEquals(parsed.vault, DEMO_VAULT_ADDRESS);
  }),
];

// ── Run all tests ────────────────────────────────────────────
(async () => {
  const allTests = [...unitTests, ...integrationTests];
  await runTests(allTests);
})();
