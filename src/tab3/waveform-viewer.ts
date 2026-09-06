/**
 * waveform-viewer.ts — SVG waveform plotter
 * Node selector, zoom (wheel), pan (drag), multi-trace.
 * AC analysis: data points are [re, im] pairs; toggle between |H| dB and phase.
 */

export interface WaveVector {
  name:       string;
  unit:       string;
  data:       (number | [number, number])[];
  is_complex: boolean;
}

export interface WaveformViewerOptions {
  el: HTMLElement;
}

type AcMode = 'mag_db' | 'phase_deg';

interface TraceState {
  vec:     WaveVector;
  color:   string;
  visible: boolean;
}

const COLORS = ['#4fc3f7','#aed581','#ffb74d','#f48fb1','#ce93d8','#80cbc4','#fff176','#ff8a65'];

/** Extract a plottable scalar from a raw data point. */
function extractScalar(pt: number | [number, number], mode: AcMode): number {
  if (typeof pt === 'number') return pt;
  const [re, im] = pt;
  if (mode === 'phase_deg') return Math.atan2(im, re) * 180 / Math.PI;
  // mag_db
  const mag = Math.sqrt(re * re + im * im);
  return mag > 0 ? 20 * Math.log10(mag) : -Infinity;
}

/** Extract x-axis scalar — always real (frequency, time, voltage). */
function extractX(pt: number | [number, number]): number {
  return typeof pt === 'number' ? pt : pt[0];
}

export class WaveformViewer {
  private svg:      SVGSVGElement;
  private plotG:    SVGGElement;
  private axisG:    SVGGElement;
  private legendEl: HTMLElement;
  private nodeSelEl: HTMLElement;
  private modeBarEl: HTMLElement;

  private xVec:   WaveVector | null = null;
  private traces: TraceState[] = [];
  private isAc    = false;
  private acMode: AcMode = 'mag_db';

  // view state
  private vx0 = 0; private vx1 = 1;
  private vy0 = -1; private vy1 = 1;
  private panning  = false;
  private panStart = { mx: 0, vx0: 0, vx1: 0 };

  private W = 800; private H = 380;
  private PAD = { l: 64, r: 16, t: 16, b: 40 };

  // stored handlers so they can be removed on destroy()
  private _onMouseMove: (e: MouseEvent) => void;
  private _onMouseUp:   () => void;

