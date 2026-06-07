/* ─────────────────────────────────────────────────────────────
   Pharos RWA Oracle Dashboard — Institutional Logic
   ───────────────────────────────────────────────────────────── */

const DEMO_TARGETS = [
  {
    id: 'pharos-self-check',
    name: 'Pharos Self-Check',
    chainId: 1672,
    rpc: 'https://rpc.pharos.xyz',
    address: '0xC879C018dB60520F4355C26eD1a6D572cdAC1815',
    ccipSelector: null,
    toleranceBps: 10,
    nativeCurrency: { name: 'GAS', symbol: 'GAS', decimals: 18 },
    blockExplorer: 'https://pharosscan.xyz',
  },
];

// ── DOM references ────────────────────────────────────────────
const els = {
  runBtn: document.querySelector('#runBtn'),
  vaultInput: document.querySelector('#vaultInput'),
  targetsInput: document.querySelector('#targetsInput'),
  
  runTime: document.querySelector('#runTime'),
  verdictText: document.querySelector('#verdictText'),
  
  gaugeFill: document.querySelector('#gaugeFill'),
  scoreText: document.querySelector('#scoreText'),
  
  topoSource: document.querySelector('#topoSource'),
  topoCCIP: document.querySelector('#topoCCIP'),
  topoDest: document.querySelector('#topoDest'),
  topoDestLabel: document.querySelector('#topoDestLabel'),
  line1: document.querySelector('#line1'),
  line2: document.querySelector('#line2'),
  
  planAction: document.querySelector('#planAction'),
  planReason: document.querySelector('#planReason'),
  planSteps: document.querySelector('#planSteps'),
  
  destList: document.querySelector('#destList'),
  anomaliesList: document.querySelector('#anomaliesList'),
  jsonOutput: document.querySelector('#jsonOutput'),
  dashboardContent: document.querySelector('#dashboardContent'),
};

els.targetsInput.value = JSON.stringify(DEMO_TARGETS);

// ── Animation Helpers ───────────────────────────────────────

function animateValue(element, end, duration) {
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    const ease = progress * (2 - progress); // easeOutQuad
    element.textContent = Math.floor(ease * end) + '%';
    if (progress < 1) {
      window.requestAnimationFrame(step);
    } else {
      element.textContent = end + '%';
    }
  };
  window.requestAnimationFrame(step);
}

async function scrambleText(element, finalStr) {
  const chars = '0123456789ABCDEF';
  let iterations = 0;
  
  return new Promise(resolve => {
    const interval = setInterval(() => {
      element.textContent = finalStr.split('').map((char, index) => {
        if (char === ' ') return ' ';
        if (index < iterations) return finalStr[index];
        return chars[Math.floor(Math.random() * chars.length)];
      }).join('');
      
      if (iterations >= finalStr.length) {
        clearInterval(interval);
        element.textContent = finalStr;
        resolve();
      }
      iterations += 1/2; // speed
    }, 30);
  });
}

async function typeWriter(element, text, speed = 5) {
  element.textContent = '';
  for (let i = 0; i < text.length; i++) {
    element.textContent += text.charAt(i);
    // Use requestAnimationFrame for non-blocking fast typing if speed is very low, but setTimeout is fine for short strings
    if (i % 3 === 0) await new Promise(r => setTimeout(r, speed)); 
  }
}

// ── Rendering ───────────────────────────────────────────────

function setSparkline(score) {
  const pct = Math.max(0, Math.min(100, score));
  els.gaugeFill.style.width = `${pct}%`;
  
  // Color based on score
  if (pct >= 90) {
    els.gaugeFill.style.background = 'var(--accent-go)';
  } else if (pct >= 50) {
    els.gaugeFill.style.background = 'var(--accent-caution)';
  } else {
    els.gaugeFill.style.background = 'var(--accent-stop)';
  }
  
  animateValue(els.scoreText, pct, 600); // 600ms counter animation
}

function updateTopology(result) {
  const isSourceOk = !!result.vault_state?.exists;
  const isRouterOk = !!result.ccipRouter?.reachable;
  
  els.topoSource.className = isSourceOk ? 'node-box active' : 'node-box error';
  els.topoCCIP.className = isRouterOk ? 'node-box active' : 'node-box error';
  
  // Line 1: Source -> CCIP
  if (isSourceOk && isRouterOk) {
    els.line1.className = 'connecting-line flowing';
  } else if (!isSourceOk || !isRouterOk) {
    els.line1.className = 'connecting-line error';
  } else {
    els.line1.className = 'connecting-line';
  }
  
  const dests = result.crossChain?.destinations || [];
  let isDestOk = false;
  
  if (dests.length > 0) {
    const syncCount = dests.filter(d => d.status === 'SYNCED').length;
    els.topoDestLabel.textContent = `${syncCount}/${dests.length} Synced`;
    isDestOk = syncCount === dests.length;
    els.topoDest.className = isDestOk ? 'node-box active' : 'node-box error';
  } else {
    els.topoDestLabel.textContent = 'Targets';
    els.topoDest.className = 'node-box';
  }
  
  // Line 2: CCIP -> Dests
  if (dests.length === 0) {
    els.line2.className = 'connecting-line';
  } else if (isRouterOk && isDestOk) {
    els.line2.className = 'connecting-line flowing';
  } else {
    els.line2.className = 'connecting-line error';
  }
}

