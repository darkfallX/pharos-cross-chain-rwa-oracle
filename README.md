# Pharos Cross-Chain RWA Distribution Oracle

[![Version](https://img.shields.io/badge/version-2.0.0-blue)](package.json)
[![License](https://img.shields.io/badge/license-MIT--0-green)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)
[![Pharos](https://img.shields.io/badge/Pharos-Agent%20Center-purple)](https://pharos.xyz)

A heavy, intelligent, read-only Pharos Agent Center oracle for checking whether an RWA vault or tokenized asset is safe to treat as synced across chains.

It does not sign, send transactions, load private keys, or require API keys. It reads Pharos and optional destination-chain state, then returns an agent-ready verdict with proof, risk flags, confidence scoring, and recommended next actions.

## Why This Skill?

- **Pre-flight risk guardrail** — An agent calls this before distributing RWA capital across chains. If anything is wrong, the oracle says STOP.
- **Cryptographic proof receipts** — Every run generates a SHA-256 proof hash and passport that can be audited later.
- **Intelligent, not just informational** — Context-aware agent plans with urgency levels, rerun intervals, and human escalation triggers.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CLI / HTTP API / SSE Monitor              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────┐   ┌──────────┐   ┌─────────────────────────┐  │
│  │  Oracle  │──▶│ CCIP.js  │──▶│  Pharos CCIP Router     │  │
│  │  Core    │   │          │   │  typeAndVersion / lanes  │  │
│  │          │   └──────────┘   └─────────────────────────┘  │
│  │          │                                               │
│  │          │   ┌──────────┐   ┌─────────────────────────┐  │
│  │          │──▶│ Vault.js │──▶│  ERC-20 / ERC-4626      │  │
│  │          │   │          │   │  totalSupply / assets    │  │
│  │          │   └──────────┘   └─────────────────────────┘  │
│  │          │                                               │
│  │          │   ┌──────────────────────────────────────┐    │
│  │          │──▶│ Security Analysis                    │    │
│  │          │   │ · Proxy detection (EIP-1967)         │    │
│  │          │   │ · Paused state check                 │    │
│  │          │   │ · Ownership audit                    │    │
│  │          │   │ · Decimal mismatch detection         │    │
│  │          │   └──────────────────────────────────────┘    │
│  │          │                                               │
│  │          │   ┌──────────────┐   ┌──────────────────┐     │
│  │          │──▶│ Destinations │──▶│  Cross-chain     │     │
│  │          │   │              │   │  ERC-20 reads    │     │
│  │          │   └──────────────┘   └──────────────────┘     │
│  └────┬─────┘                                               │
│       │                                                     │
│       ▼                                                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Intelligence → Anomalies → Planner → Proof/Passport │   │
│  │  GO / CAUTION / STOP  ·  Confidence 0-100            │   │
│  │  Urgency  ·  Rerun Interval  ·  Human Escalation     │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## What It Does

- Verifies the canonical Pharos vault/token contract exists.
- Verifies the official Chainlink CCIP router on Pharos is reachable.
- **Deep security analysis**: proxy detection, paused state, ownership audit, decimal mismatches.
- Optionally checks configured destination chains and CCIP lane support.
- Compares raw ERC-20 `totalSupply`, ERC-4626 `totalAssets`, and wallet balances when available.
- Calculates drift in basis points against a configurable tolerance.
- Returns `GO`, `CAUTION`, or `STOP` through the `intelligence` envelope.
- **Context-aware agent planning** with urgency, rerun intervals, dependencies, and human escalation.
- Generates an oracle passport and proof hash for audit-ready receipts.
- Records local history and flags regressions, supply jumps, bytecode changes, proxy upgrades, and owner changes.
- **Batch verification** for multi-vault portfolio risk assessment.
- **SSE real-time monitoring** for continuous vault surveillance.
- Serves a premium demo dashboard at `/dashboard`.
- Returns a `proof` object with source block, destination blocks, contracts checked, comparisons, lane evidence, and issues.

## Quick Start

```bash
npm install
npm run demo
```

Or run directly:

```bash
node src/cli.js 0xC879C018dB60520F4355C26eD1a6D572cdAC1815
```

Machine-readable output:

```bash
node src/cli.js 0xC879C018dB60520F4355C26eD1a6D572cdAC1815 --json --pretty
```

Cross-chain proof using the included self-check target:

```bash
node src/cli.js 0xC879C018dB60520F4355C26eD1a6D572cdAC1815 --targets ./destinations.example.json --json --pretty
```

## Docker

```bash
cp .env.example .env   # optional — works without it
docker compose up
```

Or build and run manually:

```bash
docker build -t pharos-rwa-oracle .
docker run -p 3000:3000 pharos-rwa-oracle
```

## CLI

```bash
node src/cli.js <vault-address> [options]
```

| Flag | Description |
| --- | --- |
| `--wallet, -w <addr>` | Compare a wallet's vault/token balance when destination targets are configured |
| `--json, -j` | Output compact JSON |
| `--pretty, -p` | Pretty-print JSON output |
| `--fallback, -f` | Use Pharos Atlantic Testnet as the source network |
| `--targets, --destinations, -d <json-or-file>` | Destination target JSON array or path |
| `--tolerance-bps <bps>` | Maximum allowed raw amount drift, default `10` |
| `--source-tx <hash>` | Source transaction hash for CCIP message proof |
| `--message-id <id>` | CCIP message id to search for |
| `--ccip-lookback <blocks>` | Recent on-ramp log scan window, default `2000` |
| `--history-path <file>` | JSONL history file path |
| `--no-history` | Disable local history recording |
| `--help, -h` | Show CLI help |

## HTTP API

Start the server:

```bash
npm start
```

### Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Lightweight liveness check |
| GET | `/health?deep=true` | RPC readiness probe with block number and latency |
| GET | `/verify?vault=0x...` | Single vault verification |
| POST | `/verify` | Verification with JSON body |
| POST | `/verify/batch` | Multi-vault portfolio verification |
| GET | `/monitor?vault=0x...&interval=30` | SSE real-time monitoring stream |
| GET | `/dashboard` | Interactive web dashboard |

### Single Verify

```bash
curl "http://localhost:3000/verify?vault=0xC879C018dB60520F4355C26eD1a6D572cdAC1815&pretty=true"
```

### POST Verify (for complex configs)

```bash
curl -X POST http://localhost:3000/verify \
  -H "Content-Type: application/json" \
  -d '{
    "vault": "0xC879C018dB60520F4355C26eD1a6D572cdAC1815",
    "targets": [{"id": "base-usdc", "chainId": 8453, "rpc": "https://mainnet.base.org", "address": "0x..."}],
    "toleranceBps": 10,
    "pretty": true
  }'
```

### Batch Verify

```bash
curl -X POST http://localhost:3000/verify/batch \
  -H "Content-Type: application/json" \
  -d '{
    "vaults": [
      "0xC879C018dB60520F4355C26eD1a6D572cdAC1815",
      "0x1234567890abcdef1234567890abcdef12345678"
    ]
  }'
```

### Real-Time Monitoring (SSE)

```bash
curl -N "http://localhost:3000/monitor?vault=0xC879C018dB60520F4355C26eD1a6D572cdAC1815&interval=30"
```

## Destination Targets

Destination targets can be passed as inline JSON, a file path, or `ORACLE_DESTINATIONS`.
Replace the zero address below with the deployed destination vault or token address.

```json
[
  {
    "id": "base-usdc",
    "name": "Base USDC Vault",
    "chainId": 8453,
    "rpc": "https://mainnet.base.org",
    "address": "0x0000000000000000000000000000000000000000",
    "ccipSelector": "15971525489660198786",
    "toleranceBps": 10,
    "nativeCurrency": {
      "name": "Ether",
      "symbol": "ETH",
      "decimals": 18
    },
    "blockExplorer": "https://basescan.org"
  }
]
```

`ccipSelector` is optional. If it is omitted, the oracle still reads destination state but marks lane proof as incomplete.

## Result Shape

Every result keeps the original source-chain fields and adds the intelligent oracle envelope:

```json
{
  "skill": "pharos-cross-chain-rwa-distribution-oracle",
  "version": "2.0.0",
  "distribution": {
    "syncStatus": "SYNCED",
    "coverage": "CROSS_CHAIN",
    "destinationCount": 1,
    "syncedDestinationCount": 1
  },
  "intelligence": {
    "verdict": "GO",
    "confidenceScore": 100,
    "riskLevel": "LOW",
    "summary": "All configured oracle checks passed within tolerance.",
    "checks": [],
    "riskFlags": [],
    "recommendations": []
  },
  "securityAnalysis": {
    "proxy": { "isProxy": false, "implementationAddress": null },
    "pausable": { "hasPausable": false, "isPaused": false },
    "ownership": { "owner": "0x...", "ownerCodeSize": 0 }
  },
  "crossChain": {
    "enabled": true,
    "targetCount": 1,
    "syncedTargetCount": 1,
    "destinations": []
  },
  "proof": {
    "generatedAt": "2026-06-06T00:00:00.000Z",
    "toleranceBps": 10,
    "source": {},
    "destinations": [],
    "ccipMessageProof": {
      "status": "UNAVAILABLE"
    }
  },
  "passport": {
    "passportId": "sha256:...",
    "proofHash": "sha256:...",
    "validUntil": "2026-06-06T00:05:00.000Z",
    "ttlMinutes": 5
  },
  "history": {
    "enabled": true,
    "sampleCount": 3,
    "trend": {}
  },
  "anomalies": [],
  "agentPlan": {
    "action": "PROCEED_READ_ONLY",
    "urgency": "ROUTINE",
    "reason": "All configured checks passed within tolerance.",
    "suggestedRerunInterval": "300s",
    "dependencies": [],
    "humanEscalation": false,
    "safeNextSteps": []
  }
}
```

## Verdicts

| Verdict | Meaning |
| --- | --- |
| `GO` | All configured critical checks passed within tolerance |
| `CAUTION` | Source checks passed, but coverage is incomplete or warnings require review |
| `STOP` | A critical integrity issue was found |

## Agent Plan Urgency

| Urgency | Meaning |
| --- | --- |
| `IMMEDIATE` | Critical failure — stop automated actions now |
| `WITHIN_1H` | Warnings present — review before proceeding |
| `ROUTINE` | All clear — normal operations |

## Sync Status

| Status | Meaning |
| --- | --- |
| `SYNCED` | Source checks pass and all configured destination targets are within tolerance |
| `PARTIAL` | Useful evidence exists, but some reads, lanes, or comparisons are incomplete |
| `DESYNC` | A critical source or destination integrity check failed |
| `UNKNOWN` | The oracle could not determine state |

## Project Structure

```text
src/index.js          Express server, API endpoints, SSE monitor, rate limiter
src/cli.js            CLI entry point
src/oracle.js         Verification pipeline and result assembly
src/intelligence.js   Drift checks, risk flags, confidence scoring, verdicts
src/anomalies.js      Historical, structural, and security anomaly detection
src/planner.js        Context-aware agent action planning
src/destinations.js   Destination target parsing and validation
src/presets.js        Chain target presets such as base:0x..., ethereum:0x...
src/proof.js          Stable proof hashing and oracle passports
src/history.js        Local JSONL history and trend summaries
src/ccipProof.js      CCIP source tx/message and lane activity evidence
src/ccip.js           CCIP router and lane reads
src/vault.js          ERC-20/ERC-4626 state reads
src/retry.js          Timeout/retry helpers
src/validation.js     Shared address validation
src/formatter.js      Pretty terminal and JSON formatting
src/abi.js            ABI fragments for on-chain reads
src/chains.js         Chain configuration registry
public/               Dashboard UI (dark-mode, glassmorphism, animated)
test/oracle.test.js   Unit and live integration tests
Dockerfile            Production Docker image
docker-compose.yml    One-command local deployment
```

## Environment

| Variable | Default | Description |
| --- | --- | --- |
| `PHAROS_RPC_URL` | `https://rpc.pharos.xyz` | Source Pharos RPC |
| `PHAROS_TESTNET_RPC_URL` | `https://atlantic.dplabs-internal.com` | Fallback RPC |
| `ORACLE_DESTINATIONS` | empty | Inline JSON or file path for destination targets |
| `ORACLE_HISTORY_PATH` | `.oracle-history.jsonl` | Local history JSONL path |
| `PORT` | `3000` | HTTP server port |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error` |

## Testing

```bash
npm test
```

The test suite includes pure risk/scoring tests and live Pharos integration checks against the demo contract.

## Security

- No private keys.
- No wallet client.
- No transactions.
- No API keys.
- Read-only `viem` public clients only.
- Rate-limited API endpoints with `X-RateLimit-*` headers.
- Security headers: `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`.
- Deep on-chain security analysis: proxy detection, pause state, ownership audit.
- Correlation IDs (`X-Request-Id`) for request tracing.

## Campaign Positioning

This skill is designed as a pre-flight risk guardrail for AI agents before they act on cross-chain RWA distribution data. It is intentionally conservative: without destination evidence it returns `CAUTION`, and with failed integrity evidence it returns `STOP`. It can prove what it checked, explain what it could not prove, and refuse unsafe assumptions.

Demo contract: `0xC879C018dB60520F4355C26eD1a6D572cdAC1815`
