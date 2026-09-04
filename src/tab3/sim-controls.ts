/**
 * sim-controls.ts — simulation type selector + parameter form
 */

export interface SimParams {
  sim_type: 'tran' | 'ac' | 'dc' | 'op' | 'noise' | 'tf' | 'step';
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
        <option value="op">Operating Point (.op)</option>
        <option value="noise">Noise (.noise)</option>
        <option value="tf">Transfer Fn (.tf)</option>
        <option value="step">Param Sweep (.step)</option>
      </select>
    </div>

    <!-- tran -->
    <div class="sc3-param-group" id="sc3-tran-params">
      <div class="sc3-ctrl-row"><label>Stop time</label><input id="sc3-tstop"  value="1m" /><span class="sc3-unit">s</span></div>
      <div class="sc3-ctrl-row"><label>Time step</label><input id="sc3-tstep"  value="1u" /><span class="sc3-unit">s</span></div>
    </div>

    <!-- ac -->
    <div class="sc3-param-group" id="sc3-ac-params" style="display:none">
      <div class="sc3-ctrl-row"><label>Scale</label>
        <select id="sc3-ftype"><option value="dec">Decade</option><option value="oct">Octave</option><option value="lin">Linear</option></select>
      </div>
      <div class="sc3-ctrl-row"><label>Pts/decade</label><input id="sc3-pts"    value="20" /></div>
      <div class="sc3-ctrl-row"><label>Start freq</label>  <input id="sc3-fstart" value="1" /><span class="sc3-unit">Hz</span></div>
      <div class="sc3-ctrl-row"><label>Stop freq</label>   <input id="sc3-fstop"  value="1meg" /><span class="sc3-unit">Hz</span></div>
    </div>

    <!-- dc -->
    <div class="sc3-param-group" id="sc3-dc-params" style="display:none">
      <div class="sc3-ctrl-row"><label>Source</label><input id="sc3-dcsrc"   value="V1" /></div>
      <div class="sc3-ctrl-row"><label>Start</label> <input id="sc3-dcstart" value="0"  /></div>
      <div class="sc3-ctrl-row"><label>Stop</label>  <input id="sc3-dcstop"  value="5"  /></div>
      <div class="sc3-ctrl-row"><label>Step</label>  <input id="sc3-dcstep"  value="0.1"/></div>
    </div>

    <!-- op: no params needed -->
    <div class="sc3-param-group" id="sc3-op-params" style="display:none">
      <div class="sc3-ctrl-row" style="color:#888;font-size:11px;">No parameters needed.</div>
    </div>

    <!-- noise -->
    <div class="sc3-param-group" id="sc3-noise-params" style="display:none">
      <div class="sc3-ctrl-row"><label>Output</label>  <input id="sc3-noise-out"    value="V(out)" /></div>
      <div class="sc3-ctrl-row"><label>Src</label>     <input id="sc3-noise-src"    value="Vin" /></div>
      <div class="sc3-ctrl-row"><label>Scale</label>
        <select id="sc3-noise-ftype"><option value="dec">Decade</option><option value="oct">Octave</option><option value="lin">Linear</option></select>
      </div>
      <div class="sc3-ctrl-row"><label>Pts/decade</label><input id="sc3-noise-pts"    value="20" /></div>
      <div class="sc3-ctrl-row"><label>Start freq</label> <input id="sc3-noise-fstart" value="1" /><span class="sc3-unit">Hz</span></div>
      <div class="sc3-ctrl-row"><label>Stop freq</label>  <input id="sc3-noise-fstop"  value="1meg" /><span class="sc3-unit">Hz</span></div>
    </div>

    <!-- tf -->
    <div class="sc3-param-group" id="sc3-tf-params" style="display:none">
      <div class="sc3-ctrl-row"><label>Output</label><input id="sc3-tf-out" value="V(out)" /></div>
      <div class="sc3-ctrl-row"><label>Input src</label><input id="sc3-tf-src" value="Vin" /></div>
    </div>

