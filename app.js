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

  let sb = null, user = null;
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
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    sb.auth.getSession().then(({ data }) => setUser(data.session && data.session.user));
    sb.auth.onAuthStateChange((_e, session) => setUser(session && session.user));
  }

  function setUser(u) {
    user = u || null;
    renderAuth();
    if (user) { loadSavedSet().then(refreshItems); }
    else { savedDraws = new Set(); refreshItems(); }
  }

  function renderAuth() {
    const bar = $('#authBar'); bar.replaceChildren();
    if (user) {
      bar.append(el('span', { class: 'muted' }, user.email), el('button', { onclick: () => sb.auth.signOut() }, 'ออกจากระบบ'));
      return;
    }
    const email = el('input', { type: 'email', placeholder: 'อีเมล', autocomplete: 'email' });
    const pass = el('input', { type: 'password', placeholder: 'รหัสผ่าน (6 ตัวขึ้นไป)', autocomplete: 'current-password' });
    const msg = el('span', { class: 'muted' });
    const run = async (kind) => {
      if (!sb) return;
      msg.textContent = '...';
      const fn = kind === 'in' ? sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value })
        : sb.auth.signUp({ email: email.value.trim(), password: pass.value });
      const { data, error } = await fn;
      if (error) msg.textContent = error.message;
      else if (kind === 'up' && !data.session) msg.textContent = 'สมัครแล้ว — ยืนยันอีเมลก่อนแล้วค่อยเข้าสู่ระบบ';
      else msg.textContent = '';
    };
    bar.append(email, pass, el('button', { class: 'primary', onclick: () => run('in') }, 'เข้าสู่ระบบ'), el('button', { onclick: () => run('up') }, 'สมัคร'), msg);
  }

  async function loadSavedSet() {
    savedDraws = new Set();
    if (!sb || !user) return;
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
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const g = new Uint8Array(cv.width * cv.height);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    return g;
  }

  function thumbOf(cv) {
    const t = document.createElement('canvas');
    const s = 240 / cv.width; t.width = 240; t.height = Math.round(Math.min(cv.height, cv.width * 1.1) * s);
    t.getContext('2d').drawImage(cv, 0, 0, cv.width, Math.min(cv.height, cv.width * 1.1), 0, 0, t.width, t.height);
    return t.toDataURL('image/jpeg', 0.6);
  }

  function analyzeCanvas(cv) {
    const gray = grayFromCanvas(cv);
    const r = C.readScreen(gray, cv.width, cv.height, TPL, { offY: +$('#offY').value || 0 });
    return r;
  }

  function normalizeCanvas(source, w, h) {
    const cv = document.createElement('canvas');
    const s = w > 1280 ? 1280 / w : 1;
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
    return { v, drawOk, ok: v.ok && drawOk };
  }

  function chipFor(it, ev) {
    if (it.saved) return ['บันทึกแล้ว ✓', 'ok'];
    if (it.error) return ['อ่านไม่ได้', 'bad'];
    if (!ev.drawOk) return ['เลขงวดไม่ถูกต้อง', 'bad'];
    if (ev.ok) return ['ผ่านการตรวจ ✓', 'ok'];
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

    const details = el('details', {}, el('summary', { class: 'muted' }, 'เทียบตารางสิบ/หน่วย'), el('div', { id: 'tbl-' + it.id }));
    const actions = el('div', { class: 'row', style: 'margin-top:8px' },
      el('button', { class: 'primary', onclick: () => saveItem(it, true) }, 'บันทึก'),
      el('button', { class: 'danger', onclick: () => { items = items.filter((x) => x !== it); box.remove(); updateCount(); } }, 'ลบออก'),
      el('span', { class: 'muted', id: 'is-' + it.id }));

    const body = el('div', {},
      el('div', { class: 'row' }, el('span', { class: 'muted' }, 'งวด'), drawInput, status, dup,
        el('span', { class: 'muted' }, `${it.source === 'video' ? '🎞' : '🖼'} ${it.name}${it.note ? ' · ' + it.note : ''}`)),
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
    if (!sb || !user) { if (interactive) alert('ต้องเข้าสู่ระบบก่อนบันทึก'); return false; }
    const ev = evalItem(it);
    if (!ev.drawOk) { if (interactive) alert('เลขงวดไม่ถูกต้อง'); return false; }
    if (!ev.v.structureOk) { if (interactive) alert('จำนวนเลขหรือจำนวนหลักไม่ครบ กรุณาแก้ก่อน'); return false; }
    if (interactive && !ev.v.verified && !confirm('ยังไม่ผ่านการตรวจกับตารางสิบ/หน่วย ต้องการบันทึกเลยหรือไม่?')) return false;
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
    if (!user) return alert('ต้องเข้าสู่ระบบก่อนบันทึก');
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
    if (!user) { t.replaceChildren(el('tr', {}, el('td', {}, 'เข้าสู่ระบบเพื่อดูข้อมูล'))); return; }
    try {
      const rows = await fetchAll('draws', 'id,draw_no,game,source,created_at,results(count)', 'draw_no');
      $('#drawCount').textContent = `(${rows.length} งวด)`;
      const head = el('tr', {}, el('th', {}, 'งวด'), el('th', {}, 'เกม'), el('th', {}, 'แหล่ง'), el('th', { class: 'num' }, 'จำนวนเลข'), el('th', {}, 'บันทึกเมื่อ'), el('th', {}));
      const body = rows.map((d) => el('tr', {},
        el('td', {}, d.draw_no), el('td', {}, d.game), el('td', {}, d.source),
        el('td', { class: 'num' }, d.results && d.results[0] ? d.results[0].count : 0),
        el('td', {}, new Date(d.created_at).toLocaleString('th-TH')),
        el('td', {}, el('button', { class: 'danger', onclick: async () => {
          if (!confirm('ลบงวด ' + d.draw_no + ' ?')) return;
          const { error } = await sb.from('draws').delete().eq('id', d.id);
          if (error) return alert(error.message);
          savedDraws.delete(d.draw_no); loadDraws();
        } }, 'ลบ'))));
      t.replaceChildren(head, ...body);
    } catch (e) { t.replaceChildren(el('tr', {}, el('td', {}, 'โหลดไม่สำเร็จ: ' + e.message))); }
  }

  async function exportCsv() {
    if (!user) return alert('ต้องเข้าสู่ระบบ');
    const rows = await fetchAll('v_last2', 'draw_no,tier,position,number,last2', 'draw_no');
    const csv = 'draw_no,tier,position,number,last2\n' + rows.map((r) => [r.draw_no, r.tier, r.position, r.number, r.last2].join(',')).join('\n');
    const a = el('a', { href: URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })), download: 'hanoi-results.csv' });
    document.body.append(a); a.click(); a.remove();
  }

  /* ---------- วิเคราะห์ ---------- */
  let anaRows = null;
  async function loadAna(force) {
    const out = $('#anaOut');
    if (!user) { out.replaceChildren(el('div', { class: 'card' }, 'เข้าสู่ระบบเพื่อดูการวิเคราะห์')); return; }
    if (!anaRows || force) {
      out.replaceChildren(el('div', { class: 'card' }, 'กำลังโหลด...'));
      try { anaRows = await fetchAll('v_last2', 'draw_no,tier,position,number', 'draw_no'); }
      catch (e) { out.replaceChildren(el('div', { class: 'card' }, 'โหลดไม่สำเร็จ: ' + e.message)); return; }
    }
    renderAna();
  }

  const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '—');

  function barList(values, labelFn, fmt) {
    const max = Math.max(1, ...values);
    return el('div', { class: 'bars' }, values.map((v, i) => el('div', { class: 'bar' },
      el('span', {}, labelFn(i)), el('span', {}, el('i', { style: `width:${(100 * v / max).toFixed(1)}%` })), el('span', { class: 'muted' }, fmt ? fmt(v) : v))));
  }

  function renderAna() {
    const out = $('#anaOut');
    if (!anaRows || !anaRows.length) { out.replaceChildren(el('div', { class: 'card' }, 'ยังไม่มีข้อมูล — อ่านรูปหรือวิดีโอแล้วบันทึกก่อน')); return; }
    const A = C.analyze(anaRows, $('#scope').value);
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

    if (A.n5) {
      const head = el('tr', {}, el('th', {}, 'หลักที่'), ...Array.from({ length: 10 }, (_, d) => el('th', { class: 'num' }, d)));
      const rows = A.pos5.map((arr, i) => el('tr', {}, el('td', {}, i + 1), ...arr.map((c) => el('td', { class: 'num' }, c))));
      nodes.push(el('div', { class: 'card' }, el('h2', {}, `เลข 5 หลัก: ความถี่ของเลขแต่ละหลัก (${A.n5} เลข)`), el('div', { class: 'scroll' }, el('table', { class: 't' }, head, ...rows))));
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
    out.replaceChildren(...nodes);
  }

  /* ---------- เชื่อม UI ---------- */
  function showTab(name) {
    document.querySelectorAll('nav.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    ['img', 'vid', 'draws', 'ana'].forEach((n) => { $('#tab-' + n).hidden = n !== name; });
    $('#reads').hidden = !(name === 'img' || name === 'vid') || !items.length;
    $('#settings').hidden = name === 'draws' || name === 'ana';
    if (name === 'draws') loadDraws();
    if (name === 'ana') loadAna(false);
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
  }

  if (!TPL.length) { const w = $('#cfgWarn'); w.hidden = false; w.textContent = 'ไม่พบ templates.js — อ่านภาพอัตโนมัติไม่ได้'; }
  wire(); renderAuth(); initSb(); showTab('img');
})();
