'use strict';
// ---------- net classification ----------
export function classifyNets(comps){
  const cls = new Map(); // net -> 'gnd' | 'rail' | 'signal'
  const allNets = new Set();
  comps.forEach(c => c.nets.forEach(n => allNets.add(n)));
  for (const n of allNets) cls.set(n, (n==='0') ? 'gnd' : 'signal');
  // rail = net tied to a DC V-source whose other terminal is gnd, and name looks like a rail
  for (const c of comps){
    if (c.sym==='voltage' && !/SINE|PULSE|PWL|AC|EXP|SFFM/i.test(c.value)){
      const dcVal = c.value.replace(/^DC\s+/i, '');
      if (/^[-+]?\d/.test(dcVal)){
        // only user-labelled nets become rail flags; auto-named nets (N001...)
        // mean the original schematic had a wire there, so keep the source wired
        const [a,b] = c.nets;
        const named = n => !/^n\d+$/i.test(n);
        if (a==='0' && b!=='0' && named(b)) cls.set(b,'rail');
        if (b==='0' && a!=='0' && named(a)) cls.set(a,'rail');
      }
    }
  }
  return cls;
}
export const isFlag = t => t==='gnd' || t==='rail';

// flag label for a rail net: auto-generated names (N001...) are replaced by
// the name of the DC source that drives the rail, e.g. VCE
export function railLabel(net, comps){
  if (!/^n\d+$/i.test(net)) return net.toUpperCase();
  const src = comps.find(c => {
    if (c.sym!=='voltage' || /SINE|PULSE|PWL|AC|EXP|SFFM/i.test(c.value)) return false;
    const dcVal = c.value.replace(/^DC\s+/i, '');
    if (!/^[-+]?\d/.test(dcVal)) return false;
    return (c.nets[0]===net && c.nets[1]==='0') || (c.nets[1]===net && c.nets[0]==='0');
  });
  return src ? src.name.toUpperCase() : net.toUpperCase();
}
