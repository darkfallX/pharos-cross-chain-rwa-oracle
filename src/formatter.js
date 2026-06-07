const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  white: '\x1b[37m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
};

function shortAddr(addr) {
  if (!addr || addr.length < 10) return addr || '—';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function statusBadge(status) {
  switch (status) {
    case 'SYNCED':
      return `${c.bgGreen}${c.bold}${c.white} ✓ SYNCED ${c.reset}`;
    case 'DESYNC':
      return `${c.bgRed}${c.bold}${c.white} ✗ DESYNC ${c.reset}`;
    case 'PARTIAL':
      return `${c.bgYellow}${c.bold}${c.white} ◐ PARTIAL ${c.reset}`;
    case 'UNKNOWN':
      return `${c.bgBlue}${c.bold}${c.white} ? UNKNOWN ${c.reset}`;
    default:
      return `${c.dim}${status}${c.reset}`;
  }
}

function divider(char = '─', width = 60) {
  return `${c.dim}${char.repeat(width)}${c.reset}`;
}

function row(label, value, color = c.white) {
  const labelStr = `  ${c.dim}${label}${c.reset}`;
  const dots = '.'.repeat(Math.max(2, 40 - label.length));
  return `${labelStr} ${c.dim}${dots}${c.reset} ${color}${value}${c.reset}`;
}

function prettyPrint(result) {
  const lines = [];


  lines.push('');
  lines.push(divider('═', 60));
  lines.push(
    `  ${c.cyan}${c.bold}⬡ Pharos Cross-Chain RWA Distribution Oracle${c.reset}`
  );
  lines.push(divider('═', 60));
  lines.push('');


  lines.push(`  ${c.magenta}${c.bold}▸ Skill Info${c.reset}`);
  lines.push(divider());
  lines.push(row('Skill', result.skill));
  lines.push(row('Version', result.version));
  lines.push(row('Timestamp', result.timestamp));
  lines.push('');


  lines.push(`  ${c.magenta}${c.bold}▸ Network${c.reset}`);
  lines.push(divider());
  lines.push(row('Name', result.network.name, c.cyan));
  lines.push(row('Chain ID', result.network.chainId.toString(), c.cyan));
  lines.push(row('RPC', result.network.rpc, c.dim));
  lines.push('');


  lines.push(`  ${c.magenta}${c.bold}▸ Chainlink CCIP Router${c.reset}`);
  lines.push(divider());
  lines.push(row('Address', shortAddr(result.ccipRouter.address), c.cyan));
  lines.push(
    row(
      'Reachable',
      result.ccipRouter.reachable ? `${c.green}YES` : `${c.red}NO`
    )
  );
  if (result.ccipRouter.typeAndVersion) {
    lines.push(
      row('Type & Version', result.ccipRouter.typeAndVersion, c.green)
    );
  }
  if (result.ccipRouter.codeSize) {
    lines.push(
      row('Code Size', `${result.ccipRouter.codeSize.toLocaleString()} bytes`)
    );
  }
  lines.push('');


  lines.push(`  ${c.magenta}${c.bold}▸ Vault State${c.reset}`);
  lines.push(divider());
  lines.push(row('Address', shortAddr(result.vault), c.cyan));
  lines.push(
    row(
      'Contract Exists',
      result.vault_state.exists ? `${c.green}YES` : `${c.red}NO`
    )
  );

  if (result.vault_state.exists) {
    lines.push(
      row('Code Size', `${result.vault_state.codeSize.toLocaleString()} bytes`)
    );
    lines.push(row('Native Balance', `${result.vault_state.balance} GAS`));

    if (result.vault_state.tokenName) {
      lines.push(row('Token Name', result.vault_state.tokenName, c.green));
    }
    if (result.vault_state.tokenSymbol) {
      lines.push(row('Token Symbol', result.vault_state.tokenSymbol, c.green));
    }
    if (result.vault_state.decimals !== null) {
      lines.push(row('Decimals', result.vault_state.decimals.toString()));
    }
    if (result.vault_state.totalSupply !== null) {
      lines.push(
        row('Total Supply', result.vault_state.totalSupply, c.yellow)
      );
    }

    // ERC-4626 fields
    if (result.vault_state.isERC4626) {
      lines.push(row('Vault Standard', 'ERC-4626', c.green));
      if (result.vault_state.underlyingAsset) {
        lines.push(
          row(
            'Underlying Asset',
            shortAddr(result.vault_state.underlyingAsset),
            c.cyan
          )
        );
      }
      if (result.vault_state.totalAssets !== null) {
        lines.push(
          row('Total Assets', result.vault_state.totalAssets, c.yellow)
        );
      }
    } else if (result.vault_state.isERC20) {
      lines.push(row('Token Standard', 'ERC-20', c.blue));
    }
  }
  lines.push('');


  lines.push(`  ${c.magenta}${c.bold}▸ Distribution Verdict${c.reset}`);
  lines.push(divider());
  lines.push(
    `  ${c.bold}Status:${c.reset}  ${statusBadge(result.distribution.syncStatus)}`
  );
  lines.push(
    row(
      'Pharos Canonical',
      result.distribution.pharosCanonical ? `${c.green}YES` : `${c.red}NO`
    )
  );
  lines.push(
    row(
      'CCIP Verified',
      result.distribution.ccipVerified ? `${c.green}YES` : `${c.red}NO`
    )
  );
  lines.push(row('Last Checked', result.distribution.lastChecked));
  lines.push('');

  if (result.intelligence) {
    lines.push(`  ${c.magenta}${c.bold}▸ Intelligent Oracle${c.reset}`);
    lines.push(divider());
    const verdictColor =
      result.intelligence.verdict === 'GO'
        ? c.green
        : result.intelligence.verdict === 'CAUTION'
          ? c.yellow
          : c.red;
    lines.push(row('Verdict', result.intelligence.verdict, verdictColor));
    lines.push(
      row('Confidence', `${result.intelligence.confidenceScore}/100`, verdictColor)
    );
    lines.push(row('Risk Level', result.intelligence.riskLevel, verdictColor));
    lines.push(row('Summary', result.intelligence.summary));
    if (result.intelligence.recommendations?.length) {
      lines.push(row('Next Action', result.intelligence.recommendations[0], c.yellow));
    }
    lines.push('');
  }

  if (result.crossChain?.enabled) {
    lines.push(`  ${c.magenta}${c.bold}▸ Cross-Chain Targets${c.reset}`);
    lines.push(divider());
    lines.push(row('Configured', result.crossChain.targetCount.toString()));
    lines.push(row('Synced', result.crossChain.syncedTargetCount.toString(), c.green));
    for (const destination of result.crossChain.destinations) {
      const color =
        destination.status === 'SYNCED'
          ? c.green
          : destination.status === 'DESYNC'
            ? c.red
            : c.yellow;
      lines.push(
        row(destination.name, `${destination.status} on ${destination.chainId}`, color)
      );
    }
  }
  lines.push('');


  if (result.walletPosition) {
    lines.push(`  ${c.magenta}${c.bold}▸ Wallet Position${c.reset}`);
    lines.push(divider());
    lines.push(
      row('Wallet', shortAddr(result.walletPosition.wallet), c.cyan)
    );
    lines.push(
      row('Balance', result.walletPosition.balance, c.yellow)
    );
    lines.push('');
  }


  lines.push(`  ${c.magenta}${c.bold}▸ Diagnostics${c.reset}`);
  lines.push(divider());
  lines.push(row('RPC Latency', `${result.diagnostics.rpcLatencyMs}ms`));
  lines.push(
    row('Block Number', result.diagnostics.blockNumber.toLocaleString())
  );

  if (result.diagnostics.errors.length > 0) {
    lines.push(
      row('Warnings', `${c.yellow}${result.diagnostics.errors.length} issue(s)`)
    );
    for (const err of result.diagnostics.errors) {
      lines.push(`    ${c.dim}${c.yellow}⚠ ${err}${c.reset}`);
    }
  } else {
    lines.push(row('Warnings', `${c.green}None`));
  }

  lines.push('');
  lines.push(divider('═', 60));
  lines.push(
    `  ${c.dim}Powered by Chainlink CCIP · Pharos Agent Center${c.reset}`
  );
  lines.push(divider('═', 60));
  lines.push('');

  console.log(lines.join('\n'));
}

function toJSON(result, pretty = false) {
  return pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result);
}

module.exports = { prettyPrint, toJSON, shortAddr, statusBadge, c };
