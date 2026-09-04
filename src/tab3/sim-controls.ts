/**
 * sim-controls.ts — .tran / .ac / .dc parameter form
 * Returns a DOM element; caller decides where to mount it.
 */

export interface SimParams {
  sim_type: 'tran' | 'ac' | 'dc';
  params: Record<string, string>;
}

export interface SimControlsOptions {
  onChange?: (p: SimParams) => void;
}

export function createSimControls(opts: SimControlsOptions = {}): {
  el: HTMLElement;
  getParams: () => SimParams;
} {
  const el = document.createElement('div');
  el.className = 'sc3-controls';

  el.innerHTML = `
    <div class="sc3-ctrl-row">
      <label>Type</label>
      <select id="sc3-simtype">
        <option value="tran">Transient (.tran)</option>
        <option value="ac">AC Sweep (.ac)</option>
        <option value="dc">DC Sweep (.dc)</option>
      </select>
    </div>
    <div class="sc3-param-group" id="sc3-tran-params">
      <div class="sc3-ctrl-row"><label>Stop time</label><input id="sc3-tstop"  value="1m" /><span class="sc3-unit">s</span></div>
      <div class="sc3-ctrl-row"><label>Time step</label><input id="sc3-tstep"  value="1u" /><span class="sc3-unit">s</span></div>
    </div>
    <div class="sc3-param-group" id="sc3-ac-params" style="display:none">
      <div class="sc3-ctrl-row"><label>Scale</label>
        <select id="sc3-ftype"><option value="dec">Decade</option><option value="oct">Octave</option><option value="lin">Linear</option></select>
      </div>
      <div class="sc3-ctrl-row"><label>Points/decade</label><input id="sc3-pts"    value="20" /></div>
      <div class="sc3-ctrl-row"><label>Start freq</label>    <input id="sc3-fstart" value="1" /><span class="sc3-unit">Hz</span></div>
      <div class="sc3-ctrl-row"><label>Stop freq</label>     <input id="sc3-fstop"  value="1meg" /><span class="sc3-unit">Hz</span></div>
    </div>
    <div class="sc3-param-group" id="sc3-dc-params" style="display:none">
      <div class="sc3-ctrl-row"><label>Source</label><input id="sc3-dcsrc"   value="V1" /></div>
      <div class="sc3-ctrl-row"><label>Start</label> <input id="sc3-dcstart" value="0"  /></div>
      <div class="sc3-ctrl-row"><label>Stop</label>  <input id="sc3-dcstop"  value="5"  /></div>
      <div class="sc3-ctrl-row"><label>Step</label>  <input id="sc3-dcstep"  value="0.1"/></div>
    </div>
  `;

  const typeEl = el.querySelector('#sc3-simtype') as HTMLSelectElement;
  const tranEl = el.querySelector('#sc3-tran-params') as HTMLElement;
  const acEl   = el.querySelector('#sc3-ac-params')   as HTMLElement;
  const dcEl   = el.querySelector('#sc3-dc-params')   as HTMLElement;

  typeEl.onchange = () => {
    tranEl.style.display = typeEl.value === 'tran' ? '' : 'none';
    acEl.style.display   = typeEl.value === 'ac'   ? '' : 'none';
    dcEl.style.display   = typeEl.value === 'dc'   ? '' : 'none';
    opts.onChange?.(getParams());
  };

  el.querySelectorAll('input, select').forEach(inp => {
    inp.addEventListener('change', () => opts.onChange?.(getParams()));
  });

  function getParams(): SimParams {
    const t = typeEl.value as 'tran' | 'ac' | 'dc';
    const g = (id: string): string => (el.querySelector('#' + id) as HTMLInputElement)?.value ?? '';
    let p: Record<string, string> = {};
    if (t === 'tran') p = { tstop: g('sc3-tstop'), tstep: g('sc3-tstep') };
    if (t === 'ac')   p = { ftype: g('sc3-ftype'), pts: g('sc3-pts'), fstart: g('sc3-fstart'), fstop: g('sc3-fstop') };
    if (t === 'dc')   p = { src: g('sc3-dcsrc'), start: g('sc3-dcstart'), stop: g('sc3-dcstop'), step: g('sc3-dcstep') };
    return { sim_type: t, params: p };
  }

  return { el, getParams };
}
