'use strict';
import { convert } from './tab1/convert.js?v=4';
import { compare } from './tab1/verifier.js';
import { parseNetlist } from './tab1/netlist-parser.js';
import { SYMBOLS, blockAsyFiles } from './tab1/symbols.js';

import { initEditor } from './tab2/schematic-editor.js?v=4';
import { _mergeWires, _detectJunctions } from './tab1/wire-merge.js?v=3';
import { setAscView, renderSchematic } from './tab1/renderer.js';
const APP_VERSION='5.0';

// ── Tab switching ─────────────────────────────────────────────────────────
function switchTab(n){
  document.getElementById('panel1').classList.toggle('active', n===1);
  document.getElementById('panel2').classList.toggle('active', n===2);
  document.getElementById('tab1').classList.toggle('active', n===1);
  document.getElementById('tab2').classList.toggle('active', n===2);
}

// ── Shared console logger ─────────────────────────────────────────────────
function clogId(id, msg, cls){
  const c=document.getElementById(id);
  const line=document.createElement('div');
  if(cls) line.className='l-'+cls;
  const t=new Date().toTimeString().slice(0,8);
  line.textContent='['+t+'] '+msg;
  c.appendChild(line);
  c.scrollTop=c.scrollHeight;
}
function clog(msg,cls){ clogId('console',msg,cls); }
function clog2(msg,cls){ clogId('console2',msg,cls); }

// ── TAB 1: Netlist → Schematic examples ──────────────────────────────────
const EXAMPLES = {
  'OP27 inverting amplifier': `* OP27 inverting amplifier, gain -10
V1 vcc 0 15
V2 vee 0 -15
V3 in 0 SINE(0 0.1 1k) AC 1
R1 in inm 10k
R2 inm out 100k
XU1 0 inm vcc vee out OP27
.lib ADI.lib
.tran 5m
.end`,
  '1002A two-opamp instrumentation amp': `* 1002A two-opamp instrumentation amplifier
V1 vcc 0 15
V2 vee 0 -15
V3 vin1 0 SINE(0 10m 1k)
V4 vin2 0 SINE(0 11m 1k)
R1 0 n1 10k
R2 n1 out1 90k
R3 out1 n2 90k
R4 n2 out 10k
XU1 vin1 n1 vcc vee out1 OP27
XU2 vin2 n2 vcc vee out OP27
.lib ADI.lib
.tran 5m
.end`,
  'LT1004-1.2 shunt reference': `* LT1004-1.2 shunt reference demo
XU1 OUT 0 LT1004-1.2
R1 OUT N001 36K
V1 N001 0 PULSE(0 5 100u 10n 10n 500u 1)
.tran 700u
.lib LTC3.lib
.end`,
  'BJT common-emitter amplifier': `* BJT common-emitter amplifier
V1 vcc 0 12
V2 in 0 SINE(0 10m 1k) AC 1
C1 in b 1u
R1 vcc b 47k
R2 b 0 10k
RC vcc c 4.7k
RE e 0 1k
CE e 0 100u
Q1 c b e 2N3904
.tran 5m
.end`,
  'Sallen-Key low-pass': `* Sallen-Key LPF 1kHz Butterworth
V1 vcc 0 15
V2 vee 0 -15
V3 in 0 AC 1
R1 in n1 11.3k
R2 n1 n2 11.3k
C1 n1 out 20n
C2 n2 0 10n
XU1 n2 inm vcc vee out OP27
R3 inm out 1
.lib ADI.lib
.ac dec 100 10 100k
.end`,
};

// ── TAB 1 state ───────────────────────────────────────────────────────────
let lastAsc='';
async function run(){
  const src=document.getElementById('nl').value.trim();
  if(!src) return;
  const status=document.getElementById('status');
  const info=document.getElementById('info');
  try{
    lastAsc=await convert(src);
    let errs=compare(src,lastAsc);
    const nSym=(lastAsc.match(/^SYMBOL /gm)||[]).length;
    const nWire=(lastAsc.match(/^WIRE /gm)||[]).length;
    info.textContent=`${nSym} symbols, ${nWire} wires`;
    lastAsc = _mergeWires(lastAsc);
    lastAsc = _detectJunctions(lastAsc);
    document.getElementById('ascview').textContent=lastAsc;
    renderSchematic(lastAsc);
    if(errs.length){
      status.textContent=`partial: ${errs.length} net(s) need manual fixup`;
      status.className='warn';
      clog(`converted with ${errs.length} unmatched net(s)`,'warn');
      errs.slice(0,8).forEach(e=>clog('  '+e,'dim'));
      if(errs.length>8) clog(`  ...and ${errs.length-8} more`,'dim');
    } else {
      status.textContent='round-trip verified: MATCH';
      status.className='ok';
      clog(`MATCH — ${nSym} symbols, ${nWire} wires, connectivity verified`,'ok');
    }
  }catch(e){
    status.textContent='error: '+e.message; status.className='bad'; info.textContent=''; lastAsc='';
    document.getElementById('ascview').textContent='';
    clog('error: '+e.message,'err');
  }
  document.getElementById('dl').disabled=!lastAsc;
}

