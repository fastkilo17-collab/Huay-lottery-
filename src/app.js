/* app.js — ส่วนติดต่อผู้ใช้ + Supabase */
(function () {
  'use strict';
  const C = window.LottoCore;
  const TPL = window.LottoTemplates || [];
  const SUPABASE_URL = 'https://dxrtddxskakdjkvsircw.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_S07EwPKMeuMyuGG2QHTnGA_SWnv1Ic7'; // publishable key — ปลอดภัยให้อยู่ฝั่งเว็บ (ข้อมูลป้องกันด้วย RLS)

  const $ = (s, r) => (r || document).querySelector(s);
  const el = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) e.append(kid.nodeType ? kid : document.createTextNode(kid));
    return e;
  };

  let sb = null;
  let savedDraws = new Set();
  let items = [];
  let nextId = 1;
  let stopVideo = false;

  /* ---------- Supabase / Auth ---------- */
  function initSb() {
    if (!window.supabase) {
      const w = $('#cfgWarn'); w.hidden = false;
      w.textContent = 'โหลดไลบรารี Supabase ไม่สำเร็จ (ตรวจอินเทอร์เน็ต) — อ่านภาพได้ แต่ยังบันทึกไม่ได้';
      return;
    }
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    loadSavedSet().then(refreshItems);
  }

  async function loadSavedSet() {
    savedDraws = new Set();
    if (!sb) return;
    let from = 0;
    for (;;) {
      const { data, error } = await sb.from('draws').select('draw_no').range(from, from + 999);
      if (error || !data) break;
      data.forEach((d) => savedDraws.add(d.draw_no));
      if (data.length < 1000) break;
      from += 1000;
    }
  }

  /* ---------- อ่านภาพ ---------- */
  function grayFromCanvas(cv) {
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const rgba = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const g = new Uint8Array(cv.width * cv.height);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
    return { gray: g, rgba };
  }

  function thumbOf(cv) {
    const t = document.createElement('canvas');
    const s = 240 / cv.width; t.width = 240; t.height = Math.round(Math.min(cv.height, cv.width * 1.1) * s);
    t.getContext('2d').drawImage(cv, 0, 0, cv.width, Math.min(cv.height, cv.width * 1.1), 0, 0, t.width, t.height);
    return t.toDataURL('image/jpeg', 0.6);
  }

  function analyzeCanvas(cv) {
    const { gray, rgba } = grayFromCanvas(cv);
    const r = C.readScreen(gray, cv.width, cv.height, TPL, { offY: +$('#offY').value || 0, rgba });
    return r;
  }

  function normalizeCanvas(source, w, h) { // ใช้ขนาดเดิมของภาพ ไม่ย่อ
    const cv = document.createElement('canvas');
    const s = 1;
    cv.width = Math.round(w * s); cv.height = Math.round(h * s);
    cv.getContext('2d').drawImage(source, 0, 0, cv.width, cv.height);
    return cv;
  }

  async function readImageFile(file) {
    const bmp = await createImageBitmap(file);
    const cv = normalizeCanvas(bmp, bmp.width, bmp.height);
    const r = analyzeCanvas(cv);
    addItem({ name: file.name || 'รูปจากคลิปบอร์ด', source: 'image', thumb: thumbOf(cv), width: cv.width, ...r });
  }

  function nextDrawNo() {
    const nums = [...savedDraws, ...items.map((x) => x.drawNo)].filter((d) => /^\d{10}$/.test(d)).map(Number);
    return nums.length ? String(Math.max(...nums) + 1) : '';
  }

  function addManualItem() {
    const it = addItem({ name: 'พิมพ์เอง', source: 'manual', drawNo: nextDrawNo() });
    const first = $('#item-' + it.id + ' .tier input'); if (first) first.focus();
  }

  async function handleFiles(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    for (const f of list) {
      try { await readImageFile(f); } catch (e) { addItem({ name: f.name, source: 'image', error: String(e) }); }
    }
  }

  /* ---------- รายการผลที่อ่านได้ ---------- */
  function addItem(raw) {
    const it = {
      id: nextId++, name: raw.name, source: raw.source, thumb: raw.thumb, width: raw.width,
      drawNo: raw.drawNo || '', nums: raw.nums || {}, table: raw.table || [], conf: raw.conf || {},
      error: raw.error, saved: false, note: raw.note || '',
    };
    for (const p of C.LAYOUT.prizes) if (!it.nums[p.tier]) it.nums[p.tier] = [];
    items.push(it);
    renderItem(it);
    updateCount();
    $('#reads').hidden = false;
    return it;
  }

  function evalItem(it) {
    const v = C.validate(it.nums, it.table);
    const drawOk = C.isValidDrawNo(it.drawNo);
    // งวดที่พิมพ์เอง ไม่มีตารางสิบ/หน่วยให้เทียบ: ผ่านเมื่อจำนวนเลขและจำนวนหลักครบ
    const ok = it.source === 'manual' ? v.structureOk && drawOk : v.ok && drawOk;
    return { v, drawOk, ok };
  }

  function chipFor(it, ev) {
    if (it.saved) return ['บันทึกแล้ว ✓', 'ok'];
    if (it.error) return ['อ่านไม่ได้', 'bad'];
    if (!ev.drawOk) return ['เลขงวดไม่ถูกต้อง', 'bad'];
    if (ev.ok) return [it.source === 'manual' ? 'พร้อมบันทึก ✓' : 'ผ่านการตรวจ ✓', 'ok'];
    if (!ev.v.verified && ev.v.structureOk && !ev.v.badRows.length) return ['อ่านตารางไม่ได้ — ตรวจเอง', 'warn'];
    return ['ต้องตรวจแก้', 'bad'];
  }

  function renderItem(it) {
    let box = $('#item-' + it.id);
    const fresh = !box;
    if (fresh) { box = el('div', { class: 'card', id: 'item-' + it.id }); $('#itemList').prepend(box); }
    box.replaceChildren();
    const ev = evalItem(it);
    const [chipText, chipCls] = chipFor(it, ev);

    const drawInput = el('input', {
      type: 'text', class: 'drawno', value: it.drawNo, maxlength: 10, inputmode: 'numeric', 'aria-label': 'เลขงวด',
      oninput: (e) => { e.target.value = e.target.value.replace(/\D/g, ''); it.drawNo = e.target.value; refreshStatus(it); },
    });
    const dup = savedDraws.has(it.drawNo) && !it.saved ? el('span', { class: 'chip warn' }, 'มีงวดนี้แล้ว (จะเขียนทับ)') : null;
    const status = el('span', { class: 'chip ' + chipCls, id: 'st-' + it.id }, chipText);

    const tiers = el('div', { class: 'tiers' });
    for (const p of C.LAYOUT.prizes) {
      const arr = it.nums[p.tier];
      const count = Math.max(p.n, arr.length);
      const wrap = el('div', { class: 'tier' }, el('label', {}, `${C.TIER_NAMES[p.tier]} (${p.len} หลัก)`));
      for (let i = 0; i < count; i++) {
        const inp = el('input', {
          type: 'text', value: arr[i] || '', maxlength: p.len + 1, inputmode: 'numeric', 'data-t': p.tier, 'data-i': i,
          oninput: (e) => { e.target.value = e.target.value.replace(/\D/g, ''); it.nums[p.tier][i] = e.target.value; refreshStatus(it); },
        });
        wrap.append(inp);
      }
      tiers.append(wrap);
    }

    const details = it.source === 'manual' ? el('span') : el('details', {}, el('summary', { class: 'muted' }, 'เทียบตารางสิบ/หน่วย'), el('div', { id: 'tbl-' + it.id }));
    const actions = el('div', { class: 'row', style: 'margin-top:8px' },
      el('button', { class: 'primary', onclick: () => saveItem(it, true) }, 'บันทึก'),
      el('button', { class: 'danger', onclick: () => { items = items.filter((x) => x !== it); box.remove(); updateCount(); } }, 'ลบออก'),
      el('span', { class: 'muted', id: 'is-' + it.id }));

    const body = el('div', {},
      el('div', { class: 'row' }, el('span', { class: 'muted' }, 'งวด'), drawInput, status, dup,
        el('span', { class: 'muted' }, `${it.source === 'video' ? '🎞' : it.source === 'manual' ? '✍' : '🖼'} ${it.name}${it.note ? ' · ' + it.note : ''}`)),
      it.error ? el('div', { class: 'issues' }, it.error) : tiers, details, el('ul', { class: 'issues', id: 'iss-' + it.id }), actions);
    box.append(el('div', { class: 'item' }, it.thumb ? el('img', { src: it.thumb, alt: 'ตัวอย่างภาพ' }) : el('div'), body));
    refreshStatus(it);
  }

  function refreshStatus(it) {
    const ev = evalItem(it);
    const [t, c] = chipFor(it, ev);
    const st = $('#st-' + it.id); if (st) { st.textContent = t; st.className = 'chip ' + c; }
    const iss = $('#iss-' + it.id);
    if (iss) {
      iss.replaceChildren(...ev.v.issues.map((s) => el('li', {}, s)), ...(ev.drawOk ? [] : [el('li', {}, 'เลขงวดต้องเป็นตัวเลข 10 หลัก (ปปดดวว+ลำดับ)')]));
    }
    // ไฮไลต์ช่องต้องสงสัย
    const box = $('#item-' + it.id);
    if (box) {
      box.querySelectorAll('.tier input').forEach((inp) => {
        const tier = inp.dataset.t, i = +inp.dataset.i;
        const p = C.LAYOUT.prizes.find((x) => x.tier === tier);
        const val = it.nums[tier][i] || '';
        const bad = val.length !== p.len || (ev.v.badRows.includes(+val.slice(-2, -1)) && val.length >= 2);
        inp.classList.toggle('err', bad);
        inp.classList.toggle('low', !bad && (it.conf[tier] && it.conf[tier][i] > 0.15));
      });
    }
    // ตารางเทียบ
    const tb = $('#tbl-' + it.id);
    if (tb) {
      const rows = [el('tr', {}, el('th', {}, 'สิบ'), el('th', {}, 'หน่วยในตาราง (อ่านจากภาพ)'), el('th', {}, 'หน่วยจากเลขรางวัล'))];
      for (let t = 0; t < 10; t++) {
        const got = (it.table[t] || []).join(','), exp = ev.v.expected[t].join(',');
        rows.push(el('tr', {}, el('td', {}, t), el('td', {}, got || '—'), el('td', { class: ev.v.badRows.includes(t) ? 'mis' : '' }, exp || '—')));
      }
      tb.replaceChildren(el('table', { class: 't' }, ...rows));
    }
  }

  function refreshItems() { items.forEach(renderItem); }
  function updateCount() { $('#readCount').textContent = items.length ? `(${items.length})` : ''; }

  async function saveItem(it, interactive) {
    const note = $('#is-' + it.id);
    if (!sb) { if (interactive) alert('เชื่อมต่อ Supabase ไม่ได้'); return false; }
    const ev = evalItem(it);
    if (!ev.drawOk) { if (interactive) alert('เลขงวดไม่ถูกต้อง'); return false; }
    if (!ev.v.structureOk) { if (interactive) alert('จำนวนเลขหรือจำนวนหลักไม่ครบ กรุณาแก้ก่อน'); return false; }
    if (interactive && it.source !== 'manual' && !ev.v.verified && !confirm('ยังไม่ผ่านการตรวจกับตารางสิบ/หน่วย ต้องการบันทึกเลยหรือไม่?')) return false;
    const { error } = await sb.rpc('save_draw', {
      p_draw_no: it.drawNo, p_game: $('#game').value.trim() || 'ฮานอย 27',
      p_interval_sec: +$('#interval').value || 90, p_source: it.source, p_results: C.flattenResults(it.nums),
    });
    if (error) { if (note) note.textContent = 'บันทึกไม่สำเร็จ: ' + error.message; else alert(error.message); return false; }
    it.saved = true; savedDraws.add(it.drawNo);
    renderItem(it);
    return true;
  }

  async function saveAll() {
    if (!sb) return alert('เชื่อมต่อ Supabase ไม่ได้');
    let n = 0, skipped = 0;
    for (const it of items.filter((x) => !x.saved)) {
      if (evalItem(it).ok) { if (await saveItem(it, false)) n++; } else skipped++;
    }
    alert(`บันทึก ${n} งวด` + (skipped ? ` · ข้าม ${skipped} งวดที่ยังไม่ผ่านการตรวจ` : ''));
  }

  /* ---------- วิดีโอ ---------- */
  const seekTo = (v, t) => new Promise((res) => {
    let done = false;
    const fin = () => { if (!done) { done = true; v.removeEventListener('seeked', fin); res(); } };
    v.addEventListener('seeked', fin); v.currentTime = t; setTimeout(fin, 4000);
  });

  async function runVideo(file) {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('เปิดวิดีโอไม่ได้')); });
    const dur = v.duration, step = Math.max(1, +$('#vStep').value || 5), skip = $('#vSkip').checked;
    const log = $('#vLog'), prog = $('#vProg'), stat = $('#vStat');
    log.textContent = ''; prog.max = Math.floor(dur / step) + 1; prog.value = 0;
    const cv = document.createElement('canvas');
    const sc = v.videoWidth > 1280 ? 1280 / v.videoWidth : 1;
    cv.width = Math.round(v.videoWidth * sc); cv.height = Math.round(v.videoHeight * sc);
    const ctx = cv.getContext('2d', { willReadFrequently: true });

    const done = new Set(); let cand = null, added = 0, okCount = 0, frames = 0;
    const flush = () => {
      if (!cand) return;
      addItem({ name: `${file.name} @${cand.t.toFixed(0)}s`, source: 'video', thumb: cand.thumb, width: cv.width, note: 'ต้องตรวจ', ...cand.r });
      done.add(cand.r.drawNo); added++; log.textContent += `งวด ${cand.r.drawNo}: อ่านไม่ครบ ต้องตรวจเอง\n`; cand = null;
    };
    const t0 = performance.now();
    for (let t = 0; t < dur && !stopVideo; t += step) {
      await seekTo(v, Math.min(t, dur - 0.05));
      ctx.drawImage(v, 0, 0, cv.width, cv.height);
      const r = analyzeCanvas(cv); frames++;
      prog.value = frames;
      const dn = r.drawNo;
      if (C.isValidDrawNo(dn)) {
        if (cand && cand.r.drawNo !== dn) flush();
        if (!(done.has(dn) || (skip && savedDraws.has(dn)))) {
          const ev = C.validate(r.nums, r.table);
          if (ev.ok) {
            addItem({ name: `${file.name} @${t.toFixed(0)}s`, source: 'video', thumb: thumbOf(cv), width: cv.width, ...r });
            done.add(dn); added++; okCount++; cand = null;
            log.textContent += `งวด ${dn}: ผ่านการตรวจ ✓\n`;
          } else if (!cand || ev.issues.length <= cand.n) {
            cand = { r, n: ev.issues.length, t, thumb: thumbOf(cv) };
          }
        }
      }
      const el_s = (performance.now() - t0) / 1000;
      stat.textContent = `เฟรม ${frames}/${prog.max} · พบ ${added} งวด (ผ่าน ${okCount}) · ใช้เวลา ${el_s.toFixed(0)} วินาที`;
      log.scrollTop = log.scrollHeight;
    }
    flush();
    URL.revokeObjectURL(url);
    stat.textContent += stopVideo ? ' · หยุดแล้ว' : ' · เสร็จ';
  }

  /* ---------- งวดที่บันทึก ---------- */
  async function fetchAll(table, cols, orderCol) {
    const rows = []; let from = 0;
    for (;;) {
      let q = sb.from(table).select(cols).range(from, from + 999);
      if (orderCol) q = q.order(orderCol, { ascending: false });
      const { data, error } = await q;
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) break;
      from += 1000;
    }
    return rows;
  }

  async function loadDraws() {
    const t = $('#drawTable');
    if (!sb) { t.replaceChildren(el('tr', {}, el('td', {}, 'เชื่อมต่อ Supabase ไม่ได้'))); return; }
    try {
      const rows = await fetchAll('draws', 'id,draw_no,game,source,created_at,results(count)', 'draw_no');
      $('#drawCount').textContent = `(${rows.length} งวด)`;
      const head = el('tr', {}, el('th', {}, 'งวด'), el('th', {}, 'เกม'), el('th', {}, 'แหล่ง'), el('th', { class: 'num' }, 'จำนวนเลข'), el('th', {}, 'บันทึกเมื่อ'));
      const body = rows.map((d) => el('tr', {},
        el('td', {}, d.draw_no), el('td', {}, d.game), el('td', {}, d.source),
        el('td', { class: 'num' }, d.results && d.results[0] ? d.results[0].count : 0),
        el('td', {}, new Date(d.created_at).toLocaleString('th-TH'))));
      t.replaceChildren(head, ...body);
    } catch (e) { t.replaceChildren(el('tr', {}, el('td', {}, 'โหลดไม่สำเร็จ: ' + e.message))); }
  }

  async function exportCsv() {
    if (!sb) return alert('เชื่อมต่อ Supabase ไม่ได้');
    const rows = await fetchAll('v_last2', 'draw_no,tier,position,number,last2', 'draw_no');
    const csv = 'draw_no,tier,position,number,last2\n' + rows.map((r) => [r.draw_no, r.tier, r.position, r.number, r.last2].join(',')).join('\n');
    const a = el('a', { href: URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })), download: 'hanoi-results.csv' });
    document.body.append(a); a.click(); a.remove();
  }

  /* ---------- วิเคราะห์ (เลือกหวยหลายแหล่งรวมกันได้) ---------- */
  let anaRows = null, anaSources = [], anaSel = new Set(), anaInit = false;
  const bwRowsCache = new Map();

  async function loadAna(force) {
    const out = $('#anaOut');
    if (!sb) { out.replaceChildren(el('div', { class: 'card' }, 'เชื่อมต่อ Supabase ไม่ได้')); return; }
    if (!anaRows || force) {
      out.replaceChildren(el('div', { class: 'card' }, 'กำลังโหลด...'));
      try {
        anaRows = await fetchAll('v_last2', 'draw_no,tier,position,number', 'draw_no');
        const { data, error } = await sb.from('v_backward_sources').select('*').order('slug');
        if (error) throw error;
        anaSources = [];
        const hd = new Set(anaRows.map((r) => r.draw_no)).size;
        if (hd) anaSources.push({ id: 'hanoi', label: `ฮานอย 27 (ผลจากรูป/วิดีโอ) · ${hd} งวด` });
        (data || []).forEach((src) => (src.cols || []).forEach((col) =>
          anaSources.push({ id: `bw:${src.slug}:${col}`, slug: src.slug, col, label: `${src.name} · ${col} · ${src.n} งวด` })));
        bwRowsCache.clear();
      } catch (e) { out.replaceChildren(el('div', { class: 'card' }, 'โหลดไม่สำเร็จ: ' + e.message)); return; }
      anaSel = new Set([...anaSel].filter((id) => anaSources.some((x) => x.id === id)));
      if (!anaInit && anaSources.length) { anaSel.add(anaSources[0].id); anaInit = true; }
    }
    renderSrcList();
    renderAna();
  }

  function renderSrcList() {
    const box = $('#srcList');
    box.replaceChildren(...anaSources.map((src) => el('label', { class: 'src' },
      el('input', { type: 'checkbox', checked: anaSel.has(src.id), onchange: (e) => { e.target.checked ? anaSel.add(src.id) : anaSel.delete(src.id); renderAna(); } }), ' ' + src.label)));
    if (!anaSources.length) box.textContent = 'ยังไม่มีข้อมูลให้เลือก';
  }

  async function rowsOfSource(src) {
    if (src.id === 'hanoi') { const sc = $('#scope').value; return anaRows.filter((r) => sc === 'all' || r.tier === sc); }
    if (!bwRowsCache.has(src.slug)) bwRowsCache.set(src.slug, await fetchBackwardRows(src.slug));
    return bwRowsCache.get(src.slug)
      .filter((r) => r.vals[src.col] && /^\d{2,}$/.test(r.vals[src.col]))
      .map((r) => ({ draw_no: r.draw_date, tier: src.col, position: 1, number: r.vals[src.col] }));
  }

  async function renderAna() {
    const out = $('#anaOut');
    const picked = anaSources.filter((x) => anaSel.has(x.id));
    if (!picked.length) { out.replaceChildren(el('div', { class: 'card' }, 'เลือกหวยด้านบนอย่างน้อย 1 รายการ')); return; }
    const mySeq = (renderAna.seq = (renderAna.seq || 0) + 1);
    out.replaceChildren(el('div', { class: 'card' }, 'กำลังคำนวณ...'));
    let parts;
    try { parts = await Promise.all(picked.map(async (src) => ({ src, rows: await rowsOfSource(src) }))); }
    catch (e) { out.replaceChildren(el('div', { class: 'card' }, 'โหลดไม่สำเร็จ: ' + e.message)); return; }
    if (mySeq !== renderAna.seq) return; // มีการเลือกใหม่แล้ว
    parts = parts.filter((p) => p.rows.length);
    if (!parts.length) { out.replaceChildren(el('div', { class: 'card' }, 'ไม่มีข้อมูลในรายการที่เลือก')); return; }
    let A;
    if (parts.length === 1) A = C.analyze(parts[0].rows, 'all');
    else {
      const merged = [];
      parts.forEach((p, i) => p.rows.forEach((r) => merged.push({ ...r, draw_no: i + '|' + r.draw_no })));
      A = C.analyze(merged, 'all');
      const gaps = parts.map((p) => C.analyze(p.rows, 'all').gap);
      A.gap = A.gap.map((_, k) => { let m = null; gaps.forEach((g) => { if (g[k] != null && (m == null || g[k] < m)) m = g[k]; }); return m; });
      Object.assign(A, C.rank(A.counts, A.gap));
    }
    const head = el('div', { class: 'card' }, el('h2', {}, parts.length > 1 ? `รวม ${parts.length} แหล่ง` : parts[0].src.label),
      parts.length > 1 ? el('div', { class: 'muted' }, parts.map((p) => p.src.label.replace(/ · \d+ งวด$/, '')).join(' + ')) : null,
      parts.length > 1 ? el('div', { class: 'muted' }, 'รวมจำนวนครั้งของเลขท้าย 2 ตัวจากทุกแหล่ง · "ห่างมา" = จำนวนงวดที่น้อยที่สุดในบรรดาแหล่งที่เลือก (นับงวดแยกตามแต่ละหวย)') : null);
    out.replaceChildren(head, ...analysisNodes(A));
  }

  const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '—');

  function barList(values, labelFn, fmt) {
    const max = Math.max(1, ...values);
    return el('div', { class: 'bars' }, values.map((v, i) => el('div', { class: 'bar' },
      el('span', {}, labelFn(i)), el('span', {}, el('i', { style: `width:${(100 * v / max).toFixed(1)}%` })), el('span', { class: 'muted' }, fmt ? fmt(v) : v))));
  }

  /** การ์ดวิเคราะห์ชุดเดียวกัน ใช้ทั้งหน้าผลฮานอยและหน้าย้อนหลังจากเว็บ */
  function analysisNodes(A) {
    const maxC = Math.max(1, ...A.counts);
    const nodes = [];

    nodes.push(el('div', { class: 'card' }, el('h2', {}, 'ภาพรวม'),
      el('div', { class: 'stat' },
        el('div', {}, el('b', {}, A.draws), 'งวด'), el('div', {}, el('b', {}, A.n), 'เลขที่นับ'),
        el('div', {}, el('b', {}, (A.n / 100).toFixed(1)), 'ค่าคาดหวังต่อเลข'),
        el('div', {}, el('b', {}, A.drawsWithDup), 'งวดที่มีเลขท้ายซ้ำ'))));

    // heatmap
    const heat = el('div', { class: 'heat' }, el('div', { class: 'h' }, ''));
    for (let u = 0; u < 10; u++) heat.append(el('div', { class: 'h' }, 'x' + u));
    for (let t = 0; t < 10; t++) {
      heat.append(el('div', { class: 'h' }, t + 'x'));
      for (let u = 0; u < 10; u++) {
        const k = t * 10 + u, c = A.counts[k];
        const g = A.gap[k];
        heat.append(el('div', { class: 'c', style: `--a:${(c / maxC).toFixed(2)}`, title: `เลข ${String(k).padStart(2, '0')}: ออก ${c} ครั้ง` + (g == null ? ' (ยังไม่เคยออก)' : `, ห่างมา ${g} งวด`) },
          el('b', {}, String(k).padStart(2, '0')), el('small', {}, c)));
      }
    }
    nodes.push(el('div', { class: 'card' }, el('h2', {}, 'ความถี่เลขท้าย 2 ตัว (00–99)'), el('div', { class: 'scroll' }, heat),
      el('div', { class: 'muted', style: 'margin-top:6px' }, 'ยิ่งเข้มยิ่งออกบ่อย · วางเมาส์ดูจำนวนครั้งและจำนวนงวดที่ห่างมา')));

    const list = (arr, fmt) => el('table', { class: 't' }, arr.map((x) => el('tr', {}, el('td', {}, String(x.k).padStart(2, '0')), el('td', { class: 'num' }, fmt(x)))));
    nodes.push(el('div', { class: 'card' }, el('div', { class: 'cols' },
      el('div', {}, el('h3', {}, 'ออกบ่อยสุด 10 อันดับ'), list(A.top, (x) => `${x.c} ครั้ง`)),
      el('div', {}, el('h3', {}, 'ออกน้อยสุด 10 อันดับ'), list(A.bottom, (x) => `${x.c} ครั้ง`)),
      el('div', {}, el('h3', {}, 'ห่างจากการออกครั้งล่าสุดนานสุด'), list(A.longestGap, (x) => (x.gap == null ? 'ไม่เคยออก' : `${x.gap} งวด`))))));

    nodes.push(el('div', { class: 'card' }, el('div', { class: 'cols' },
      el('div', {}, el('h3', {}, 'หลักสิบ (0–9)'), barList(A.tens, (i) => i, (v) => pct(v, A.n))),
      el('div', {}, el('h3', {}, 'หลักหน่วย (0–9)'), barList(A.units, (i) => i, (v) => pct(v, A.n))),
      el('div', {}, el('h3', {}, 'คู่/คี่ · ต่ำ/สูง (หลักหน่วย)'),
        el('table', { class: 't' },
          el('tr', {}, el('td', {}, 'คู่'), el('td', { class: 'num' }, `${A.parity.even} (${pct(A.parity.even, A.n)})`)),
          el('tr', {}, el('td', {}, 'คี่'), el('td', { class: 'num' }, `${A.parity.odd} (${pct(A.parity.odd, A.n)})`)),
          el('tr', {}, el('td', {}, 'ต่ำ 0–4'), el('td', { class: 'num' }, `${A.parity.low} (${pct(A.parity.low, A.n)})`)),
          el('tr', {}, el('td', {}, 'สูง 5–9'), el('td', { class: 'num' }, `${A.parity.high} (${pct(A.parity.high, A.n)})`)))))));

    if (A.nPos && A.posLen >= 2) {
      const head = el('tr', {}, el('th', {}, 'หลักที่'), ...Array.from({ length: 10 }, (_, d) => el('th', { class: 'num' }, d)));
      const rows = A.pos.map((arr, i) => el('tr', {}, el('td', {}, i + 1), ...arr.map((c) => el('td', { class: 'num' }, c))));
      nodes.push(el('div', { class: 'card' }, el('h2', {}, `เลข ${A.posLen} หลัก: ความถี่ของเลขแต่ละหลัก (${A.nPos} เลข)`), el('div', { class: 'scroll' }, el('table', { class: 't' }, head, ...rows))));
    }

    if (A.chi) {
      const c = A.chi;
      const verdict = !c.reliable ? ['ข้อมูลยังน้อยเกินไปที่จะสรุป (ควรมีเลขอย่างน้อย ~500 ตัว)', 'warn']
        : c.p < 0.01 ? ['ต่างจากการกระจายสม่ำเสมออย่างมีนัยสำคัญ — ควรตรวจว่าอ่านภาพผิดหรือมีงวดซ้ำ/ขาดหรือไม่', 'bad']
        : c.p < 0.05 ? ['มีแนวโน้มต่างจากสม่ำเสมอเล็กน้อย (p < 0.05) — ยังไม่ควรสรุปเมื่อทดสอบหลายแบบ', 'warn']
        : ['สอดคล้องกับการกระจายสม่ำเสมอ (ไม่พบความผิดปกติ)', 'ok'];
      nodes.push(el('div', { class: 'card' }, el('h2', {}, 'ทดสอบ chi-square: เลขท้าย 2 ตัวกระจายสม่ำเสมอหรือไม่'),
        el('table', { class: 't' },
          el('tr', {}, el('td', {}, 'เลขท้าย 2 ตัว (df = 99)'), el('td', { class: 'num' }, `χ² = ${c.stat.toFixed(1)} · p = ${c.p.toFixed(3)}`)),
          el('tr', {}, el('td', {}, 'หลักหน่วย (df = 9)'), el('td', { class: 'num' }, `χ² = ${c.unitsStat.toFixed(1)} · p = ${c.unitsP.toFixed(3)}`))),
        el('p', {}, el('span', { class: 'chip ' + verdict[1] }, verdict[0])),
        el('div', { class: 'muted' }, 'ถ้า p สูง = ไม่มีหลักฐานว่าเลขไม่สุ่ม · ผลนี้บอกได้แค่ความสม่ำเสมอของอดีต ไม่ได้บอกเลขงวดถัดไป')));
    }
    return nodes;
  }


  /* ---------- ย้อนหลังจากเว็บ (นำเข้าไฟล์ที่บันทึกจาก exphuay.com) ---------- */
  function qpToBytes(str) {
    str = str.replace(/=\r?\n/g, '');
    const out = [];
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(str.substr(i + 1, 2))) { out.push(parseInt(str.substr(i + 1, 2), 16)); i += 2; }
      else out.push(str.charCodeAt(i) & 255);
    }
    return Uint8Array.from(out);
  }

  /** รับไฟล์ .html/.htm/.mht/.mhtml → ข้อความ HTML */
  async function fileToHtml(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    let latin = '';
    for (let i = 0; i < buf.length; i += 8192) latin += String.fromCharCode.apply(null, buf.subarray(i, i + 8192)); // 1 ไบต์ = 1 ตัวอักษร (TextDecoder('latin1') ในเบราว์เซอร์เป็น windows-1252 จึงใช้ไม่ได้)
    if (!/^(From:|MIME-Version:|Subject:|Date:|Content-Type: multipart)/i.test(latin.slice(0, 400)) && !/MIME-Version:/i.test(latin.slice(0, 2000))) {
      return new TextDecoder('utf-8').decode(buf);
    }
    const bm = latin.match(/boundary="?([^"\r\n;]+)"?/i);
    if (!bm) throw new Error('อ่านโครงสร้างไฟล์ .mht ไม่ได้');
    const parts = latin.split('--' + bm[1]);
    for (const part of parts) {
      const cut = part.search(/\r?\n\r?\n/);
      if (cut < 0) continue;
      const head = part.slice(0, cut), body = part.slice(cut).replace(/^\r?\n\r?\n/, '');
      if (!/Content-Type:\s*text\/html/i.test(head)) continue;
      const enc = (head.match(/Content-Transfer-Encoding:\s*(\S+)/i) || [])[1] || '7bit';
      const cs = (head.match(/charset="?([\w-]+)"?/i) || [])[1] || 'utf-8';
      let bytes;
      if (/quoted-printable/i.test(enc)) bytes = qpToBytes(body);
      else if (/base64/i.test(enc)) bytes = Uint8Array.from(atob(body.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
      else bytes = Uint8Array.from(body, (c) => c.charCodeAt(0) & 255);
      return new TextDecoder(cs).decode(bytes);
    }
    throw new Error('ไม่พบหน้า HTML ในไฟล์ .mht');
  }

  /** แปลงหน้า "ผลย้อนหลัง" ของ exphuay.com → {slug, name, columns, rows:[{date, vals}]} */
  function parseBackwardHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = [], seen = new Set();
    let slug = '', name = '', columns = [];
    doc.querySelectorAll('a[href*="/result/"]').forEach((a) => {
      const m = (a.getAttribute('href') || '').match(/\/result\/([^?\/#]+)\?date=(\d{4}-\d{2}-\d{2})/);
      const li = a.closest('li');
      if (!m || !li || seen.has(m[2])) return;
      const spans = [...li.children].filter((x) => x.tagName === 'SPAN');
      if (spans.length < 2) return;
      if (!slug) {
        slug = m[1].toLowerCase().replace(/[^a-z0-9_-]/g, '');
        name = a.textContent.split('|')[0].trim() || slug;
        const hdr = li.parentElement && li.parentElement.previousElementSibling;
        if (hdr) columns = [...hdr.children].filter((x) => x.tagName === 'SPAN').slice(1).map((x) => x.textContent.trim());
      }
      const vals = {};
      spans.slice(1).forEach((sp, i) => { const t = sp.textContent.trim(); if (t) vals[columns[i] || 'ช่อง ' + (i + 1)] = t; });
      if (!Object.keys(vals).length) return;
      seen.add(m[2]); rows.push({ date: m[2], vals });
    });
    if (!slug) throw new Error('ไม่พบตารางผลย้อนหลังในไฟล์นี้ (ต้องเป็นหน้า exphuay.com/backward/...)');
    return { slug, name, columns, rows };
  }

  async function importBackwardFiles(files) {
    const log = $('#bwLog');
    if (!sb) { log.textContent = 'เชื่อมต่อ Supabase ไม่ได้'; return; }
    log.textContent = '';
    const bySlug = new Map();
    for (const f of files) {
      try {
        const r = parseBackwardHtml(await fileToHtml(f));
        const g = bySlug.get(r.slug) || { name: r.name, rows: new Map() };
        r.rows.forEach((x) => g.rows.set(x.date, x));
        bySlug.set(r.slug, g);
        log.textContent += `${f.name}: ${r.name} ${r.rows.length} งวด (${r.rows[r.rows.length - 1].date} → ${r.rows[0].date})\n`;
      } catch (e) { log.textContent += `${f.name}: ${e.message}\n`; }
    }
    for (const [slug, g] of bySlug) {
      const arr = [...g.rows.values()];
      for (let i = 0; i < arr.length; i += 500) {
        const { error } = await sb.rpc('import_backward', { p_slug: slug, p_name: g.name, p_rows: arr.slice(i, i + 500) });
        if (error) { log.textContent += `บันทึก ${g.name} ไม่สำเร็จ: ${error.message}\n`; return; }
      }
      log.textContent += `✓ บันทึก ${g.name} รวม ${arr.length} งวดแล้ว\n`;
    }
    await loadBackwardList(Array.from(bySlug.keys())[0]);
  }

  async function fetchBackwardRows(slug) {
    const rows = []; let from = 0;
    for (;;) {
      const { data, error } = await sb.from('lotto_backward').select('draw_date,vals').eq('slug', slug).order('draw_date', { ascending: true }).range(from, from + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) break;
      from += 1000;
    }
    return rows;
  }

  const bwMeta = new Map();
  async function loadBackwardList(select) {
    const sel = $('#bwSlug');
    if (!sb) return;
    const { data, error } = await sb.from('v_backward_sources').select('*').order('slug');
    if (error) { $('#bwOut').replaceChildren(el('div', { class: 'card' }, 'โหลดไม่สำเร็จ: ' + error.message)); return; }
    bwMeta.clear(); (data || []).forEach((r) => bwMeta.set(r.slug, { name: r.name, cols: r.cols || [], n: r.n }));
    const cur = select || sel.value;
    sel.replaceChildren(...[...bwMeta].map(([slug, m]) => el('option', { value: slug }, `${m.name} (${m.n})`)));
    if (cur && bwMeta.has(cur)) sel.value = cur;
    renderManualBw();
    if (!bwMeta.size) { $('#bwOut').replaceChildren(el('div', { class: 'card' }, 'ยังไม่มีข้อมูล — นำเข้าไฟล์ หรือพิมพ์เลขเองด้านบน')); $('#bwCol').replaceChildren(); return; }
    await renderBackward(true);
  }

  /* ----- พิมพ์เลขย้อนหลังเอง ----- */
  const slugify = (name) => {
    const ascii = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (ascii.length >= 3) return ascii.slice(0, 40);
    let h = 5381; for (const ch of name) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
    return 'custom-' + h.toString(36);
  };

  function renderManualBw() {
    const msel = $('#mSlug'), keep = msel.value;
    msel.replaceChildren(...[...bwMeta].map(([slug, m]) => el('option', { value: slug }, m.name)), el('option', { value: '__new' }, '＋ หวยใหม่…'));
    if (keep && (bwMeta.has(keep) || keep === '__new')) msel.value = keep;
    else if (!bwMeta.size) msel.value = '__new';
    const isNew = msel.value === '__new';
    $('#mNew').hidden = !isNew;
    const cols = isNew ? $('#mCols').value.split(',').map((x) => x.trim()).filter(Boolean) : (bwMeta.get(msel.value) || { cols: [] }).cols;
    const box = $('#mVals');
    const old = Object.fromEntries([...box.querySelectorAll('input')].map((i) => [i.dataset.col, i.value]));
    box.replaceChildren(...cols.map((c) => el('label', {}, c + ' ', el('input', { type: 'text', inputmode: 'numeric', 'data-col': c, value: old[c] || '', style: 'width:90px;text-align:center' }))));
    if (!$('#mDate').value) $('#mDate').value = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  }

  async function saveManualBw() {
    const msg = $('#mMsg');
    if (!sb) { msg.textContent = 'เชื่อมต่อ Supabase ไม่ได้'; return; }
    const isNew = $('#mSlug').value === '__new';
    const name = isNew ? $('#mName').value.trim() : bwMeta.get($('#mSlug').value).name;
    if (!name) { msg.textContent = 'ใส่ชื่อหวยก่อน'; return; }
    const slug = isNew ? slugify(name) : $('#mSlug').value;
    const date = $('#mDate').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { msg.textContent = 'เลือกวันที่ก่อน'; return; }
    const vals = {};
    for (const i of $('#mVals').querySelectorAll('input')) {
      const v = i.value.trim();
      if (!v) continue;
      if (!/^\d+$/.test(v)) { msg.textContent = `"${i.dataset.col}" ต้องเป็นตัวเลข`; return; }
      vals[i.dataset.col] = v;
    }
    if (!Object.keys(vals).length) { msg.textContent = 'ใส่เลขอย่างน้อย 1 ช่อง'; return; }
    const { error } = await sb.rpc('import_backward', { p_slug: slug, p_name: name, p_rows: [{ date, vals }] });
    if (error) { msg.textContent = 'บันทึกไม่สำเร็จ: ' + error.message; return; }
    msg.textContent = `✓ บันทึก ${name} วันที่ ${date} แล้ว`;
    $('#mVals').querySelectorAll('input').forEach((i) => { i.value = ''; });
    bwCache = null; bwRowsCache.clear(); anaRows = anaRows; // ให้โหลดใหม่
    await loadBackwardList(slug);
  }

  let bwCache = null;
  async function renderBackward(reload) {
    const out = $('#bwOut'), slug = $('#bwSlug').value;
    if (!slug) return;
    if (reload || !bwCache || bwCache.slug !== slug) {
      out.replaceChildren(el('div', { class: 'card' }, 'กำลังโหลด...'));
      try { bwCache = { slug, rows: await fetchBackwardRows(slug) }; }
      catch (e) { out.replaceChildren(el('div', { class: 'card' }, 'โหลดไม่สำเร็จ: ' + e.message)); return; }
      const cols = []; bwCache.rows.forEach((r) => Object.keys(r.vals).forEach((k) => { if (!cols.includes(k)) cols.push(k); }));
      bwCache.cols = cols;
      const colSel = $('#bwCol'), prev = colSel.value;
      colSel.replaceChildren(...cols.map((c) => el('option', { value: c }, c)));
      if (cols.includes(prev)) colSel.value = prev;
    }
    const { rows, cols } = bwCache, col = $('#bwCol').value;
    const nodes = [];
    nodes.push(el('div', { class: 'card' }, el('h2', {}, 'ภาพรวม'), el('div', { class: 'stat' },
      el('div', {}, el('b', {}, rows.length), 'งวดที่เก็บไว้'),
      el('div', {}, el('b', {}, rows.length ? rows[0].draw_date : '—'), 'เก่าสุด'),
      el('div', {}, el('b', {}, rows.length ? rows[rows.length - 1].draw_date : '—'), 'ล่าสุด'))));
    const latest = rows.slice(-60).reverse();
    nodes.push(el('div', { class: 'card' }, el('h2', {}, 'ผลย้อนหลัง (ล่าสุด 60 งวด)'), el('div', { class: 'scroll', style: 'max-height:340px;overflow:auto' },
      el('table', { class: 't' }, el('tr', {}, el('th', {}, 'วันที่'), ...cols.map((c) => el('th', { class: 'num' }, c))),
        ...latest.map((r) => el('tr', {}, el('td', {}, r.draw_date), ...cols.map((c) => el('td', { class: 'num' }, r.vals[c] || '—'))))))));
    const series = [];
    rows.forEach((r) => { const v = r.vals[col]; if (v && /^\d{2,}$/.test(v)) series.push({ draw_no: r.draw_date, tier: col, position: 1, number: v }); });
    if (series.length) {
      nodes.push(el('h2', { style: 'margin:16px 0 8px' }, 'สถิติ: ' + col + ` (${series.length} งวด)`));
      nodes.push(...analysisNodes(C.analyze(series, 'all')));
    } else nodes.push(el('div', { class: 'card' }, 'คอลัมน์นี้ไม่ใช่ตัวเลข จึงไม่มีสถิติ'));
    out.replaceChildren(...nodes);
  }

  /* ---------- เชื่อม UI ---------- */
  function showTab(name) {
    document.querySelectorAll('nav.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    ['img', 'vid', 'draws', 'ana', 'bw'].forEach((n) => { $('#tab-' + n).hidden = n !== name; });
    $('#reads').hidden = !(name === 'img' || name === 'vid') || !items.length;
    $('#settings').hidden = name === 'draws' || name === 'ana' || name === 'bw';
    if (name === 'draws') loadDraws();
    if (name === 'ana') loadAna(false);
    if (name === 'bw' && !bwCache) loadBackwardList();
  }

  function wire() {
    document.querySelectorAll('nav.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
    const drop = $('#drop');
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
    $('#fileImg').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
    document.addEventListener('paste', (e) => { if (e.clipboardData && e.clipboardData.files.length) handleFiles(e.clipboardData.files); });

    $('#vStart').addEventListener('click', async () => {
      const f = $('#fileVid').files[0];
      if (!f) return alert('เลือกไฟล์วิดีโอก่อน');
      stopVideo = false; $('#vStart').disabled = true; $('#vStop').disabled = false;
      try { await runVideo(f); } catch (e) { $('#vStat').textContent = 'ผิดพลาด: ' + e.message; }
      $('#vStart').disabled = false; $('#vStop').disabled = true;
      $('#reads').hidden = !items.length;
    });
    $('#vStop').addEventListener('click', () => { stopVideo = true; });
    $('#saveAll').addEventListener('click', saveAll);
    $('#clearAll').addEventListener('click', () => { if (confirm('ล้างรายการที่อ่านได้ทั้งหมด (ที่ยังไม่บันทึกจะหาย)?')) { items = []; $('#itemList').replaceChildren(); updateCount(); $('#reads').hidden = true; } });
    $('#reloadDraws').addEventListener('click', loadDraws);
    $('#exportCsv').addEventListener('click', exportCsv);
    $('#reloadAna').addEventListener('click', () => loadAna(true));
    $('#scope').addEventListener('change', () => anaRows && renderAna());
    $('#srcAll').addEventListener('click', () => { anaSources.forEach((x) => anaSel.add(x.id)); renderSrcList(); renderAna(); });
    $('#srcNone').addEventListener('click', () => { anaSel.clear(); renderSrcList(); renderAna(); });
    $('#fileBw').addEventListener('change', (e) => { importBackwardFiles([...e.target.files]); e.target.value = ''; });
    $('#bwSlug').addEventListener('change', () => renderBackward(true));
    $('#mSlug').addEventListener('change', renderManualBw);
    $('#mCols').addEventListener('input', renderManualBw);
    $('#mSave').addEventListener('click', saveManualBw);
    $('#addManual').addEventListener('click', addManualItem);
    $('#bwCol').addEventListener('change', () => renderBackward(false));
  }

  if (!TPL.length) { const w = $('#cfgWarn'); w.hidden = false; w.textContent = 'ไม่พบ templates.js — อ่านภาพอัตโนมัติไม่ได้'; }
  wire(); initSb(); showTab('img');
})();