  constructor(opts: WaveformViewerOptions) {
    const root = opts.el;
    root.className = 'sc3-waveform-root';

    // AC mode toggle bar (hidden for non-AC)
    this.modeBarEl = document.createElement('div');
    this.modeBarEl.className = 'sc3-mode-bar';
    this.modeBarEl.hidden = true;
    root.appendChild(this.modeBarEl);

    // node selector toolbar
    this.nodeSelEl = document.createElement('div');
    this.nodeSelEl.className = 'sc3-node-sel';
    root.appendChild(this.nodeSelEl);

    // SVG wrapper
    const svgWrap = document.createElement('div');
    svgWrap.className = 'sc3-wave-wrap';
    root.appendChild(svgWrap);

    // SVG
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    this.svg.setAttribute('class', 'sc3-wave-svg');
    this.svg.setAttribute('viewBox', `0 0 ${this.W} ${this.H}`);
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.svg.style.position = 'absolute';
    this.svg.style.inset = '0';
    this.svg.style.width = '100%';
    this.svg.style.height = '100%';
    svgWrap.appendChild(this.svg);

    this.axisG = document.createElementNS('http://www.w3.org/2000/svg', 'g') as SVGGElement;
    this.plotG = document.createElementNS('http://www.w3.org/2000/svg', 'g') as SVGGElement;
    this.svg.appendChild(this.axisG);
    this.svg.appendChild(this.plotG);

    // legend
    this.legendEl = document.createElement('div');
    this.legendEl.className = 'sc3-legend';
    root.appendChild(this.legendEl);

    // clip path
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const clip = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
    clip.setAttribute('id', 'sc3-wave-clip');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x',      String(this.PAD.l));
    rect.setAttribute('y',      String(this.PAD.t));
    rect.setAttribute('width',  String(this.W - this.PAD.l - this.PAD.r));
    rect.setAttribute('height', String(this.H - this.PAD.t - this.PAD.b));
    clip.appendChild(rect);
    defs.appendChild(clip);
    this.svg.insertBefore(defs, this.axisG);
    this.plotG.setAttribute('clip-path', 'url(#sc3-wave-clip)');

    // wheel zoom
    this.svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.2 : 0.833;
      const cx = this.vx0 + (this.vx1 - this.vx0) * ((e.offsetX - this.PAD.l) / (this.W - this.PAD.l - this.PAD.r));
      this.vx0 = cx - (cx - this.vx0) * factor;
      this.vx1 = cx + (this.vx1 - cx) * factor;
      this.render();
    }, { passive: false });

    // pan — store handlers so destroy() can remove them
    this.svg.addEventListener('mousedown', (e) => {
      this.panning = true;
      this.panStart = { mx: e.clientX, vx0: this.vx0, vx1: this.vx1 };
    });
    this._onMouseMove = (e: MouseEvent) => {
      if (!this.panning) return;
      const dx    = e.clientX - this.panStart.mx;
      const range = this.panStart.vx1 - this.panStart.vx0;
      const pxRange = this.W - this.PAD.l - this.PAD.r;
      const delta = (dx / pxRange) * range;
      this.vx0 = this.panStart.vx0 - delta;
      this.vx1 = this.panStart.vx1 - delta;
      this.render();
    };
    this._onMouseUp = () => { this.panning = false; };
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup',   this._onMouseUp);
  }

  /** Remove global event listeners. Call when the viewer is torn down. */
  destroy(): void {
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup',   this._onMouseUp);
  }

  load(xVec: WaveVector, yVecs: WaveVector[]): void {
    this.xVec   = xVec;
    this.traces = yVecs.map((v, i) => ({
      vec: v, color: COLORS[i % COLORS.length] ?? '#4fc3f7', visible: true,
    }));
    this.isAc = yVecs.some(v => v.is_complex);
    this.acMode = 'mag_db';

    // auto-fit x using real part of x-axis points
    const xs = xVec.data.map(extractX);
    this.vx0 = xs[0] ?? 0;
    this.vx1 = xs[xs.length - 1] ?? 1;
    if (this.vx0 === this.vx1) this.vx1 = this.vx0 + 1;

    this.autofitY();
    this.buildModeBar();
    this.buildNodeSel();
    this.buildLegend();
    this.render();
  }

  private buildModeBar(): void {
    this.modeBarEl.innerHTML = '';
    this.modeBarEl.hidden = !this.isAc;
    if (!this.isAc) return;

    const label = document.createElement('span');
    label.className = 'sc3-mode-label';
    label.textContent = 'AC display:';
    this.modeBarEl.appendChild(label);

    const modes: { key: AcMode; text: string }[] = [
      { key: 'mag_db',   text: 'Magnitude (dB)' },
      { key: 'phase_deg', text: 'Phase (°)' },
    ];
    for (const m of modes) {
      const btn = document.createElement('button');
      btn.className = 'sc3-mode-btn' + (this.acMode === m.key ? ' active' : '');
      btn.textContent = m.text;
      btn.onclick = () => {
        this.acMode = m.key;
        this.modeBarEl.querySelectorAll('.sc3-mode-btn').forEach(b =>
          b.classList.toggle('active', (b as HTMLButtonElement).textContent === m.text)
        );
        this.autofitY();
        this.render();
      };
      this.modeBarEl.appendChild(btn);
    }
  }

  private autofitY(): void {
    let mn = Infinity; let mx = -Infinity;
    for (const t of this.traces) {
      if (!t.visible) continue;
      for (const pt of t.vec.data) {
        const v = extractScalar(pt, this.acMode);
        if (!isFinite(v)) continue;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    if (!isFinite(mn)) { mn = -1; mx = 1; }
    const pad = (mx - mn) * 0.1 || 0.1;
    this.vy0 = mn - pad;
    this.vy1 = mx + pad;
  }

  private buildNodeSel(): void {
    this.nodeSelEl.innerHTML = '<span class="sc3-ns-label">Probes:</span>';
    this.traces.forEach((t) => {
      const btn = document.createElement('button');
      btn.className = 'sc3-ns-btn' + (t.visible ? ' active' : '');
      btn.style.borderColor = t.color;
      btn.textContent = t.vec.name;
      btn.onclick = () => {
        t.visible = !t.visible;
        btn.classList.toggle('active', t.visible);
        this.autofitY();
        this.render();
        this.buildLegend();
      };
      this.nodeSelEl.appendChild(btn);
    });
  }

  private buildLegend(): void {
    this.legendEl.innerHTML = '';
    for (const t of this.traces) {
      if (!t.visible) continue;
      const row = document.createElement('div');
      row.className = 'sc3-legend-row';
      row.innerHTML = `<span class="sc3-legend-swatch" style="background:${t.color}"></span><span>${t.vec.name}</span>`;
      this.legendEl.appendChild(row);
    }
  }

  private toSx(v: number): number {
    return this.PAD.l + (v - this.vx0) / (this.vx1 - this.vx0) * (this.W - this.PAD.l - this.PAD.r);
  }
  private toSy(v: number): number {
    return this.PAD.t + (1 - (v - this.vy0) / (this.vy1 - this.vy0)) * (this.H - this.PAD.t - this.PAD.b);
  }

  render(): void {
    while (this.plotG.firstChild) this.plotG.removeChild(this.plotG.firstChild);
    while (this.axisG.firstChild) this.axisG.removeChild(this.axisG.firstChild);
    if (!this.xVec) return;
    this.drawAxes();

    for (const t of this.traces) {
      if (!t.visible || !t.vec.data.length) continue;
      const pts: string[] = [];
      const xData = this.xVec.data;
      const yData = t.vec.data;
      const len   = Math.min(xData.length, yData.length);

      for (let i = 0; i < len; i++) {
        const sx = this.toSx(extractX(xData[i] ?? 0));
        const yv = extractScalar(yData[i] ?? 0, this.acMode);
        if (!isFinite(yv)) continue;
        const sy = this.toSy(yv);
        pts.push(`${pts.length === 0 ? 'M' : 'L'}${sx.toFixed(2)},${sy.toFixed(2)}`);
      }

      if (!pts.length) continue;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pts.join(' '));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', t.color);
      path.setAttribute('stroke-width', '1.5');
      this.plotG.appendChild(path);
    }
  }

  private drawAxes(): void {
    const ns = 'http://www.w3.org/2000/svg';
    const mkLine = (x1: number, y1: number, x2: number, y2: number, cls: string) => {
      const l = document.createElementNS(ns, 'line') as SVGLineElement;
      l.setAttribute('x1', String(x1)); l.setAttribute('y1', String(y1));
      l.setAttribute('x2', String(x2)); l.setAttribute('y2', String(y2));
      l.setAttribute('class', cls);
      return l;
    };
    const mkText = (x: number, y: number, txt: string, anchor = 'middle') => {
      const t = document.createElementNS(ns, 'text') as SVGTextElement;
      t.setAttribute('x', String(x)); t.setAttribute('y', String(y));
      t.setAttribute('text-anchor', anchor);
      t.setAttribute('class', 'sc3-axis-label');
      t.textContent = txt;
      return t;
    };

    // border
    this.axisG.appendChild(mkLine(this.PAD.l, this.PAD.t, this.W - this.PAD.r, this.PAD.t, 'sc3-axis-border'));
    this.axisG.appendChild(mkLine(this.PAD.l, this.H - this.PAD.b, this.W - this.PAD.r, this.H - this.PAD.b, 'sc3-axis-border'));
    this.axisG.appendChild(mkLine(this.PAD.l, this.PAD.t, this.PAD.l, this.H - this.PAD.b, 'sc3-axis-border'));

    // x ticks
    const xTicks = this.niceTicks(this.vx0, this.vx1, 6);
    for (const v of xTicks) {
      const sx = this.toSx(v);
      this.axisG.appendChild(mkLine(sx, this.PAD.t, sx, this.H - this.PAD.b, 'sc3-grid'));
      this.axisG.appendChild(mkLine(sx, this.H - this.PAD.b, sx, this.H - this.PAD.b + 4, 'sc3-axis-border'));
      this.axisG.appendChild(mkText(sx, this.H - this.PAD.b + 14, this.fmtVal(v)));
    }

    // y ticks
    const yTicks = this.niceTicks(this.vy0, this.vy1, 5);
    for (const v of yTicks) {
      const sy = this.toSy(v);
      this.axisG.appendChild(mkLine(this.PAD.l, sy, this.W - this.PAD.r, sy, 'sc3-grid'));
      this.axisG.appendChild(mkText(this.PAD.l - 4, sy + 4, this.fmtVal(v), 'end'));
    }

    // axis labels
    const xLabel = this.isAc ? 'Frequency (Hz)' :
                   this.xVec?.unit === 'voltage' ? 'Voltage (V)' : 'Time (s)';
    this.axisG.appendChild(mkText((this.PAD.l + this.W - this.PAD.r) / 2, this.H - 4, xLabel));

    if (this.isAc) {
      const yLabel = this.acMode === 'mag_db' ? 'Gain (dB)' : 'Phase (°)';
      const ty = document.createElementNS(ns, 'text') as SVGTextElement;
      ty.setAttribute('x', String(12));
      ty.setAttribute('y', String((this.PAD.t + this.H - this.PAD.b) / 2));
      ty.setAttribute('text-anchor', 'middle');
      ty.setAttribute('class', 'sc3-axis-label');
      ty.setAttribute('transform', `rotate(-90, 12, ${(this.PAD.t + this.H - this.PAD.b) / 2})`);
      ty.textContent = yLabel;
      this.axisG.appendChild(ty);
    }
  }

  private niceTicks(lo: number, hi: number, n: number): number[] {
    const range = hi - lo;
    if (range === 0) return [lo];
    const step  = Math.pow(10, Math.floor(Math.log10(range / n)));
    const nice  = [1, 2, 2.5, 5, 10].map(f => f * step).find(s => range / s <= n + 1) ?? step;
    const start = Math.ceil(lo / nice) * nice;
    const ticks: number[] = [];
    for (let v = start; v <= hi + nice * 1e-6; v += nice)
      ticks.push(parseFloat(v.toPrecision(10)));
    return ticks;
  }

  private fmtVal(v: number): string {
    const abs = Math.abs(v);
    if (abs === 0) return '0';
    if (abs >= 1e6)  return (v / 1e6).toPrecision(3) + 'M';
    if (abs >= 1e3)  return (v / 1e3).toPrecision(3) + 'k';
    if (abs >= 1)    return v.toPrecision(3) + '';
    if (abs >= 1e-3) return (v * 1e3).toPrecision(3) + 'm';
    if (abs >= 1e-6) return (v * 1e6).toPrecision(3) + 'µ';
    return (v * 1e9).toPrecision(3) + 'n';
  }

  clear(): void {
    this.xVec = null; this.traces = []; this.isAc = false;
    while (this.plotG.firstChild) this.plotG.removeChild(this.plotG.firstChild);
    while (this.axisG.firstChild) this.axisG.removeChild(this.axisG.firstChild);
    this.nodeSelEl.innerHTML = '';
    this.legendEl.innerHTML  = '';
    this.modeBarEl.hidden    = true;
    this.modeBarEl.innerHTML = '';
  }
}
