// สร้างไลบรารี template ตัวเลขจากภาพตัวอย่างที่รู้เฉลย  ใช้: node build-templates.js regions.json > templates.js
const core = require('./lotto-core.js');
const regs = require(require('path').resolve(process.argv[2]));
const truth = {
  special: ['76729'], p1: ['32930'], p2: ['26164', '79003'], p3: ['80544', '32100', '87394', '38830', '50598', '97031'],
  p4: ['1530', '1644', '1297', '1652'], p5: ['3530', '7516', '1566', '4147', '4899', '2503'], p6: ['623', '914', '527'], p7: ['68', '51', '95', '21'],
  row0: ['3', '0', '3'], row1: ['6', '4'], row2: ['9', '3', '7', '1'], row3: ['0', '0', '1', '0', '0'], row4: ['4', '4', '7'], row5: ['2', '1'], row6: ['4', '6', '8'],
  row7: [], row8: [], row9: ['4', '8', '7', '9', '5'],
};
const inst = [];
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
