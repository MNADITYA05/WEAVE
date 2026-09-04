/**
 * simulator.ts — Tab 3: SPICE Simulator UI
 * Sends netlist to FastAPI backend, renders waveforms.
 */

import { createSimControls, SimParams } from './sim-controls.js';
import { WaveformViewer } from './waveform-viewer.js';

const BACKEND = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_SIM_BACKEND ?? 'http://localhost:8000';

// Cross-tab netlist bus
const NETLIST_KEY = 'weave-sim-netlist-v1';

export function initSimulator(root: HTMLElement): void {
  root.innerHTML = '';
  root.removeAttribute('style');
  root.className = 'sc3-root';

  // ── layout ────────────────────────────────────────────────────────────────
  const sidebar = document.createElement('div');
  sidebar.className = 'sc3-sidebar';

  const main = document.createElement('div');
  main.className = 'sc3-main';

  root.appendChild(sidebar);
  root.appendChild(main);

  // ── netlist editor ───────────────────────────────────────────────────────
  const nlLabel = document.createElement('div');
  nlLabel.className = 'sc3-section-label';
  nlLabel.textContent = 'Netlist';
  sidebar.appendChild(nlLabel);

  const nlArea = document.createElement('textarea');
  nlArea.className = 'sc3-netlist';
  nlArea.spellcheck = false;
  nlArea.placeholder = '* paste or send from Tab 2';
  sidebar.appendChild(nlArea);

  // pull from cross-tab bus on focus/load
  function pullNetlist(): void {
    try {
      const stored = localStorage.getItem(NETLIST_KEY);
      if (stored && stored !== nlArea.value) nlArea.value = stored;
    } catch { /* ignore */ }
  }
  pullNetlist();
  window.addEventListener('focus', pullNetlist);

  // ── sim controls ─────────────────────────────────────────────────────────
  const ctrlLabel = document.createElement('div');
  ctrlLabel.className = 'sc3-section-label';
  ctrlLabel.textContent = 'Simulation';
  sidebar.appendChild(ctrlLabel);

  const { el: ctrlEl, getParams } = createSimControls();
  sidebar.appendChild(ctrlEl);

  // ── run button + status ──────────────────────────────────────────────────
  const runBtn = document.createElement('button');
  runBtn.className = 'sc3-run-btn';
  runBtn.textContent = '▶ Run';
  sidebar.appendChild(runBtn);

  const statusEl = document.createElement('div');
  statusEl.className = 'sc3-status';
  sidebar.appendChild(statusEl);

  // ── backend health ───────────────────────────────────────────────────────
  const pingEl = document.createElement('div');
  pingEl.className = 'sc3-ping';
  pingEl.textContent = '⬤ checking backend…';
  sidebar.appendChild(pingEl);

  async function checkPing(): Promise<void> {
    try {
      const r = await fetch(BACKEND + '/ping', { signal: AbortSignal.timeout(3000) });
      if (r.ok) {
        pingEl.textContent = '⬤ backend online';
        pingEl.className = 'sc3-ping ok';
      } else {
        throw new Error('not ok');
      }
    } catch {
      pingEl.textContent = '⬤ backend offline';
      pingEl.className = 'sc3-ping err';
    }
  }
  void checkPing();
  setInterval(() => void checkPing(), 10000);

  // ── log pane ─────────────────────────────────────────────────────────────
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

  // ── waveform viewer ──────────────────────────────────────────────────────
  const wvRoot = document.createElement('div');
  wvRoot.style.flex = '1';
  wvRoot.style.minHeight = '0';
  main.appendChild(wvRoot);

  const viewer = new WaveformViewer({ el: wvRoot });

  // empty state
  const emptyEl = document.createElement('div');
  emptyEl.className = 'sc3-empty';
  emptyEl.textContent = 'Run a simulation to see waveforms';
  main.appendChild(emptyEl);

  // ── run ──────────────────────────────────────────────────────────────────
  runBtn.onclick = async (): Promise<void> => {
    const netlist = nlArea.value.trim();
    if (!netlist) { statusEl.textContent = 'Netlist is empty'; statusEl.className = 'sc3-status err'; return; }

    const { sim_type, params } = getParams();

    runBtn.disabled = true;
    runBtn.textContent = '⏳ Running…';
    statusEl.textContent = '';
    logEl.textContent = '';
    viewer.clear();
    emptyEl.hidden = true;

    try {
      const resp = await fetch(BACKEND + '/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ netlist, sim_type, params }),
        signal: AbortSignal.timeout(35000),
      });

      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${txt}`);
      }

      const data = await resp.json() as {
        ok: boolean; sim_type: string; x_var: string;
        vectors: { name: string; unit: string; data: number[] }[];
        log: string; error: string;
      };

      if (data.log) appendLog(data.log);

      if (!data.ok) {
        statusEl.textContent = 'Simulation failed: ' + data.error;
        statusEl.className = 'sc3-status err';
        emptyEl.hidden = false;
        emptyEl.textContent = data.error || 'Simulation failed';
        return;
      }

      if (!data.vectors.length) {
        statusEl.textContent = 'No vectors returned';
        statusEl.className = 'sc3-status warn';
        return;
      }

      const xVec = data.vectors.find(v => v.name === data.x_var) ?? data.vectors[0];
      if (!xVec) { statusEl.textContent = 'No vectors returned'; statusEl.className = 'sc3-status warn'; return; }
      const yVecs = data.vectors.filter(v => v.name !== xVec.name);

      viewer.load(xVec, yVecs);
      statusEl.textContent = `✓ ${data.sim_type} — ${yVecs.length} trace(s)`;
      statusEl.className = 'sc3-status ok';

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      statusEl.textContent = 'Error: ' + msg;
      statusEl.className = 'sc3-status err';
      emptyEl.hidden = false;
      emptyEl.textContent = msg;
      appendLog('Error: ' + msg);
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = '▶ Run';
    }
  };
}

/** Called from Tab 2 "Send to Simulator" — writes netlist to cross-tab bus */
export function sendToSimulator(netlist: string): void {
  try { localStorage.setItem(NETLIST_KEY, netlist); } catch { /* ignore */ }
}