function download(){
  if(!lastAsc) return;
  const d=new Date(), p2=n=>String(n).padStart(2,'0');
  const stamp=d.getFullYear()+p2(d.getMonth()+1)+p2(d.getDate())+p2(d.getHours())+p2(d.getMinutes());
  const bytes=new Uint8Array(lastAsc.length);
  for(let i=0;i<lastAsc.length;i++){const c=lastAsc.charCodeAt(i);bytes[i]=c<256?c:63;}
  const b=new Blob([bytes],{type:'application/octet-stream'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(b); a.download='schematic_'+stamp+'.asc'; a.click();
  URL.revokeObjectURL(a.href);
  if(typeof blockAsyFiles==='function'){
    const asys=blockAsyFiles(lastAsc);
    for(const[fn,body] of Object.entries(asys)){
      const ab=new Uint8Array(body.length);
      for(let i=0;i<body.length;i++){const c=body.charCodeAt(i);ab[i]=c<256?c:63;}
      const bb=new Blob([ab],{type:'application/octet-stream'});
      const aa=document.createElement('a');
      aa.href=URL.createObjectURL(bb); aa.download=fn; aa.click();
      URL.revokeObjectURL(aa.href);
    }
  }
}




// ── Boot ──────────────────────────────────────────────────────────────────
// Expose functions needed by inline HTML onclick handlers
window.switchTab = switchTab;
window.convert = convert;
window.compare = compare;
window._mergeWires = _mergeWires;
window._detectJunctions = _detectJunctions;
window.parseNetlist = parseNetlist;
window.setAscView = setAscView;
window.addEventListener('DOMContentLoaded',()=>{
  initEditor(document.getElementById('sc-root'));
  document.getElementById('ver').textContent='v'+APP_VERSION;
  document.getElementById('nsym').textContent=Object.keys(SYMBOLS).length+' symbols loaded';

  // populate example selector
  const sel=document.getElementById('ex');
  const optNew=document.createElement('option');
  optNew.textContent='New (clear)'; sel.appendChild(optNew);
  for(const k of Object.keys(EXAMPLES)){
    const o=document.createElement('option'); o.textContent=k; sel.appendChild(o);
  }
  sel.onchange=()=>{
    if(sel.value==='New (clear)'){
      lastAsc=''; document.getElementById('nl').value='';
      document.getElementById('ascview').textContent='';
      document.getElementById('info').textContent='';
      document.getElementById('dl').disabled=true;
      const st=document.getElementById('status'); st.textContent=''; st.className='';
      return;
    }
    document.getElementById('nl').value=EXAMPLES[sel.value]; run();
  };
  sel.value='OP27 inverting amplifier';
  document.getElementById('nl').value=EXAMPLES['OP27 inverting amplifier'];
  run();

  // tab1 buttons
  document.getElementById('go').onclick=run;
  document.getElementById('dl').onclick=download;
  let t1; document.getElementById('nl').addEventListener('input',()=>{clearTimeout(t1);t1=setTimeout(run,500);});

  // draggable gutters tab1
  (function(){
    const g=document.getElementById('vgut'), L=document.getElementById('leftpane'), R=document.getElementById('rightpane'), row=document.getElementById('toprow');
    let drag=false;
    g.addEventListener('mousedown',e=>{drag=true;e.preventDefault();document.body.style.userSelect='none';});
    window.addEventListener('mousemove',e=>{if(!drag)return;const r=row.getBoundingClientRect();let f=(e.clientX-r.left)/r.width;f=Math.max(0.15,Math.min(0.85,f));L.style.flex='0 0 '+(f*100)+'%';R.style.flex='1 1 auto';});
    window.addEventListener('mouseup',()=>{drag=false;document.body.style.userSelect='';});
  })();
  (function(){
    const g=document.getElementById('hgut'),C=document.getElementById('console'),ws=document.getElementById('workspace');
    let drag=false;
    g.addEventListener('mousedown',e=>{drag=true;e.preventDefault();document.body.style.userSelect='none';});
    window.addEventListener('mousemove',e=>{if(!drag)return;const r=ws.getBoundingClientRect();let h=r.bottom-e.clientY;h=Math.max(24,Math.min(r.height-120,h));C.style.height=h+'px';});
    window.addEventListener('mouseup',()=>{drag=false;document.body.style.userSelect='';});
  })();

  clog('weave ready — '+Object.keys(SYMBOLS).length+' symbols loaded','dim');
  // Pre-warm ELK Web Worker so first Convert is fast
  convert._elk = new ELK();

});

