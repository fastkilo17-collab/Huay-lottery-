/* lotto-core.js — ตรรกะล้วน (ไม่แตะ DOM) ใช้ทั้งในเบราว์เซอร์และทดสอบด้วย node */
(function (root) {
  'use strict';

  // ตำแหน่งต่างๆ ในภาพแคปจอ (อ้างอิงภาพกว้าง 1280px) — สเกลตามความกว้างภาพ
  const LAYOUT = {
    refW: 1280,
    refH: 1301,
    draw: [546, 270, 832, 328],            // เลขงวด 10 หลัก (หลังคำว่า "งวด") — ใช้ 10 หลักท้ายสุด
    prizeX: [207, 740],
    tableX: [846, 1278],                   // คอลัมน์ "หน่วย"
    tableY0: 436,
    rowH: 84.2,
    prizes: [
      { tier: 'special', n: 1, len: 5, y: [350, 433] },
      { tier: 'p1', n: 1, len: 5, y: [436, 517] },
      { tier: 'p2', n: 2, len: 5, y: [520, 603] },
      { tier: 'p3', n: 6, len: 5, y: [606, 770] },
      { tier: 'p4', n: 4, len: 4, y: [773, 940] },
      { tier: 'p5', n: 6, len: 4, y: [943, 1108] },
      { tier: 'p6', n: 3, len: 3, y: [1111, 1193] },
      { tier: 'p7', n: 4, len: 2, y: [1196, 1278] },
    ],
  };

  const TIER_NAMES = {
    special: 'รางวัลพิเศษ', p1: 'รางวัลที่ 1', p2: 'รางวัลที่ 2', p3: 'รางวัลที่ 3',
    p4: 'รางวัลที่ 4', p5: 'รางวัลที่ 5', p6: 'รางวัลที่ 6', p7: 'รางวัลที่ 7',
  };

  const TOTAL_NUMBERS = LAYOUT.prizes.reduce((a, p) => a + p.n, 0); // 27

  /** แยกกลุ่มตัวเลขจากข้อความ OCR ของช่องรางวัล ให้ได้ n ชุด ชุดละ len หลัก (ถ้าอ่านติดกันจะตัดให้) */
  function parsePrizeText(text, n, len) {
    const groups = (text || '').replace(/[^0-9]+/g, ' ').trim().split(' ').filter(Boolean);
    const out = [];
    for (const g of groups) {
      if (g.length === len) out.push(g);
      else if (g.length > len && g.length % len === 0) {
        for (let i = 0; i < g.length; i += len) out.push(g.slice(i, i + len));
      } else out.push(g); // ความยาวผิด — เก็บไว้ให้ผู้ใช้แก้ (ตรวจจะแจ้งเตือน)
    }
    return out;
  }

  /** แปลงข้อความ OCR ของคอลัมน์ "หน่วย" หนึ่งแถว เป็นอาร์เรย์เลขหลักเดียว */
  function parseUnitsText(text) {
    return (text || '').replace(/[^0-9]/g, '').split('');
  }

  /** เลขงวด: เหลือแต่ตัวเลข */
  function parseDrawNo(text) {
    const d = (text || '').replace(/[^0-9]/g, '');
    return d.length > 10 ? d.slice(-10) : d;
  }

  function isValidDrawNo(s) {
    if (!/^\d{10}$/.test(s || '')) return false;
    const mm = +s.slice(2, 4), dd = +s.slice(4, 6);
    return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
  }

  /** ตรวจความถูกต้อง: เลข 2 ตัวท้ายของทุกรางวัล (จัดกลุ่มตามหลักสิบ) ต้องตรงกับตาราง สิบ→หน่วย */
  function validate(nums, table) {
    const issues = [];
    // 1) จำนวนและความยาวหลักของแต่ละรางวัล
    for (const p of LAYOUT.prizes) {
      const arr = nums[p.tier] || [];
      if (arr.length !== p.n) issues.push(`${TIER_NAMES[p.tier]}: ต้องมี ${p.n} เลข แต่ได้ ${arr.length}`);
      arr.forEach((v, i) => {
        if (!/^\d+$/.test(v) || v.length !== p.len)
          issues.push(`${TIER_NAMES[p.tier]} ช่อง ${i + 1}: "${v}" ต้องเป็นเลข ${p.len} หลัก`);
      });
    }
    // 2) เทียบกับตารางสิบ/หน่วย
    const expected = Array.from({ length: 10 }, () => []);
    for (const p of LAYOUT.prizes) {
      for (const v of nums[p.tier] || []) {
        if (/^\d{2,}$/.test(v)) expected[+v.slice(-2, -1)].push(v.slice(-1));
      }
    }
    expected.forEach((a) => a.sort());
    const tableOk = Array.isArray(table) && table.some((r) => r && r.length);
    let badRows = [];
    if (tableOk) {
      for (let t = 0; t < 10; t++) {
        const got = [...(table[t] || [])].sort();
        if (got.join(',') !== expected[t].join(',')) badRows.push(t);
      }
      if (badRows.length) issues.push(`เลขท้าย 2 ตัวไม่ตรงตารางหลักสิบ: ${badRows.join(', ')}`);
    }
    return {
      ok: issues.length === 0 && tableOk,
      verified: tableOk && badRows.length === 0,
      structureOk: !issues.some((s) => !s.startsWith('เลขท้าย')),
      badRows, expected, issues,
    };
  }


  /* ---------- แบ่งตัวเลขจากภาพ (ทำงานบนอาร์เรย์เทา ไม่ผูกกับ DOM) ---------- */

  /** หาค่า threshold แบบ Otsu จากอาร์เรย์ระดับเทา 0-255 */
  function otsu(gray) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
    const total = gray.length;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, thr = 127;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; thr = t; }
    }
    return thr;
  }

  /**
   * หากรอบตัวเลขในภาพเทา (ตัวหนังสือเข้มบนพื้นอ่อน)
   * opts.mergeGap: ช่องว่างสูงสุด (เทียบความสูงบรรทัด) ที่ยังรวมเป็นเลขชุดเดียว (0 = แยกทีละหลัก)
   * คืน {boxes:[{x0,y0,x1,y1,line}], lines}
   */
  function findNumberBoxes(gray, w, h, opts) {
    opts = opts || {};
    const mergeGap = opts.mergeGap == null ? 0.75 : opts.mergeGap;
    const margin = opts.margin == null ? 3 : opts.margin;
    // ช่องว่างเปล่า (ไม่มีตัวหนังสือ): ช่วงความเข้มแคบ → ไม่มีกรอบ
    const sorted = Uint8Array.from(gray).sort();
    const lo = sorted[Math.floor(sorted.length * 0.003)], hi = sorted[Math.floor(sorted.length * 0.98)];
    if (hi - lo < (opts.minContrast || 70)) return { boxes: [], lines: [], thr: 0 };
    const thr = otsu(gray);
    const ink = new Uint8Array(w * h);
    for (let y = margin; y < h - margin; y++)
      for (let x = margin; x < w - margin; x++) ink[y * w + x] = gray[y * w + x] < thr ? 1 : 0;

    // 1) แบ่งบรรทัด
    const rowInk = new Array(h).fill(0);
    for (let y = 0; y < h; y++) { let c = 0; for (let x = 0; x < w; x++) c += ink[y * w + x]; rowInk[y] = c; }
    const rowMin = Math.max(2, Math.round(w * 0.004));
    let bands = [], cur = null;
    for (let y = 0; y < h; y++) {
      if (rowInk[y] >= rowMin) { if (!cur) cur = { y0: y, y1: y }; else cur.y1 = y; }
      else if (cur) { bands.push(cur); cur = null; }
    }
    if (cur) bands.push(cur);
    // รวมบรรทัดที่ขาดกันนิดเดียว
    const mergedBands = [];
    for (const b of bands) {
      const last = mergedBands[mergedBands.length - 1];
      if (last && b.y0 - last.y1 <= (opts.bandGap || 3)) last.y1 = b.y1; else mergedBands.push({ ...b });
    }
    const maxH = Math.max(0, ...mergedBands.map((b) => b.y1 - b.y0 + 1));
    const lines = mergedBands.filter((b) => b.y1 - b.y0 + 1 >= maxH * 0.5);

    // 2) ในแต่ละบรรทัด หาช่วงคอลัมน์ที่เป็น "ตัวเลข" (สูงพอ) ตัดขีดกลาง/จุลภาคออก
    const boxes = [];
    lines.forEach((b, li) => {
      const bh = b.y1 - b.y0 + 1;
      const colInk = new Array(w).fill(0), colTall = new Array(w).fill(false);
      for (let x = 0; x < w; x++) {
        let mn = -1, mx = -1;
        for (let y = b.y0; y <= b.y1; y++) if (ink[y * w + x]) { if (mn < 0) mn = y; mx = y; colInk[x]++; }
        if (mn >= 0 && mx - mn + 1 >= bh * 0.55) colTall[x] = true;
      }
      let runs = [], r = null;
      for (let x = 0; x < w; x++) {
        if (colTall[x]) { if (!r) r = { x0: x, x1: x }; else r.x1 = x; }
        else if (r) { runs.push(r); r = null; }
      }
      if (r) runs.push(r);
      // ขยายออกไปยังคอลัมน์หมึกที่ติดกัน (เช่น ขีดบนของเลข 7)
      for (const q of runs) {
        while (q.x0 > 0 && colInk[q.x0 - 1] > 0) q.x0--;
        while (q.x1 < w - 1 && colInk[q.x1 + 1] > 0) q.x1++;
      }
      // รวมช่วงที่ซ้อนกัน/ติดกัน แล้วรวมตามช่องว่าง
      runs.sort((a, c) => a.x0 - c.x0);
      const out = [];
      for (const q of runs) {
        const last = out[out.length - 1];
        const gap = last ? q.x0 - last.x1 - 1 : Infinity;
        if (last && gap <= bh * mergeGap) last.x1 = Math.max(last.x1, q.x1); else out.push({ ...q });
      }
      for (const q of out) if (q.x1 - q.x0 + 1 >= bh * 0.1) boxes.push({ x0: q.x0, x1: q.x1, y0: b.y0, y1: b.y1, line: li });
    });
    return { boxes, lines, thr };
  }


  /* ---------- จำแนกตัวเลขด้วย template (ฟอนต์ของแอปคงที่ จึงแม่นกว่า OCR ทั่วไป) ---------- */
  const GW = 12, GH = 18;

  /** รวมกล่องตัวเลขรายหลัก (mergeGap=0) เป็นเลขชุด ตามช่องว่างแนวนอน */
  function groupDigits(boxes, gapFactor) {
    gapFactor = gapFactor == null ? 0.7 : gapFactor;
    const byLine = new Map();
    for (const b of boxes) { if (!byLine.has(b.line)) byLine.set(b.line, []); byLine.get(b.line).push(b); }
    const groups = [];
    [...byLine.keys()].sort((a, b) => a - b).forEach((li) => {
      const arr = byLine.get(li).sort((a, b) => a.x0 - b.x0);
      let cur = [];
      for (const b of arr) {
        const prev = cur[cur.length - 1];
        if (prev && b.x0 - prev.x1 - 1 > (b.y1 - b.y0 + 1) * gapFactor) { groups.push(cur); cur = []; }
        cur.push(b);
      }
      if (cur.length) groups.push(cur);
    });
    return groups;
  }

  /** ลักษณะเด่นของตัวเลขหนึ่งหลัก: กริด GWxGH ของความเข้มหมึก + สัดส่วนกว้างยาว */
  function digitFeature(gray, w, h, thr, box) {
    const isInk = (x, y) => gray[y * w + x] < thr;
    // กระชับกรอบแนวตั้งให้พอดีหมึกเฉพาะช่วงคอลัมน์นี้ (ตัดหางจุลภาคออก)
    let y0 = -1, y1 = -1;
    for (let y = box.y0; y <= box.y1; y++) {
      let any = false;
      for (let x = box.x0; x <= box.x1; x++) if (isInk(x, y)) { any = true; break; }
      if (any) { if (y0 < 0) y0 = y; y1 = y; }
    }
    if (y0 < 0) return null;
    const bw = box.x1 - box.x0 + 1, bh = y1 - y0 + 1;
    const grid = new Float32Array(GW * GH);
    for (let gy = 0; gy < GH; gy++) {
      const ya = y0 + (gy * bh) / GH, yb = y0 + ((gy + 1) * bh) / GH;
      for (let gx = 0; gx < GW; gx++) {
        const xa = box.x0 + (gx * bw) / GW, xb = box.x0 + ((gx + 1) * bw) / GW;
        let sum = 0, cnt = 0;
        for (let y = Math.floor(ya); y < Math.max(Math.floor(ya) + 1, Math.ceil(yb)); y++)
          for (let x = Math.floor(xa); x < Math.max(Math.floor(xa) + 1, Math.ceil(xb)); x++) {
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            sum += isInk(x, y) ? 1 : 0; cnt++;
          }
        grid[gy * GW + gx] = cnt ? sum / cnt : 0;
      }
    }
    return { grid, ar: bw / bh, h: bh };
  }

  function featDist(a, b) {
    let d = 0;
    for (let i = 0; i < a.grid.length; i++) { const t = a.grid[i] - b.grid[i]; d += t * t; }
    d /= a.grid.length;
    const r = a.ar - b.ar;
    return d + 3 * r * r;
  }

  /** templates: [{d:'7', grid:[...], ar}] → {digit, dist, second} */
  function classifyDigit(feat, templates) {
    let best = { d: '', dist: Infinity }, second = Infinity;
    const perDigit = {};
    for (const t of templates) {
      const dist = featDist(feat, t);
      if (perDigit[t.d] === undefined || dist < perDigit[t.d]) perDigit[t.d] = dist;
    }
    for (const [d, dist] of Object.entries(perDigit)) {
      if (dist < best.dist) { second = best.dist; best = { d, dist }; } else if (dist < second) second = dist;
    }
    return { digit: best.d, dist: best.dist, margin: second - best.dist };
  }

  /**
   * อ่านภาพส่วนหนึ่ง (เช่น ช่องรางวัล) → รายการเลขชุด ชุดละหลักๆ
   * คืน [{text, digits:[{digit,dist,margin,box}], box}] เรียงตามบรรทัดและซ้ายไปขวา
   */
  function readRegion(gray, w, h, templates, opts) {
    opts = opts || {};
    const seg = findNumberBoxes(gray, w, h, { mergeGap: 0, minContrast: opts.minContrast });
    const groups = groupDigits(seg.boxes, opts.gapFactor);
    return groups.map((g) => {
      const digits = g.map((b) => {
        const f = digitFeature(gray, w, h, seg.thr, b);
        const c = f ? classifyDigit(f, templates) : { digit: '?', dist: 9, margin: 0 };
        return { digit: c.digit, dist: c.dist, margin: c.margin, box: b, feat: f };
      });
      return { text: digits.map((d) => d.digit).join(''), digits };
    });
  }


  /** ตัดส่วนของภาพเทา (พิกัดจริง) */
  function cropGray(gray, w, h, x0, y0, x1, y1) {
    x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0));
    x1 = Math.min(w, Math.round(x1)); y1 = Math.min(h, Math.round(y1));
    const cw = Math.max(0, x1 - x0), ch = Math.max(0, y1 - y0);
    const out = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) out[y * cw + x] = gray[(y0 + y) * w + (x0 + x)];
    return { data: out, w: cw, h: ch };
  }

  /**
   * อ่านทั้งหน้าจอผลหวย (ภาพเทา w×h) → {drawNo, nums, table, conf}
   * opts.offY: เลื่อนแนวตั้ง (หน่วยพิกเซลที่ความกว้างอ้างอิง 1280)
   */
  function readScreen(gray, w, h, templates, opts) {
    opts = opts || {};
    const L = LAYOUT, s = w / L.refW, offY = (opts.offY || 0) * s;
    const segOpts = { margin: Math.max(2, Math.round(3 * s)), bandGap: Math.max(1, Math.round(3 * s)) };
    const region = (x0, y0, x1, y1, o) => {
      const c = cropGray(gray, w, h, x0 * s, y0 * s + offY, x1 * s, y1 * s + offY);
      if (c.w < 8 || c.h < 8) return [];
      if (o.invert) for (let i = 0; i < c.data.length; i++) c.data[i] = 255 - c.data[i];
      const seg = findNumberBoxes(c.data, c.w, c.h, Object.assign({ mergeGap: 0, minContrast: opts.minContrast }, segOpts));
      const groups = groupDigits(seg.boxes, o.gapFactor);
      return groups.map((g) => {
        const digits = g.map((b) => {
          const f = digitFeature(c.data, c.w, c.h, seg.thr, b);
          const r = f ? classifyDigit(f, templates) : { digit: '?', dist: 9, margin: 0 };
          return { digit: r.digit, dist: r.dist, margin: r.margin };
        });
        return { text: digits.map((d) => d.digit).join(''), digits };
      });
    };

    const dg = region(L.draw[0], L.draw[1], L.draw[2], L.draw[3], { gapFactor: 0.7, invert: true });
    const drawNo = parseDrawNo(dg.map((g) => g.text).join(''));

    const nums = {}, conf = {};
    for (const p of L.prizes) {
      const g = region(L.prizeX[0], p.y[0], L.prizeX[1], p.y[1], { gapFactor: 0.7 });
      nums[p.tier] = g.map((x) => x.text);
      conf[p.tier] = g.map((x) => Math.max(...x.digits.map((d) => d.dist)));
    }
    const table = [];
    for (let i = 0; i < 10; i++) {
      const y0 = L.tableY0 + L.rowH * i, y1 = L.tableY0 + L.rowH * (i + 1);
      table.push(region(L.tableX[0], y0, L.tableX[1], y1, { gapFactor: 0.2 }).map((g) => g.text));
    }
    return { drawNo, nums, table: table.map((r) => r.join('').split('').filter(Boolean)), conf };
  }

  /** แปลง nums -> แถวสำหรับบันทึก {tier, position, number} */
  function flattenResults(nums) {
    const rows = [];
    for (const p of LAYOUT.prizes) (nums[p.tier] || []).forEach((v, i) => rows.push({ tier: p.tier, position: i + 1, number: v }));
    return rows;
  }

  /* ---------- สถิติ ---------- */

  // gamma ไม่สมบูรณ์ (ใช้หา p-value ของ chi-square)
  function lgamma(x) {
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (let j = 0; j < 6; j++) ser += c[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }
  function gammaQ(a, x) { // Q(a,x) = 1 - P(a,x)
    if (x <= 0) return 1;
    if (x < a + 1) { // series → P
      let ap = a, sum = 1 / a, del = sum;
      for (let n = 0; n < 500; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-12) break; }
      return 1 - sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
    }
    let b = x + 1 - a, c = 1e300, d = 1 / b, h = d; // continued fraction → Q
    for (let i = 1; i < 500; i++) {
      const an = -i * (i - a); b += 2;
      d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
      c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d; const del = d * c; h *= del;
      if (Math.abs(del - 1) < 1e-12) break;
    }
    return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
  }
  function chiSquareP(stat, df) { return gammaQ(df / 2, stat / 2); }

  /**
   * วิเคราะห์ rows: [{draw_no, tier, position, number}]
   * scope: 'all' | tier code
   */
  function analyze(rows, scope) {
    const draws = [...new Set(rows.map((r) => r.draw_no))].sort();
    const drawIdx = new Map(draws.map((d, i) => [d, i]));
    const sel = scope === 'all' ? rows : rows.filter((r) => r.tier === scope);

    const counts = Array(100).fill(0);
    const lastSeen = Array(100).fill(-1);
    for (const r of sel) {
      const k = +r.number.slice(-2);
      counts[k]++;
      lastSeen[k] = Math.max(lastSeen[k], drawIdx.get(r.draw_no));
    }
    const n = sel.length;
    const lastIdx = draws.length - 1;
    const gap = lastSeen.map((s) => (s < 0 ? null : lastIdx - s));

    const tens = Array(10).fill(0), units = Array(10).fill(0);
    counts.forEach((c, k) => { tens[Math.floor(k / 10)] += c; units[k % 10] += c; });

    const parity = { even: 0, odd: 0, low: 0, high: 0 };
    for (const r of sel) {
      const u = +r.number.slice(-1);
      (u % 2 ? parity.odd++ : parity.even++);
      (u < 5 ? parity.low++ : parity.high++);
    }

    // ความถี่เลขแต่ละหลักของเลข 5 หลัก
    const pos5 = Array.from({ length: 5 }, () => Array(10).fill(0));
    let n5 = 0;
    for (const r of sel) if (r.number.length === 5) { n5++; for (let i = 0; i < 5; i++) pos5[i][+r.number[i]]++; }

    // chi-square ความสม่ำเสมอของเลขท้าย 2 ตัว
    let chi = null;
    if (n > 0) {
      const exp = n / 100;
      const stat = counts.reduce((a, c) => a + (c - exp) * (c - exp) / exp, 0);
      chi = { stat, df: 99, p: chiSquareP(stat, 99), expected: exp, reliable: exp >= 5 };
      const u = units.reduce((a, c) => a + (c - n / 10) ** 2 / (n / 10), 0);
      chi.unitsStat = u; chi.unitsP = chiSquareP(u, 9);
    }

    const order = counts.map((c, k) => ({ k, c, gap: gap[k] }));
    const top = [...order].sort((a, b) => b.c - a.c || a.k - b.k).slice(0, 10);
    const bottom = [...order].sort((a, b) => a.c - b.c || a.k - b.k).slice(0, 10);
    const longestGap = [...order].sort((a, b) => (b.gap ?? 1e9) - (a.gap ?? 1e9) || a.k - b.k).slice(0, 10);

    // เลขซ้ำภายในงวดเดียว (เลขท้าย 2 ตัวซ้ำกัน)
    let drawsWithDup = 0;
    const byDraw = new Map();
    for (const r of sel) { if (!byDraw.has(r.draw_no)) byDraw.set(r.draw_no, []); byDraw.get(r.draw_no).push(r.number.slice(-2)); }
    for (const a of byDraw.values()) if (new Set(a).size < a.length) drawsWithDup++;

    return { draws: draws.length, n, counts, gap, tens, units, parity, pos5, n5, chi, top, bottom, longestGap, drawsWithDup };
  }

  const api = { LAYOUT, TIER_NAMES, TOTAL_NUMBERS, parsePrizeText, parseUnitsText, parseDrawNo, isValidDrawNo, validate, flattenResults, analyze, chiSquareP, otsu, findNumberBoxes, groupDigits, digitFeature, classifyDigit, readRegion, featDist, GW, GH, cropGray, readScreen };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LottoCore = api;
})(typeof self !== 'undefined' ? self : this);
