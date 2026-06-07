require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { runOracle, SKILL_META } = require('./oracle');
const { toJSON } = require('./formatter');
const { DEMO_VAULT_ADDRESS, CHAINS, CCIP_ROUTER_ADDRESS } = require('./chains');
const { isValidAddress } = require('./validation');
const { withTimeout } = require('./retry');
const { createPharosClient } = require('./ccip');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

const log = {
  debug: (...args) => LOG_LEVEL === 'debug' && console.log('[DEBUG]', ...args),
  info: (...args) =>
    ['debug', 'info'].includes(LOG_LEVEL) && console.log('[INFO]', ...args),
  warn: (...args) =>
    ['debug', 'info', 'warn'].includes(LOG_LEVEL) &&
    console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
};

const rateLimitStore = new Map();

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = rateLimitStore.get(ip) || { count: 0, windowStart: now };

  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }

  entry.count++;
  rateLimitStore.set(ip, entry);

  const remaining = Math.max(0, RATE_LIMIT_MAX - entry.count);
  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', Math.ceil((entry.windowStart + RATE_LIMIT_WINDOW_MS) / 1000));

  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({
      error: 'Too Many Requests',
      retryAfterMs: RATE_LIMIT_WINDOW_MS - (now - entry.windowStart),
    });
  }
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitStore.delete(ip);
    }
  }
}, 120_000);

const app = express();

app.use(express.json({ limit: '256kb' }));
app.use('/dashboard-assets', express.static(path.join(__dirname, '..', 'public')));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Request-Id');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);

  const start = Date.now();
  res.on('finish', () => {
    log.info(
      JSON.stringify({
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - start,
      })
    );
  });
  next();
});

app.use('/verify', rateLimit);
app.use('/monitor', rateLimit);

app.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    ...SKILL_META,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    network: {
      name: CHAINS.pharosMainnet.name,
      chainId: CHAINS.pharosMainnet.id,
      ccipRouter: CCIP_ROUTER_ADDRESS,
    },
  };

  if (req.query.deep === 'true') {
    try {
      const client = createPharosClient();
      const start = Date.now();
      const blockNumber = await withTimeout(
        () => client.getBlockNumber(),
        8_000,
        'health-deep-check'
      );
      health.rpcReachable = true;
      health.latestBlock = Number(blockNumber);
      health.rpcLatencyMs = Date.now() - start;
    } catch (err) {
      health.rpcReachable = false;
      health.rpcError = err.message;
      health.status = 'degraded';
    }
  }

  res.json(health);
});

async function executeOracle(params, requestId) {
  const {
    vault,
    wallet,
    fallback,
    targets,
    destinations,
    toleranceBps,
    sourceTx,
    messageId,
    ccipLookback,
    historyPath,
    noHistory,
  } = params;

  const result = await runOracle(vault, {
    walletAddress: wallet || undefined,
    useFallback: fallback === 'true' || fallback === true,
    destinationSource: targets || destinations || undefined,
    toleranceBps: toleranceBps !== undefined ? Number(toleranceBps) : undefined,
    sourceTx: sourceTx || undefined,
    messageId: messageId || undefined,
    ccipLookbackBlocks:
      ccipLookback !== undefined ? Number(ccipLookback) : undefined,
    historyPath: historyPath || undefined,
    recordHistory: (noHistory === 'true' || noHistory === true) ? false : undefined,
  });

  result.requestId = requestId;
  return result;
}

function validateVault(vault, res) {
  if (!vault) {
    res.status(400).json({
      error: 'Missing required parameter: vault',
      example: `/verify?vault=${DEMO_VAULT_ADDRESS}`,
    });
    return false;
  }
  if (!isValidAddress(vault)) {
    res.status(400).json({
      error: 'Invalid vault address format',
      received: vault,
      expected: '0x followed by 40 hex characters',
    });
    return false;
  }
  return true;
}

app.get('/verify', async (req, res) => {
  const { vault, wallet, pretty } = req.query;

  if (!validateVault(vault, res)) return;

  if (wallet && !isValidAddress(wallet)) {
    return res.status(400).json({
      error: 'Invalid wallet address format',
      received: wallet,
    });
  }

  try {
    const result = await executeOracle(req.query, req.requestId);
    const usePretty = pretty === 'true';
    res
      .status(200)
      .type('application/json')
      .send(toJSON(result, usePretty));
  } catch (err) {
    log.error('Oracle execution failed:', err.message);
    res.status(err.statusCode || 500).json({
      error: 'Oracle execution failed',
      message: err.message,
      requestId: req.requestId,
      ...SKILL_META,
      timestamp: new Date().toISOString(),
    });
  }
});

app.post('/verify', async (req, res) => {
  const { vault, wallet, pretty } = req.body;

  if (!validateVault(vault, res)) return;

  if (wallet && !isValidAddress(wallet)) {
    return res.status(400).json({
      error: 'Invalid wallet address format',
      received: wallet,
    });
  }

  try {
    const result = await executeOracle(req.body, req.requestId);
    const usePretty = pretty === true || pretty === 'true';
    res
      .status(200)
      .type('application/json')
      .send(toJSON(result, usePretty));
  } catch (err) {
    log.error('Oracle execution failed:', err.message);
    res.status(err.statusCode || 500).json({
      error: 'Oracle execution failed',
      message: err.message,
      requestId: req.requestId,
      ...SKILL_META,
      timestamp: new Date().toISOString(),
    });
  }
});

