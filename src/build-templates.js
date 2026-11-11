// สร้างไลบรารี template ตัวเลขจากภาพตัวอย่างที่รู้เฉลย  ใช้: node build-templates.js regions.json > templates.js
const core = require('./lotto-core.js');
const sets = process.argv.slice(2).map((f) => require(require('path').resolve(f)));
const truths = [{
  special: ['76729'], p1: ['32930'], p2: ['26164', '79003'], p3: ['80544', '32100', '87394', '38830', '50598', '97031'],
  p4: ['1530', '1644', '1297', '1652'], p5: ['3530', '7516', '1566', '4147', '4899', '2503'], p6: ['623', '914', '527'], p7: ['68', '51', '95', '21'],
  row0: ['3', '0', '3'], row1: ['6', '4'], row2: ['9', '3', '7', '1'], row3: ['0', '0', '1', '0', '0'], row4: ['4', '4', '7'], row5: ['2', '1'], row6: ['4', '6', '8'],
  row7: [], row8: [], row9: ['4', '8', '7', '9', '5'],
}, {
  special: ['08705'], p1: ['39584'], p2: ['09469', '90473'], p3: ['60717', '13049', '76654', '69721', '00170', '34774'],
  p4: ['8532', '1488', '7957', '7475'], p5: ['9496', '8216', '8733', '8236', '8819', '7415'], p6: ['591', '914', '997'], p7: ['57', '94', '75', '54'],
  row0: ['5'], row1: ['7', '6', '9', '5', '4'], row2: ['1'], row3: ['2', '3', '6'], row4: ['9'], row5: ['4', '7', '7', '4'], row6: ['9'], row7: ['3', '0', '4', '5', '5'], row8: ['4', '8'], row9: ['6', '1', '7', '4'],
}];
const inst = [];
sets.forEach((regs, si) => { const truth = truths[si];
for (const r of regs) {
  const gray = Uint8Array.from(r.gray);
  const seg = core.findNumberBoxes(gray, r.w, r.h, { mergeGap: 0 });
  const groups = core.groupDigits(seg.boxes, r.id.startsWith('row') ? 0.2 : 0.7);
  const exp = truth[r.id];
  if (groups.length !== exp.length) { console.error('group mismatch', r.id, groups.length, exp.length); process.exit(1); }
  groups.forEach((g, i) => {
    if (g.length !== exp[i].length) { console.error('digit count mismatch', r.id, i, g.length, exp[i]); process.exit(1); }
    g.forEach((b, j) => {
      const f = core.digitFeature(gray, r.w, r.h, seg.thr, b);
      inst.push({ d: exp[i][j], grid: Array.from(f.grid, (v) => Math.round(v * 100) / 100), ar: Math.round(f.ar * 100) / 100, src: r.id });
    });
  });
}
});
// leave-one-out
let ok = 0, bad = [];
inst.forEach((t, i) => {
  const c = core.classifyDigit({ grid: t.grid, ar: t.ar }, inst.filter((_, k) => k !== i));
  if (c.digit === t.d) ok++; else bad.push([t.src, t.d, c.digit]);
});
console.error(`LOO ${ok}/${inst.length}`, JSON.stringify(bad));
const counts = {}; inst.forEach((t) => (counts[t.d] = (counts[t.d] || 0) + 1));
console.error('per digit', JSON.stringify(counts));
console.log('window.LottoTemplates = ' + JSON.stringify(inst.map(({ d, grid, ar }) => ({ d, grid, ar }))) + ';');
