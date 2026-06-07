---
name: pharos-cross-chain-rwa-distribution-oracle
version: 2.0.0
description: >
  A heavy read-only Pharos Agent Center oracle that checks cross-chain RWA
  distribution integrity with CCIP evidence, destination-chain reads, drift
  scoring, proof passports, history, anomaly detection, proxy/pause security
  analysis, batch verification, real-time SSE monitoring, and intelligent
  GO/CAUTION/STOP recommendations with context-aware agent planning.
author: Pharos Skill Builder
license: MIT-0
tags:
  - pharos
  - rwa
  - cross-chain
  - ccip
  - chainlink
  - oracle
  - realfi
  - defi
  - distribution
  - verification
  - risk
  - security
  - monitoring
  - batch
platform: pharos-agent-center
runtime: node
entry: src/index.js
triggers:
  - "Check cross-chain distribution status of this RWA vault 0x..."
  - "Should my agent proceed with this RWA vault distribution?"
  - "Verify unified truth for RWA 0x... across Pharos and Ethereum"
  - "Give me the canonical RWA position for wallet 0x... with CCIP verification"
  - "Run the intelligent Pharos RWA oracle on vault 0x..."
  - "Return a GO CAUTION or STOP verdict for this cross-chain RWA"
  - "Monitor this vault continuously and alert me on drift"
  - "Batch verify these RWA vaults and give me a portfolio risk summary"
  - "Is this vault a proxy? Check the security posture of 0x..."
---

# Pharos Cross-Chain RWA Distribution Oracle

This is an intelligent, read-only Pharos Agent Center skill for checking whether an RWA vault or tokenized asset is safe for an AI agent to treat as synced across chains.

It never signs, sends transactions, loads private keys, or requires API keys. It reads on-chain state and returns a structured decision envelope for autonomous agents.

## Features

- Read-only Pharos source-chain verification.
- Chainlink CCIP router reachability checks.
- Optional CCIP destination lane checks.
- Optional destination-chain ERC-20/ERC-4626 state comparison.
- Raw amount drift calculation in basis points.
- Optional wallet balance comparison.
- `GO`, `CAUTION`, or `STOP` intelligent verdict.
- Confidence score, risk level, risk flags, and recommended next actions.
- **Deep security analysis**: proxy detection (EIP-1967), paused state, ownership analysis, decimal mismatch.
- **Context-aware agent planner** with urgency levels, rerun intervals, dependencies, and human escalation.
- Proof object with source block, destination blocks, lane evidence, comparisons, and issues.
- Oracle passport with stable proof hash and configurable validity window.
- Local JSONL history, trend summary, and anomaly detection.
- Chain presets such as `base:0x...`, `ethereum:0x...`, and `arbitrum:0x...`.
- **Batch verification** for multi-vault portfolio risk assessment.
- **SSE real-time monitoring** for continuous vault surveillance.
- **POST API** for complex destination configurations.
- **Rate limiting** and security headers.
- Dashboard at `/dashboard`.
- CLI and HTTP API.
- Docker ready.

## Quick Start

```bash
npm install
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

## CLI Options

| Flag | Description |
| --- | --- |
| `--wallet, -w <addr>` | Compare wallet balance when targets are configured |
| `--json, -j` | Output compact JSON |
| `--pretty, -p` | Pretty-print JSON |
| `--fallback, -f` | Use Pharos Atlantic Testnet source |
| `--targets, --destinations, -d <json-or-file>` | Destination target JSON array or path |
| `--tolerance-bps <bps>` | Allowed drift, default `10` |
| `--source-tx <hash>` | Source transaction hash for CCIP proof scan |
| `--message-id <id>` | CCIP message id to search for |
| `--ccip-lookback <blocks>` | Recent on-ramp log scan window |
| `--history-path <file>` | JSONL history file path |
| `--no-history` | Disable local history recording |
| `--help, -h` | Show help |

## HTTP API

```bash
npm start
```

- `GET /health` — liveness check
- `GET /health?deep=true` — RPC readiness probe with latency
- `GET /verify?vault=0x...` — single vault verification
- `POST /verify` — verification with JSON body (better for complex configs)
- `POST /verify/batch` — multi-vault portfolio verification
- `GET /monitor?vault=0x...&interval=30` — SSE real-time monitoring
- `GET /dashboard` — interactive web dashboard

## Destination Target Shape

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

`ccipSelector` is optional. Without it, the oracle still reads destination state but marks lane proof as incomplete.

## JSON Envelope

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
    "destinations": []
  },
  "proof": {
    "generatedAt": "2026-06-06T00:00:00.000Z",
    "toleranceBps": 10,
    "source": {},
    "destinations": [],
    "ccipMessageProof": { "status": "UNAVAILABLE" }
  },
  "passport": {
    "passportId": "sha256:...",
    "proofHash": "sha256:...",
    "ttlMinutes": 5
  },
  "history": {
    "enabled": true,
    "sampleCount": 3
  },
  "anomalies": [],
  "agentPlan": {
    "action": "PROCEED_READ_ONLY",
    "urgency": "ROUTINE",
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
| `CAUTION` | Evidence is useful, but coverage or warnings require review |
| `STOP` | A critical source, lane, or destination integrity check failed |

## Security

- No private keys.
- No wallet client.
- No signed transactions.
- No API keys.
- Read-only `viem` public clients only.
- Rate limited API endpoints.
- Security headers on all responses.
- Deep security analysis: proxy detection, pause state, ownership audit.

## Campaign Positioning

This skill acts as a pre-flight RWA risk guardrail for AI agents. It can prove what it checked, explain what it could not prove, and refuse unsafe cross-chain distribution assumptions with a `STOP` verdict.

Demo contract: `0xC879C018dB60520F4355C26eD1a6D572cdAC1815`