app.post('/verify/batch', async (req, res) => {
  const { vaults, targets, destinations, toleranceBps } = req.body;

  if (!Array.isArray(vaults) || vaults.length === 0) {
    return res.status(400).json({
      error: 'Missing required field: vaults (array of addresses)',
    });
  }

  if (vaults.length > 20) {
    return res.status(400).json({
      error: 'Maximum 20 vaults per batch request',
    });
  }

  const invalid = vaults.filter((v) => !isValidAddress(v));
  if (invalid.length > 0) {
    return res.status(400).json({
      error: 'Invalid vault addresses',
      invalid,
    });
  }

  try {
    const results = await Promise.all(
      vaults.map((vault) =>
        executeOracle(
          { vault, targets, destinations, toleranceBps, noHistory: 'true' },
          req.requestId
        ).catch((err) => ({
          vault,
          error: err.message,
          ...SKILL_META,
        }))
      )
    );

    const verdicts = results.map((r) => r.intelligence?.verdict).filter(Boolean);
    const worstVerdict = verdicts.includes('STOP')
      ? 'STOP'
      : verdicts.includes('CAUTION')
        ? 'CAUTION'
        : 'GO';

    const scores = results.map((r) => r.intelligence?.confidenceScore).filter((s) => typeof s === 'number');
    const avgConfidence = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0;

    res.json({
      ...SKILL_META,
      requestId: req.requestId,
      timestamp: new Date().toISOString(),
      portfolio: {
        vaultCount: vaults.length,
        worstVerdict,
        averageConfidence: avgConfidence,
        verdictBreakdown: {
          GO: verdicts.filter((v) => v === 'GO').length,
          CAUTION: verdicts.filter((v) => v === 'CAUTION').length,
          STOP: verdicts.filter((v) => v === 'STOP').length,
        },
      },
      results,
    });
  } catch (err) {
    log.error('Batch verification failed:', err.message);
    res.status(500).json({
      error: 'Batch verification failed',
      message: err.message,
      requestId: req.requestId,
    });
  }
});

const monitorClients = new Set();

app.get('/monitor', (req, res) => {
  const vault = req.query.vault;
  if (!vault || !isValidAddress(vault)) {
    return res.status(400).json({ error: 'Valid vault address required' });
  }

  const intervalSec = Math.max(15, Math.min(300, Number(req.query.interval) || 30));

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.write(`data: ${JSON.stringify({ type: 'connected', vault, intervalSec })}\n\n`);

  const clientId = crypto.randomUUID();
  let running = true;

  const client = { id: clientId, res, vault };
  monitorClients.add(client);

  log.info(`Monitor stream started: ${clientId} for vault ${vault} every ${intervalSec}s`);

  async function tick() {
    if (!running) return;
    try {
      const result = await runOracle(vault, {
        recordHistory: false,
        destinationSource: req.query.targets || undefined,
      });
      if (running) {
        res.write(`data: ${JSON.stringify({ type: 'result', result })}\n\n`);
      }
    } catch (err) {
      if (running) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      }
    }
  }

  tick();
  const timer = setInterval(tick, intervalSec * 1000);

  req.on('close', () => {
    running = false;
    clearInterval(timer);
    monitorClients.delete(client);
    log.info(`Monitor stream ended: ${clientId}`);
  });
});

app.get('/dashboard', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.get('/', (req, res) => {
  res.json({
    ...SKILL_META,
    description:
      'A read-only Pharos Agent Center skill that verifies cross-chain RWA distributions using Chainlink CCIP.',
    endpoints: {
      health: 'GET /health',
      healthDeep: 'GET /health?deep=true',
      verify: `GET /verify?vault=${DEMO_VAULT_ADDRESS}`,
      verifyPost: 'POST /verify { vault, wallet?, targets?, toleranceBps? }',
      batch: 'POST /verify/batch { vaults: [...], targets?, toleranceBps? }',
      monitor: `GET /monitor?vault=${DEMO_VAULT_ADDRESS}&interval=30`,
      dashboard: 'GET /dashboard',
    },
    demoVault: DEMO_VAULT_ADDRESS,
    network: {
      name: CHAINS.pharosMainnet.name,
      chainId: CHAINS.pharosMainnet.id,
      rpc: CHAINS.pharosMainnet.rpc,
      ccipRouter: CCIP_ROUTER_ADDRESS,
    },
    documentation: 'See SKILL.md for full documentation and triggers.',
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    availableEndpoints: [
      'GET /',
      'GET /health',
      'GET /verify?vault=0x...',
      'POST /verify',
      'POST /verify/batch',
      'GET /monitor?vault=0x...',
      'GET /dashboard',
    ],
  });
});

app.use((err, req, res, _next) => {
  log.error('Unhandled error:', err.message);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message,
    requestId: req.requestId,
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log('');
    console.log('  ⬡ Pharos Cross-Chain RWA Distribution Oracle');
    console.log('  ─────────────────────────────────────────────');
    console.log(`  Server:     http://localhost:${PORT}`);
    console.log(`  Health:     http://localhost:${PORT}/health`);
    console.log(`  Deep Check: http://localhost:${PORT}/health?deep=true`);
    console.log(
      `  Verify:     http://localhost:${PORT}/verify?vault=${DEMO_VAULT_ADDRESS}`
    );
    console.log(`  Dashboard:  http://localhost:${PORT}/dashboard`);
    console.log(
      `  Monitor:    http://localhost:${PORT}/monitor?vault=${DEMO_VAULT_ADDRESS}`
    );
    console.log(`  Network:    ${CHAINS.pharosMainnet.name} (${CHAINS.pharosMainnet.id})`);
    console.log(`  CCIP Router: ${CCIP_ROUTER_ADDRESS}`);
    console.log('');
  });
}

module.exports = { app, runOracle };
