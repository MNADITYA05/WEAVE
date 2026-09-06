/**
 * simulator.ts — Tab 3: SPICE Simulator UI
 */

import { createSimControls, SimParams } from './sim-controls.js';
import { WaveformViewer } from './waveform-viewer.js';

const BACKEND = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_SIM_BACKEND ?? 'http://localhost:8000';
const NETLIST_KEY = 'weave-sim-netlist-v1';

type SimVector = { name: string; unit: string; data: (number | [number, number])[]; is_complex: boolean };
type SimData = {
  ok: boolean; sim_type: string; x_var: string;
  vectors: SimVector[]; log: string; error: string;
};

const TABLE_SIM_TYPES = new Set(['op', 'tf']);

function renderResultTable(vectors: SimVector[], simType: string): string {
  const title = simType === 'op' ? 'Operating Point' : 'Transfer Function';
  const rows = vectors.map(v => {
    const raw0 = v.data[0] ?? 0;
    const val = Array.isArray(raw0) ? Math.hypot(raw0[0], raw0[1]) : raw0;
    const fmt = Math.abs(val) < 1e-3 || Math.abs(val) > 1e6
      ? val.toExponential(4)
      : val.toPrecision(6);
    return `<tr><td class="sc3-td-name">${v.name}</td><td class="sc3-td-val">${fmt}</td><td class="sc3-td-unit">${v.unit || '—'}</td></tr>`;
  }).join('');
  return `
    <div class="sc3-table-title">${title}</div>
    <table class="sc3-table">
      <thead><tr><th>Signal</th><th>Value</th><th>Unit</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

export function initSimulator(root: HTMLElement): void {
  root.innerHTML = '';
  root.removeAttribute('style');
  root.className = 'sc3-root';

  const sidebar = document.createElement('div');
  sidebar.className = 'sc3-sidebar';
  const main = document.createElement('div');
  main.className = 'sc3-main';
  root.appendChild(sidebar);
  root.appendChild(main);

  // netlist editor
  const nlLabel = document.createElement('div');
  nlLabel.className = 'sc3-section-label';
  nlLabel.textContent = 'Netlist';
  sidebar.appendChild(nlLabel);

  const nlArea = document.createElement('textarea');
  nlArea.className = 'sc3-netlist';
  nlArea.spellcheck = false;
  nlArea.placeholder = '* paste or send from Tab 2';
  sidebar.appendChild(nlArea);

  function pullNetlist(): void {
    try {
      const stored = localStorage.getItem(NETLIST_KEY);
      if (stored && stored !== nlArea.value) nlArea.value = stored;
    } catch { /* ignore */ }
  }
  pullNetlist();
  window.addEventListener('focus', pullNetlist);

  // sim controls
  const ctrlLabel = document.createElement('div');
  ctrlLabel.className = 'sc3-section-label';
  ctrlLabel.textContent = 'Simulation';
  sidebar.appendChild(ctrlLabel);

  const { el: ctrlEl, getParams } = createSimControls();
  sidebar.appendChild(ctrlEl);

  // run button
  const runBtn = document.createElement('button');
  runBtn.className = 'sc3-run-btn';
  runBtn.textContent = '▶ Run';
  sidebar.appendChild(runBtn);

  const statusEl = document.createElement('div');
  statusEl.className = 'sc3-status';
  sidebar.appendChild(statusEl);

  // ping
  const pingEl = document.createElement('div');
  pingEl.className = 'sc3-ping';
  pingEl.textContent = '⬤ checking backend…';
  sidebar.appendChild(pingEl);

  async function checkPing(): Promise<void> {
    try {
      const r = await fetch(BACKEND + '/ping', { signal: AbortSignal.timeout(3000) });
      if (r.ok) { pingEl.textContent = '⬤ backend online'; pingEl.className = 'sc3-ping ok'; }
      else throw new Error();
    } catch {
      pingEl.textContent = '⬤ backend offline'; pingEl.className = 'sc3-ping err';
    }
  }
  void checkPing();
  setInterval(() => void checkPing(), 10000);

  // log
  const logLabel = document.createElement('div');
  logLabel.className = 'sc3-section-label';
  logLabel.textContent = 'Log';
  sidebar.appendChild(logLabel);

  const logEl = document.createElement('pre');
  logEl.className = 'sc3-log';
  sidebar.appendChild(logEl);

  function appendLog(msg: string): void {
    logEl.textContent += msg + '\n';
    logEl.scrollTop = logEl.scrollHeight;
  }

  // main area: waveform viewer
  const wvRoot = document.createElement('div');
  wvRoot.style.flex = '1';
  wvRoot.style.minHeight = '0';
  main.appendChild(wvRoot);
  const viewer = new WaveformViewer({ el: wvRoot });

  // main area: table for op/tf
  const tableWrap = document.createElement('div');
  tableWrap.className = 'sc3-table-wrap';
  tableWrap.hidden = true;
  main.appendChild(tableWrap);

  // empty state
  const emptyEl = document.createElement('div');
  emptyEl.className = 'sc3-empty';
  emptyEl.textContent = 'Run a simulation to see results';
  main.appendChild(emptyEl);

  function showTable(vectors: SimVector[], simType: string): void {
    tableWrap.innerHTML = renderResultTable(vectors, simType);
    tableWrap.hidden = false;
    wvRoot.hidden = true;
    emptyEl.hidden = true;
  }

  function showWaveform(xVec: SimVector, yVecs: SimVector[]): void {
    tableWrap.hidden = true;
    wvRoot.hidden = false;
    emptyEl.hidden = true;
    viewer.load(xVec, yVecs);
  }

  // run
  runBtn.onclick = async (): Promise<void> => {
    const netlist = nlArea.value.trim();
    if (!netlist) { statusEl.textContent = 'Netlist is empty'; statusEl.className = 'sc3-status err'; return; }

    const { sim_type, params } = getParams();

    runBtn.disabled = true;
    runBtn.textContent = '⏳ Running…';
    statusEl.textContent = '';
    logEl.textContent = '';
    viewer.clear();
    tableWrap.hidden = true;
    wvRoot.hidden = false;
    emptyEl.hidden = true;

    try {
      const resp = await fetch(BACKEND + '/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ netlist, sim_type, params }),
        signal: AbortSignal.timeout(35000),
      });

      if (!resp.ok) { const txt = await resp.text(); throw new Error(`HTTP ${resp.status}: ${txt}`); }

      const data = await resp.json() as SimData;
      if (data.log) appendLog(data.log);

      if (!data.ok) {
        statusEl.textContent = 'Simulation failed: ' + data.error;
        statusEl.className = 'sc3-status err';
        emptyEl.hidden = false;
        emptyEl.textContent = data.error || 'Simulation failed';
        wvRoot.hidden = false;
        tableWrap.hidden = true;
        return;
      }

      if (!data.vectors.length) {
        statusEl.textContent = 'No vectors returned';
        statusEl.className = 'sc3-status warn';
        return;
      }

      if (TABLE_SIM_TYPES.has(data.sim_type)) {
        showTable(data.vectors, data.sim_type);
        statusEl.textContent = `✓ ${data.sim_type} — ${data.vectors.length} value(s)`;
        statusEl.className = 'sc3-status ok';
      } else {
        const xVec: SimVector | undefined = data.vectors.find(v => v.name === data.x_var) ?? data.vectors[0];
        if (!xVec) { statusEl.textContent = "No x vector"; statusEl.className = "sc3-status warn"; return; }
        const yVecs = data.vectors.filter(v => v.name !== xVec.name);
        showWaveform(xVec, yVecs);
        statusEl.textContent = `✓ ${data.sim_type} — ${yVecs.length} trace(s)`;
        statusEl.className = 'sc3-status ok';
      }

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      statusEl.textContent = 'Error: ' + msg;
      statusEl.className = 'sc3-status err';
      emptyEl.hidden = false;
      emptyEl.textContent = msg;
      wvRoot.hidden = false;
      tableWrap.hidden = true;
      appendLog('Error: ' + msg);
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = '▶ Run';
    }
  };
}

export function sendToSimulator(netlist: string): void {
  try { localStorage.setItem(NETLIST_KEY, netlist); } catch { /* ignore */ }
}
