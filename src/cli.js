require('dotenv').config();

const { runOracle } = require('./oracle');
const { prettyPrint, toJSON, c } = require('./formatter');
const { DEMO_VAULT_ADDRESS } = require('./chains');
const { isValidAddress } = require('./validation');

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    vaultAddress: null,
    walletAddress: null,
    jsonOutput: false,
    prettyJson: false,
    help: false,
    fallback: false,
    destinationSource: null,
    toleranceBps: undefined,
    messageId: null,
    sourceTx: null,
    ccipLookbackBlocks: undefined,
    recordHistory: true,
    historyPath: undefined,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--json' || arg === '-j') {
      opts.jsonOutput = true;
    } else if (arg === '--pretty' || arg === '-p') {
      opts.prettyJson = true;
    } else if (arg === '--fallback' || arg === '-f') {
      opts.fallback = true;
    } else if ((arg === '--targets' || arg === '--destinations' || arg === '-d') && args[i + 1]) {
      opts.destinationSource = args[++i];
    } else if ((arg === '--tolerance-bps' || arg === '--tolerance') && args[i + 1]) {
      opts.toleranceBps = Number(args[++i]);
    } else if (arg === '--message-id' && args[i + 1]) {
      opts.messageId = args[++i];
    } else if (arg === '--source-tx' && args[i + 1]) {
      opts.sourceTx = args[++i];
    } else if (arg === '--ccip-lookback' && args[i + 1]) {
      opts.ccipLookbackBlocks = Number(args[++i]);
    } else if (arg === '--history-path' && args[i + 1]) {
      opts.historyPath = args[++i];
    } else if (arg === '--no-history') {
      opts.recordHistory = false;
    } else if ((arg === '--wallet' || arg === '-w') && args[i + 1]) {
      opts.walletAddress = args[++i];
    } else if (arg.startsWith('0x')) {
      opts.vaultAddress = arg;
    }
  }

  return opts;
}

function printHelp() {
  console.log(`
${c.cyan}${c.bold}⬡ Pharos Cross-Chain RWA Distribution Oracle${c.reset}
${c.dim}──────────────────────────────────────────────────────${c.reset}

${c.bold}USAGE:${c.reset}
  node src/cli.js <vault-address> [options]

${c.bold}ARGUMENTS:${c.reset}
  ${c.green}<vault-address>${c.reset}    RWA vault contract address (0x...)
                      Default: ${c.dim}${DEMO_VAULT_ADDRESS}${c.reset}

${c.bold}OPTIONS:${c.reset}
  ${c.yellow}--wallet, -w${c.reset}  <address>   Check a specific wallet's position
  ${c.yellow}--json, -j${c.reset}               Output raw JSON (compact)
  ${c.yellow}--pretty, -p${c.reset}             Pretty-print JSON output
  ${c.yellow}--fallback, -f${c.reset}           Use Pharos Atlantic Testnet
  ${c.yellow}--targets, -d${c.reset} <json|file> Destination chain targets for cross-chain proof
  ${c.yellow}--tolerance-bps${c.reset} <bps>    Allowed raw amount drift (default: 10)
  ${c.yellow}--source-tx${c.reset} <hash>        Source transaction hash for CCIP proof scan
  ${c.yellow}--message-id${c.reset} <id>         CCIP message id to search for
  ${c.yellow}--ccip-lookback${c.reset} <blocks>  Recent on-ramp log scan window (default: 2000)
  ${c.yellow}--history-path${c.reset} <file>     JSONL history file path
  ${c.yellow}--no-history${c.reset}              Disable local history recording
  ${c.yellow}--help, -h${c.reset}               Show this help message

${c.bold}EXAMPLES:${c.reset}
  ${c.dim}# Verify the demo vault${c.reset}
  node src/cli.js ${DEMO_VAULT_ADDRESS}

  ${c.dim}# Output as pretty JSON${c.reset}
  node src/cli.js ${DEMO_VAULT_ADDRESS} --json --pretty

  ${c.dim}# Check a wallet's position in the vault${c.reset}
  node src/cli.js ${DEMO_VAULT_ADDRESS} --wallet 0xYourWallet...

  ${c.dim}# Compare against configured destination chains${c.reset}
  node src/cli.js ${DEMO_VAULT_ADDRESS} --targets ./destinations.example.json --json --pretty

  ${c.dim}# Use testnet fallback${c.reset}
  node src/cli.js ${DEMO_VAULT_ADDRESS} --fallback
`);
}


async function main() {
  const opts = parseArgs(process.argv);

  // Show help
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const vaultAddress = opts.vaultAddress || DEMO_VAULT_ADDRESS;


  if (!isValidAddress(vaultAddress)) {
    console.error(
      `\n${c.red}${c.bold}  ✗ Invalid vault address:${c.reset} ${vaultAddress}`
    );
    console.error(
      `${c.dim}  Expected format: 0x followed by 40 hex characters${c.reset}\n`
    );
    process.exit(1);
  }

  if (opts.walletAddress && !isValidAddress(opts.walletAddress)) {
    console.error(
      `\n${c.red}${c.bold}  ✗ Invalid wallet address:${c.reset} ${opts.walletAddress}\n`
    );
    process.exit(1);
  }


  if (!opts.jsonOutput) {
    console.log(`\n${c.dim}  Connecting to Pharos...${c.reset}`);
  }

  try {

    const result = await runOracle(vaultAddress, {
      walletAddress: opts.walletAddress,
      useFallback: opts.fallback,
      destinationSource: opts.destinationSource,
      toleranceBps: opts.toleranceBps,
      messageId: opts.messageId,
      sourceTx: opts.sourceTx,
      ccipLookbackBlocks: opts.ccipLookbackBlocks,
      recordHistory: opts.recordHistory,
      historyPath: opts.historyPath,
    });


    if (opts.jsonOutput) {
      console.log(toJSON(result, opts.prettyJson));
    } else {
      prettyPrint(result);

      // Also print compact JSON below the pretty output
      console.log(`${c.dim}  ─── Machine-Readable JSON ──────────────────────${c.reset}`);
      console.log(`${c.dim}  ${toJSON(result)}${c.reset}`);
      console.log('');
    }


    if (result.distribution.syncStatus === 'DESYNC' || result.intelligence?.verdict === 'STOP') {
      process.exit(2);
    }
  } catch (err) {
    console.error(`\n${c.red}${c.bold}  ✗ Oracle Error:${c.reset} ${err.message}`);

    if (opts.jsonOutput) {
      console.log(
        toJSON(
          {
            skill: 'pharos-cross-chain-rwa-distribution-oracle',
            version: '2.0.0',
            timestamp: new Date().toISOString(),
            vault: vaultAddress,
            error: err.message,
            distribution: { syncStatus: 'UNKNOWN' },
          },
          opts.prettyJson
        )
      );
    }

    process.exit(1);
  }
}

main();