function render(result) {
  // Time & Verdict
  els.runTime.textContent = new Date(result.timestamp).toLocaleString();
  
  const v = result.intelligence.verdict;
  els.verdictText.className = `verdict-sentence ${v.toLowerCase()}`;
  
  let headline = 'System idle.';
  if (v === 'GO') headline = 'The vault is GO.';
  else if (v === 'CAUTION') headline = 'The vault requires caution.';
  else headline = 'The vault is STOPPED.';
  
  scrambleText(els.verdictText, headline); // Hex scramble effect

  // Sparkline
  setSparkline(result.intelligence.confidenceScore);

  // Topology
  updateTopology(result);
  
  // Agent Plan
  const plan = result.agentPlan || {};
  els.planAction.innerHTML = `[ <span style="color:var(--text-muted)">ACTION:</span> ${plan.action} ]`;
  els.planReason.textContent = plan.reason || 'No specific reason provided.';
  
  if (plan.safeNextSteps && plan.safeNextSteps.length) {
    els.planSteps.innerHTML = plan.safeNextSteps.map(s => `<li>${s}</li>`).join('');
  } else {
    els.planSteps.innerHTML = '';
  }

  // Destinations Ticker
  const dests = result.crossChain?.destinations || [];
  if (dests.length === 0) {
    els.destList.innerHTML = '<div class="ticker-row"><span class="ticker-chain">No targets loaded.</span></div>';
  } else {
    const rowsHtml = dests.map(d => {
      let dotClass = 'status-dot';
      if (d.status === 'SYNCED') dotClass += ' go';
      else if (d.status === 'PARTIAL') dotClass += ' caution';
      else dotClass += ' stop';
      
      const subInfo = (d.comparisons || []).map(c => `${c.label}:${c.driftBps ?? '?'}bps`).join(' ');
      
      return `
        <div class="ticker-row">
          <div class="ticker-info">
            <div class="${dotClass}"></div>
            <span class="ticker-name">${d.name}</span>
            <span class="ticker-chain">[${d.chainId}]</span>
          </div>
          <div class="ticker-stats">${subInfo || d.status}</div>
        </div>
      `;
    }).join('');
    
    if (dests.length > 2) {
      // Apply scrolling ticker for many destinations
      els.destList.innerHTML = `
        <div class="ticker-scroll-wrapper">
          <div class="ticker-scroll-inner" style="animation-duration: ${dests.length * 3}s">
            ${rowsHtml}
            ${rowsHtml}
          </div>
        </div>
      `;
    } else {
      els.destList.innerHTML = rowsHtml;
    }
  }

  // Anomalies & Checks
  const combined = [];
  (result.anomalies || []).forEach(a => {
    combined.push({ label: a.message, sub: a.code, tag: a.severity, type: 'fail' });
  });
  (result.intelligence.checks || []).forEach(c => {
    let t = c.status.toLowerCase();
    if (t === 'passed') t = 'pass';
    if (t === 'failed') t = 'fail';
    if (t === 'warning') t = 'warn';
    combined.push({ label: c.label, sub: c.id, tag: c.status, type: t });
  });
  
  if (combined.length === 0) {
    els.anomaliesList.innerHTML = `
      <div class="anomaly-item">
        <span class="anomaly-type">INFO</span>
        <span class="anomaly-msg" style="color:var(--text-muted)">No checks recorded.</span>
      </div>
    `;
  } else {
    els.anomaliesList.innerHTML = combined.map(item => `
      <div class="anomaly-item">
        <span class="anomaly-type ${item.type}">${item.tag}</span>
        <span class="anomaly-msg">${item.label}</span>
        <span class="anomaly-code">${item.sub}</span>
      </div>
    `).join('');
  }

  // JSON Proof Typewriter
  const jsonString = JSON.stringify(result.proof || result, null, 2);
  typeWriter(els.jsonOutput, jsonString, 1);
}

// ── Execution ───────────────────────────────────────────────

async function runOracle() {
  els.runBtn.disabled = true;
  els.runBtn.textContent = 'EXECUTING...';
  els.dashboardContent.classList.add('loading');
  els.line1.className = 'connecting-line';
  els.line2.className = 'connecting-line';

  try {
    const params = new URLSearchParams({
      vault: els.vaultInput.value.trim(),
      pretty: 'true',
      noHistory: 'true',
    });

    const targets = els.targetsInput.value.trim();
    if (targets) params.set('targets', targets);

    const response = await fetch(`/verify?${params}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const result = await response.json();
    render(result);
  } catch (err) {
    els.jsonOutput.textContent = `Error: ${err.message}`;
    els.verdictText.className = 'verdict-sentence stop';
    els.verdictText.textContent = 'SYSTEM ERROR.';
  } finally {
    els.runBtn.disabled = false;
    els.runBtn.textContent = 'EXECUTE';
    els.dashboardContent.classList.remove('loading');
  }
}

els.runBtn.addEventListener('click', runOracle);
els.vaultInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runOracle();
});