    <!-- step -->
    <div class="sc3-param-group" id="sc3-step-params" style="display:none">
      <div class="sc3-ctrl-row"><label>Param name</label><input id="sc3-step-name"  value="R" /></div>
      <div class="sc3-ctrl-row"><label>Start</label>      <input id="sc3-step-start" value="1k" /></div>
      <div class="sc3-ctrl-row"><label>Stop</label>       <input id="sc3-step-stop"  value="10k" /></div>
      <div class="sc3-ctrl-row"><label>Increment</label>  <input id="sc3-step-inc"   value="1k" /></div>
      <div class="sc3-ctrl-row"><label>Inner sim</label>
        <select id="sc3-step-under">
          <option value="tran">Transient</option>
          <option value="ac">AC</option>
          <option value="dc">DC</option>
        </select>
      </div>
      <div class="sc3-ctrl-row"><label>Stop/Freq</label><input id="sc3-step-tstop" value="1m" /><span class="sc3-unit">s/Hz</span></div>
      <div class="sc3-ctrl-row"><label>Step/Pts</label> <input id="sc3-step-tstep" value="1u" /></div>
    </div>
  `;

  const typeEl  = el.querySelector('#sc3-simtype') as HTMLSelectElement;
  const groups: Record<string, HTMLElement> = {
    tran:  el.querySelector('#sc3-tran-params')  as HTMLElement,
    ac:    el.querySelector('#sc3-ac-params')    as HTMLElement,
    dc:    el.querySelector('#sc3-dc-params')    as HTMLElement,
    op:    el.querySelector('#sc3-op-params')    as HTMLElement,
    noise: el.querySelector('#sc3-noise-params') as HTMLElement,
    tf:    el.querySelector('#sc3-tf-params')    as HTMLElement,
    step:  el.querySelector('#sc3-step-params')  as HTMLElement,
  };

  function showGroup(t: string): void {
    Object.entries(groups).forEach(([k, g]) => { g.style.display = k === t ? '' : 'none'; });
  }

  typeEl.onchange = () => {
    showGroup(typeEl.value);
    opts.onChange?.(getParams());
  };

  el.querySelectorAll('input, select').forEach(inp => {
    inp.addEventListener('change', () => opts.onChange?.(getParams()));
  });

  function getParams(): SimParams {
    const t = typeEl.value as SimParams['sim_type'];
    const g = (id: string): string => (el.querySelector('#' + id) as HTMLInputElement)?.value ?? '';
    let p: Record<string, string> = {};
    if (t === 'tran')  p = { tstop: g('sc3-tstop'), tstep: g('sc3-tstep') };
    if (t === 'ac')    p = { ftype: g('sc3-ftype'), pts: g('sc3-pts'), fstart: g('sc3-fstart'), fstop: g('sc3-fstop') };
    if (t === 'dc')    p = { src: g('sc3-dcsrc'), start: g('sc3-dcstart'), stop: g('sc3-dcstop'), step: g('sc3-dcstep') };
    if (t === 'op')    p = {};
    if (t === 'noise') p = { out: g('sc3-noise-out'), src: g('sc3-noise-src'), ftype: g('sc3-noise-ftype'), pts: g('sc3-noise-pts'), fstart: g('sc3-noise-fstart'), fstop: g('sc3-noise-fstop') };
    if (t === 'tf')    p = { out: g('sc3-tf-out'), src: g('sc3-tf-src') };
    if (t === 'step')  p = { name: g('sc3-step-name'), start: g('sc3-step-start'), stop: g('sc3-step-stop'), inc: g('sc3-step-inc'), underlying: g('sc3-step-under'), tstop: g('sc3-step-tstop'), tstep: g('sc3-step-tstep') };
    return { sim_type: t, params: p };
  }

  return { el, getParams };
}
