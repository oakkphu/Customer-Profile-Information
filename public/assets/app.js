'use strict';
/* Customer Profile Database — frontend SPA */
const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
const app = $('#app');

const state = {
  authed: false,
  meta: null,           // { businessTypes, systems, hardware }
  customers: [],
  q: '',
  typeFilter: '',
  current: null,        // detail customer
  draft: null,          // form model
  step: 1,
  uploadKind: null,     // 'logo' | 'storefront' while uploading
  keepLogo: [],         // existing file objects kept on edit
  keepStorefront: [],
  newLogo: [],          // [{name, dataUrl}]
  newStorefront: [],
};

const BUSINESS_FALLBACK = [
  { en: 'Restaurant', th: 'ร้านอาหาร' }, { en: 'Café / Coffee Shop', th: 'คาเฟ่ / ร้านกาแฟ' },
  { en: 'Bar / Pub', th: 'บาร์ / ผับ' }, { en: 'Bakery / Dessert Shop', th: 'ร้านเบเกอรี่ / ร้านขนม' },
  { en: 'Fast Food / Quick Service Restaurant (QSR)', th: 'ร้านอาหารจานด่วน' },
  { en: 'Food Court / Food Stall', th: 'ศูนย์อาหาร / ร้านอาหารแบบคีออส' },
  { en: 'Retail Store', th: 'ร้านค้าปลีก' }, { en: 'Convenience Store', th: 'ร้านสะดวกซื้อ' },
  { en: 'Supermarket / Grocery Store', th: 'ซูเปอร์มาร์เก็ต / ร้านขายของชำ' },
  { en: 'Fashion / Apparel Store', th: 'ร้านเสื้อผ้า / แฟชั่น' },
  { en: 'Beauty / Cosmetics Store', th: 'ร้านเครื่องสำอาง' },
  { en: 'Salon / Spa', th: 'ร้านเสริมสวย / สปา' }, { en: 'Pharmacy', th: 'ร้านขายยา' },
  { en: 'Hotel / Resort', th: 'โรงแรม / รีสอร์ต' }, { en: 'Franchise', th: 'ธุรกิจแฟรนไชส์' },
  { en: 'Wholesale', th: 'ธุรกิจค้าส่ง' }, { en: 'Service Business', th: 'ธุรกิจบริการ' },
  { en: 'Other', th: 'อื่น ๆ' },
];
const SYSTEMS_FALLBACK = [
  'App POS', 'App KDS', 'App Kiosk', 'Web CRM', 'App Cashier Ordering', 'App Staff Ordering',
  'Web Self Ordering (Order Only)', 'Web Self Ordering (Pay First)', 'Web Self Ordering (Pay Later)',
  'Web Self Ordering (Pick Up)', 'Web Booking', 'Web QTV', 'Web BI Dashboard', 'Web Report',
  'ERP (KNAP / Others)', 'Payment API (KBank / BBL / Others)',
];
const HW_FALLBACK = ['POS', 'Kiosk', 'Printer', 'Kitchen Printer', 'Customer Display', 'KDS Screen', 'Cash Drawer', 'Barcode Scanner', 'Handheld Scanner'];

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const none = '<span class="none">—</span>';

function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
    d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

let toastTimer = null;
function toast(msg, isErr) {
  let t = $('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

async function api(path, opts) {
  opts = opts || {};
  const init = { method: opts.method || 'GET', headers: {} };
  if (opts.json !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.json); }
  const r = await fetch(path, init);
  if (r.status === 401 && state.authed) { state.authed = false; renderLogin(); throw new Error('unauthorized'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
  return data;
}

/* ================= LOGIN ================= */
function renderLogin(errMsg) {
  document.title = 'เข้าสู่ระบบ — Customer Profile Database';
  app.innerHTML = `
  <div class="login-wrap">
    <form class="login-card" id="loginForm">
      <div class="login-logo">🗄️</div>
      <h1>Customer Profile Database</h1>
      <div class="sub">ระบบข้อมูลโปรไฟล์ลูกค้า • THANVASU (Internal Use Only)</div>
      ${errMsg ? `<div class="login-err" style="display:block">${esc(errMsg)}</div>` : '<div class="login-err" id="loginErr"></div>'}
      <label class="req">รหัสผ่าน</label>
      <input type="password" id="pw" placeholder="••••••••" autocomplete="current-password" autofocus>
      <button class="btn" style="width:100%;margin-top:16px" type="submit">🔓 เข้าสู่ระบบ</button>
      <div class="login-hint">🔐 เข้าถึงเฉพาะผู้ที่มีรหัสผ่านเท่านั้น</div>
    </form>
  </div>`;
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#loginForm button[type=submit]');
    btn.disabled = true; btn.textContent = 'กำลังตรวจสอบ…';
    try {
      await api('/api/login', { method: 'POST', json: { password: $('#pw').value } });
      state.authed = true;
      await loadMeta();
      await loadCustomers();
      location.hash = '';
      renderDashboard();
    } catch (err) {
      const box = $('#loginErr');
      box.textContent = err.message === 'unauthorized' ? 'รหัสผ่านไม่ถูกต้อง กรุณาลองอีกครั้ง' : err.message;
      box.style.display = 'block';
      btn.disabled = false; btn.textContent = '🔓 เข้าสู่ระบบ';
    }
  });
}

/* ================= SHELL ================= */
function shell(content, active) {
  document.title = 'Customer Profile Database — THANVASU';
  app.innerHTML = `
  <div class="topbar">
    <div class="brand">🗄️ Customer Profile Database <small>THANVASU</small></div>
    <div class="spacer"></div>
    <button class="btn ghost sm" id="navHome">📋 รายการลูกค้า</button>
    <button class="btn sm" id="navNew">＋ เพิ่มลูกค้า</button>
    <button class="btn ghost sm" id="navLogout">ออกจากระบบ</button>
  </div>
  <div class="container">${content}</div>`;
  $('#navHome').onclick = () => { location.hash = ''; };
  $('#navNew').onclick = () => { location.hash = '#new'; };
  $('#navLogout').onclick = async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch (e) {}
    state.authed = false;
    renderLogin();
  };
}

/* ================= DASHBOARD ================= */
function bizLabel(t) {
  const m = (state.meta ? state.meta.businessTypes : BUSINESS_FALLBACK).find(b => b.en === t);
  if (m) return m.th;
  if (t === 'Other') return 'อื่น ๆ';
  return t;
}
function filtered() {
  const q = state.q.trim().toLowerCase();
  return state.customers.filter(c => {
    if (state.typeFilter && c.businessType !== state.typeFilter) return false;
    if (!q) return true;
    return [c.code, c.shopNameTh, c.shopNameEn, c.companyNameTh, c.companyNameEn, c.ownerName, c.coordinatorName, c.contactEmail, c.ownerPhone, c.coordinatorPhone]
      .join(' ').toLowerCase().includes(q);
  });
}
function renderDashboard() {
  const list = filtered();
  const types = state.meta ? state.meta.businessTypes : BUSINESS_FALLBACK;
  const cards = list.map(c => {
    const sysCount = (c.systems || []).length;
    return `
    <div class="cust-card" data-id="${esc(c.id)}">
      <div class="head">
        ${c.logoUrl ? `<img class="cust-thumb" src="${esc(c.logoUrl)}" alt="">` : `<div class="cust-thumb ph">🏪</div>`}
        <div style="min-width:0">
          <div class="name">${esc(c.shopNameTh || c.shopNameEn || '(ไม่มีชื่อ)')}</div>
          <div class="company">${esc(c.shopNameEn && c.shopNameTh ? c.shopNameEn : (c.companyNameTh || c.companyNameEn || ''))}</div>
        </div>
      </div>
      <div class="cust-meta">
        <span class="badge">${esc(c.code || '')}</span>
        <span class="badge gray">${esc(bizLabel(c.businessType) || 'ไม่ระบุ')}</span>
        ${c.branchCount ? `<span class="badge gray">${esc(c.branchCount)} สาขา</span>` : ''}
      </div>
      <div>${(c.systems || []).slice(0, 4).map(s => `<span class="sys-chip">${esc(s)}</span>`).join('')}${sysCount > 4 ? `<span class="sys-chip">+${sysCount - 4}</span>` : ''}</div>
      <div class="cust-foot">
        <span>👤 ${esc(c.ownerNickname || c.ownerName || '—')}</span>
        <span>📅 ${esc(fmtDate(c.startDate) || '—')}</span>
      </div>
    </div>`;
  }).join('');

  shell(`
    <div class="page-head">
      <h2>รายการลูกค้า</h2>
      <span class="count">${list.length} รายการ${state.customers.length !== list.length ? ' (จากทั้งหมด ' + state.customers.length + ')' : ''}</span>
      <div class="spacer"></div>
    </div>
    <div class="toolbar">
      <input type="search" id="q" placeholder="🔍 ค้นหาชื่อร้าน บริษัท เจ้าของ เบอร์ อีเมล รหัส…" value="${esc(state.q)}">
      <select id="typeFilter">
        <option value="">ประเภทธุรกิจทั้งหมด</option>
        ${types.map(t => `<option value="${esc(t.en)}" ${state.typeFilter === t.en ? 'selected' : ''}>${esc(t.th)}</option>`).join('')}
      </select>
    </div>
    ${state.customers.length === 0 ? `
      <div class="empty"><div class="big">🗂️</div><div>ยังไม่มีข้อมูลลูกค้า</div>
      <button class="btn" style="margin-top:14px" onclick="location.hash='#new'">＋ เพิ่มลูกค้ารายแรก</button></div>`
      : list.length === 0 ? `<div class="empty"><div class="big">🔍</div><div>ไม่พบรายการที่ตรงกับการค้นหา</div></div>`
      : `<div class="grid">${cards}</div>`}
  `, 'home');

  $('#q').addEventListener('input', e => { state.q = e.target.value; refreshListOnly(); });
  $('#typeFilter').addEventListener('change', e => { state.typeFilter = e.target.value; refreshListOnly(); });
  $$('.cust-card').forEach(el => el.onclick = () => { location.hash = '#c/' + el.dataset.id; });
}
function refreshListOnly() {
  // re-render only the list area to keep focus in search box
  const list = filtered();
  const gridHost = $('.container');
  const head = $('.page-head .count');
  if (head) head.innerHTML = `${list.length} รายการ${state.customers.length !== list.length ? ' (จากทั้งหมด ' + state.customers.length + ')' : ''}`;
  const grid = gridHost.querySelector('.grid');
  const emptyBox = gridHost.querySelector('.empty');
  const cards = list.map(c => {
    const sysCount = (c.systems || []).length;
    return `
    <div class="cust-card" data-id="${esc(c.id)}">
      <div class="head">
        ${c.logoUrl ? `<img class="cust-thumb" src="${esc(c.logoUrl)}" alt="">` : `<div class="cust-thumb ph">🏪</div>`}
        <div style="min-width:0">
          <div class="name">${esc(c.shopNameTh || c.shopNameEn || '(ไม่มีชื่อ)')}</div>
          <div class="company">${esc(c.shopNameEn && c.shopNameTh ? c.shopNameEn : (c.companyNameTh || c.companyNameEn || ''))}</div>
        </div>
      </div>
      <div class="cust-meta">
        <span class="badge">${esc(c.code || '')}</span>
        <span class="badge gray">${esc(bizLabel(c.businessType) || 'ไม่ระบุ')}</span>
        ${c.branchCount ? `<span class="badge gray">${esc(c.branchCount)} สาขา</span>` : ''}
      </div>
      <div>${(c.systems || []).slice(0, 4).map(s => `<span class="sys-chip">${esc(s)}</span>`).join('')}${sysCount > 4 ? `<span class="sys-chip">+${sysCount - 4}</span>` : ''}</div>
      <div class="cust-foot">
        <span>👤 ${esc(c.ownerNickname || c.ownerName || '—')}</span>
        <span>📅 ${esc(fmtDate(c.startDate) || '—')}</span>
      </div>
    </div>`;
  }).join('');
  if (state.customers.length === 0) { /* keep initial empty state */ return; }
  if (list.length === 0) {
    if (grid) grid.outerHTML = '<div class="empty"><div class="big">🔍</div><div>ไม่พบรายการที่ตรงกับการค้นหา</div></div>';
  } else {
    if (emptyBox) emptyBox.outerHTML = `<div class="grid">${cards}</div>`;
    else if (grid) grid.innerHTML = cards;
  }
  $$('.cust-card').forEach(el => el.onclick = () => { location.hash = '#c/' + el.dataset.id; });
}

/* ================= DETAIL ================= */
function checkItem(label, on) {
  return `<span class="check-item ${on ? 'on' : 'off'}"><span class="box">${on ? '✓' : ''}</span>${esc(label)}</span>`;
}
function renderDetail() {
  const c = state.current;
  if (!c) { location.hash = ''; return; }
  const hw = c.hardware || {};
  const hwItems = (state.meta ? state.meta.hardware : HW_FALLBACK);
  const sys = c.systems || [];

  shell(`
    <a class="back-link" href="#">← กลับไปหน้ารายการ</a>
    <div class="detail-hero">
      ${c.logoUrl ? `<img class="logo" src="${esc(c.logoUrl)}" alt="logo">` : `<div class="logo-ph">🏪</div>`}
      <div>
        <h2>${esc(c.shopNameTh || c.shopNameEn || '(ไม่มีชื่อ)')}</h2>
        <div class="sub">${esc([c.shopNameEn, c.companyNameTh, c.companyNameEn].filter(Boolean).join(' • ') || '—')}</div>
        <div style="margin-top:8px" class="cust-meta">
          <span class="badge">${esc(c.code || '')}</span>
          <span class="badge gray">${esc(bizLabel(c.businessType) || 'ไม่ระบุ')}</span>
          ${c.branchCount ? `<span class="badge gray">${esc(c.branchCount)} สาขา</span>` : ''}
        </div>
      </div>
      <div class="actions">
        <button class="btn" id="btnEdit">✏️ แก้ไข</button>
        <button class="btn danger" id="btnDelete">🗑️ ลบ</button>
      </div>
    </div>

    <div class="detail-grid">
      <div class="panel">
        <h3><span class="num">1</span> ข้อมูลลูกค้า</h3>
        <dl class="kv">
          <dt>ชื่อร้าน (ไทย)</dt><dd>${esc(c.shopNameTh) || none}</dd>
          <dt>Brand Name (EN)</dt><dd>${esc(c.shopNameEn) || none}</dd>
          <dt>ชื่อบริษัท (ไทย)</dt><dd>${esc(c.companyNameTh) || none}</dd>
          <dt>Company Name (EN)</dt><dd>${esc(c.companyNameEn) || none}</dd>
          <dt>ประเภทธุรกิจ</dt><dd>${esc(bizLabel(c.businessType) || none)}${c.businessType === 'Other' && c.businessTypeOther ? ' — ' + esc(c.businessTypeOther) : ''}</dd>
          <dt>จำนวนสาขา</dt><dd>${esc(c.branchCount) || none}</dd>
          <dt>ชื่อสาขา</dt><dd>${(c.branches && c.branches.length) ? c.branches.map(b => `<span class="sys-chip">${esc(b)}</span>`).join('') : none}</dd>
          <dt>Website / Social</dt><dd>${c.website ? `<a href="${esc(c.website)}" target="_blank" rel="noopener">${esc(c.website)}</a>` : none}</dd>
          <dt>เจ้าของ/ผู้บริหาร</dt><dd>${esc([c.ownerName, c.ownerNickname && ('"' + c.ownerNickname + '"')].filter(Boolean).join(' ')) || none}</dd>
          <dt>เบอร์เจ้าของ</dt><dd>${esc(c.ownerPhone) || none}</dd>
          <dt>ผู้ประสานงานหลัก</dt><dd>${esc([c.coordinatorName, c.coordinatorNickname && ('"' + c.coordinatorNickname + '"')].filter(Boolean).join(' ')) || none}</dd>
          <dt>เบอร์ผู้ประสานงาน</dt><dd>${esc(c.coordinatorPhone) || none}</dd>
          <dt>Email ติดต่อ</dt><dd>${c.contactEmail ? `<a href="mailto:${esc(c.contactEmail)}">${esc(c.contactEmail)}</a>` : none}</dd>
          <dt>วันที่เริ่มใช้ระบบ</dt><dd>${esc(fmtDate(c.startDate)) || none}</dd>
        </dl>
      </div>

      <div class="panel">
        <h3><span class="num">2</span> ระบบที่ใช้กับ THANVASU</h3>
        <div class="check-list">${(state.meta ? state.meta.systems : SYSTEMS_FALLBACK).map(s => checkItem(s, sys.includes(s))).join('')}</div>
        ${c.otherSystemApi ? `<div style="margin-top:10px;font-size:14px"><b>Other system API:</b> ${esc(c.otherSystemApi)}</div>` : ''}
        <h3 style="margin-top:18px"><span class="num">flow</span> System Flow</h3>
        ${c.systemFlow ? `<div class="flow-text">${esc(c.systemFlow)}</div>` : `<div class="hint">ไม่มีข้อมูล System Flow</div>`}
      </div>

      <div class="panel">
        <h3><span class="num">3</span> Hardware ที่ใช้งาน</h3>
        ${hwItems.map(h => {
          const v = hw[h];
          const has = v != null && v > 0;
          return `<div class="hw-row ${has ? '' : 'zero'}"><span>${esc(h)}</span><span>${has ? `<span class="qty">${v} เครื่อง</span>` : '<span class="hint">—</span>'}</span></div>`;
        }).join('')}
        ${c.otherHardware ? `<div style="margin-top:10px;font-size:14px"><b>Hardware อื่น ๆ:</b> ${esc(c.otherHardware)}</div>` : ''}
      </div>

      <div class="panel">
        <h3><span class="num">4</span> Others — รูปภาพ</h3>
        <div style="font-size:13px;color:var(--muted);margin-bottom:8px">Logo ร้าน (1–2 รูป)</div>
        <div class="gallery">${(c.logo || []).map(f => `<img src="/files/${esc(f.file)}" data-full="/files/${esc(f.file)}" alt="logo">`).join('') || '<div class="hint">ไม่มีรูป</div>'}</div>
        <div style="font-size:13px;color:var(--muted);margin:14px 0 8px">รูปหน้าร้าน / บรรยากาศ (3–5 รูป)</div>
        <div class="gallery">${(c.storefront || []).map(f => `<img src="/files/${esc(f.file)}" data-full="/files/${esc(f.file)}" alt="storefront">`).join('') || '<div class="hint">ไม่มีรูป</div>'}</div>
        <div class="hint" style="margin-top:12px">อัปเดตล่าสุด: ${esc(fmtDateTime(c.updatedAt))}</div>
      </div>
    </div>
  `, 'detail');

  $('.back-link').onclick = e => { e.preventDefault(); location.hash = ''; };
  $('#btnEdit').onclick = () => { location.hash = '#edit/' + c.id; };
  $('#btnDelete').onclick = async () => {
    if (!confirm('ลบข้อมูลลูกค้า "' + (c.shopNameTh || c.shopNameEn || c.code) + '" ถาวร?')) return;
    try {
      await api('/api/customers/' + c.id, { method: 'DELETE' });
      toast('ลบข้อมูลเรียบร้อย');
      await loadCustomers();
      location.hash = '';
    } catch (e) { toast(e.message, true); }
  };
  $$('.gallery img').forEach(img => img.onclick = () => openLightbox(img.dataset.full));
}

function openLightbox(src) {
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.innerHTML = `<img src="${esc(src)}" alt="">`;
  box.onclick = () => box.remove();
  document.body.appendChild(box);
}

/* ================= WIZARD FORM ================= */
function emptyDraft() {
  return {
    shopNameTh: '', shopNameEn: '', companyNameTh: '', companyNameEn: '',
    businessType: '', businessTypeOther: '', branchCount: '', branches: [],
    website: '', ownerName: '', ownerNickname: '', ownerPhone: '',
    coordinatorName: '', coordinatorNickname: '', coordinatorPhone: '',
    contactEmail: '', startDate: '',
    systems: [], otherSystemApi: '', systemFlow: '',
    hardware: {}, otherHardware: '',
  };
}
const STEP_NAMES = ['ข้อมูลลูกค้า', 'ระบบที่ใช้', 'Hardware', 'รูปภาพ'];

function renderForm() {
  const editing = !!state.current && location.hash.startsWith('#edit/');
  const d = state.draft;
  const types = state.meta ? state.meta.businessTypes : BUSINESS_FALLBACK;
  const systems = state.meta ? state.meta.systems : SYSTEMS_FALLBACK;
  const hwItems = state.meta ? state.meta.hardware : HW_FALLBACK;
  const step = state.step;

  const branchesHtml = d.branches.map((b, i) => `
    <div class="branch-row">
      <input type="text" data-branch-i="${i}" value="${esc(b)}" placeholder="ชื่อสาขา เช่น สาขาสีลม">
      <button type="button" class="btn ghost sm" data-rm-branch="${i}" title="ลบ">✕</button>
    </div>`).join('');

  const logoThumbs = state.keepLogo.map((f, i) => `
    <div class="up-thumb"><img src="/files/${esc(f.file)}"><span class="new-tag">เดิม</span>
    <button type="button" class="rm" data-rm-keep="logo:${i}" title="เอาออก">✕</button></div>`).join('') +
    state.newLogo.map((f, i) => `
    <div class="up-thumb"><img src="${f.dataUrl}"><span class="new-tag">ใหม่</span>
    <button type="button" class="rm" data-rm-new="logo:${i}" title="เอาออก">✕</button></div>`).join('');

  const storeThumbs = state.keepStorefront.map((f, i) => `
    <div class="up-thumb"><img src="/files/${esc(f.file)}"><span class="new-tag">เดิม</span>
    <button type="button" class="rm" data-rm-keep="storefront:${i}" title="เอาออก">✕</button></div>`).join('') +
    state.newStorefront.map((f, i) => `
    <div class="up-thumb"><img src="${f.dataUrl}"><span class="new-tag">ใหม่</span>
    <button type="button" class="rm" data-rm-new="storefront:${i}" title="เอาออก">✕</button></div>`).join('');

  shell(`
    <a class="back-link" href="#">← ยกเลิก กลับไปหน้ารายการ</a>
    <div class="page-head"><h2>${editing ? '✏️ แก้ไขข้อมูล: ' + esc(d.shopNameTh || d.shopNameEn || '') : '＋ เพิ่มลูกค้าใหม่'}</h2></div>
    <div class="wizard-head">
      ${STEP_NAMES.map((n, i) => {
        const s = i + 1;
        const cls = s === step ? 'active' : (s < step ? 'done' : '');
        return `<div class="wstep ${cls}"><span class="dot">${s < step ? '✓' : s}</span>${esc(n)}</div>`;
      }).join('')}
    </div>
    <form class="form-panel" id="wizForm" autocomplete="off">
    ${step === 1 ? `
      <div class="fgrid">
        <div><label class="req">ชื่อร้าน (ภาษาไทย)</label><input name="shopNameTh" value="${esc(d.shopNameTh)}" placeholder="เช่น ร้านอาหารตำนาน"></div>
        <div><label>Brand Name (ภาษาอังกฤษ)</label><input name="shopNameEn" value="${esc(d.shopNameEn)}" placeholder="e.g. Legend Restaurant"></div>
        <div><label>ชื่อบริษัท (ภาษาไทย)</label><input name="companyNameTh" value="${esc(d.companyNameTh)}" placeholder="บริษัท ... จำกัด"></div>
        <div><label>Company Name (ภาษาอังกฤษ)</label><input name="companyNameEn" value="${esc(d.companyNameEn)}" placeholder="Company Co., Ltd."></div>
        <div class="full">
          <label class="req">ประเภทธุรกิจ</label>
          <select name="businessType">
            <option value="">— เลือกประเภทธุรกิจ —</option>
            ${types.map(t => `<option value="${esc(t.en)}" ${d.businessType === t.en ? 'selected' : ''}>${esc(t.th)}</option>`).join('')}
          </select>
        </div>
        <div class="full" id="otherTypeWrap" style="display:${d.businessType === 'Other' ? 'block' : 'none'}">
          <label>ระบุประเภทธุรกิจอื่น ๆ</label><input name="businessTypeOther" value="${esc(d.businessTypeOther)}" placeholder="ระบุประเภทธุรกิจ">
        </div>
        <div><label>จำนวนสาขา</label><input name="branchCount" type="number" min="0" value="${esc(d.branchCount)}" placeholder="เช่น 5"></div>
        <div><label>Website / Social Media (Link)</label><input name="website" value="${esc(d.website)}" placeholder="https://..."></div>
        <div class="full">
          <label>ชื่อสาขา (กรอกได้มากกว่า 1 สาขา)</label>
          ${branchesHtml}
          <button type="button" class="btn ghost sm" id="addBranch">＋ เพิ่มชื่อสาขา</button>
        </div>
        <div><label>ชื่อเจ้าของ / ผู้บริหาร (ชื่อจริง)</label><input name="ownerName" value="${esc(d.ownerName)}"></div>
        <div><label>ชื่อเล่นเจ้าของ</label><input name="ownerNickname" value="${esc(d.ownerNickname)}"></div>
        <div><label>เบอร์โทรเจ้าของ</label><input name="ownerPhone" value="${esc(d.ownerPhone)}" placeholder="08x-xxx-xxxx"></div>
        <div><label>ผู้ประสานงานหลัก (ชื่อจริง)</label><input name="coordinatorName" value="${esc(d.coordinatorName)}"></div>
        <div><label>ชื่อเล่นผู้ประสานงาน</label><input name="coordinatorNickname" value="${esc(d.coordinatorNickname)}"></div>
        <div><label>เบอร์โทรผู้ประสานงาน</label><input name="coordinatorPhone" value="${esc(d.coordinatorPhone)}"></div>
        <div><label>Email ติดต่อ</label><input name="contactEmail" type="email" value="${esc(d.contactEmail)}"></div>
        <div><label>วันที่เริ่มใช้ระบบ</label><input name="startDate" type="date" value="${esc(d.startDate)}"></div>
      </div>` : ''}

    ${step === 2 ? `
      <label style="margin-bottom:10px">ระบบที่ใช้กับ THANVASU (เลือกได้หลายรายการ)</label>
      <div class="checkbox-grid">
        ${systems.map(s => `
          <label class="cb ${d.systems.includes(s) ? 'on' : ''}">
            <input type="checkbox" name="sys" value="${esc(s)}" ${d.systems.includes(s) ? 'checked' : ''}> ${esc(s)}
          </label>`).join('')}
      </div>
      <div class="fgrid" style="margin-top:14px">
        <div class="full"><label>Other system API (กรอกระบบที่เชื่อม)</label><input name="otherSystemApi" value="${esc(d.otherSystemApi)}" placeholder="เช่น เชื่อมกับระบบบัญชี XXX"></div>
        <div class="full"><label>System Flow (พิมพ์อธิบายข้อมูล Flow ของร้าน)</label><textarea name="systemFlow" placeholder="อธิบาย Flow การทำงานของร้าน เช่น ลูกค้าสั่งผ่าน Kiosk → ครัวรับงานผ่าน KDS → ชำระเงินผ่าน QR">${esc(d.systemFlow)}</textarea></div>
      </div>` : ''}

    ${step === 3 ? `
      <label style="margin-bottom:10px">Hardware ที่ใช้งาน (Check Box + จำนวนเครื่อง)</label>
      <div class="hw-grid">
        ${hwItems.map(h => `
          <div class="hw-input">
            <label class="cb ${d.hardware[h] != null && d.hardware[h] > 0 ? 'on' : ''}" style="border:0;padding:0;background:none">
              <input type="checkbox" name="hwcb" value="${esc(h)}" ${d.hardware[h] != null ? 'checked' : ''}> ${esc(h)}
            </label>
            <input type="number" min="0" name="hwqty" data-hw="${esc(h)}" value="${d.hardware[h] != null ? d.hardware[h] : ''}" placeholder="จำนวน" ${d.hardware[h] == null ? 'disabled' : ''}>
          </div>`).join('')}
      </div>
      <div class="fgrid" style="margin-top:14px">
        <div class="full"><label>Hardware อื่น ๆ (กรอกข้อมูล)</label><input name="otherHardware" value="${esc(d.otherHardware)}" placeholder="ระบุฮาร์ดแวร์อื่นที่ใช้งาน"></div>
      </div>` : ''}

    ${step === 4 ? `
      <div class="fgrid">
        <div class="full">
          <label>Logo ร้าน (Upload img 1–2 รูป)</label>
          <div class="upload-box" id="upLogo"><div class="big">🖼️</div>ลากรูปมาวาง หรือคลิกเพื่อเลือกไฟล์<div class="hint">(PNG / JPG / WEBP / GIF • ไม่เกิน 8MB/รูป • สูงสุด 2 รูป)</div></div>
          <input type="file" id="fileLogo" accept="image/*" multiple hidden>
          <div class="up-thumbs" id="thumbsLogo">${logoThumbs}</div>
        </div>
        <div class="full">
          <label>รูปหน้าร้าน / บรรยากาศ (Upload img 3–5 รูป)</label>
          <div class="upload-box" id="upStore"><div class="big">📷</div>ลากรูปมาวาง หรือคลิกเพื่อเลือกไฟล์<div class="hint">(PNG / JPG / WEBP / GIF • ไม่เกิน 8MB/รูป • สูงสุด 5 รูป)</div></div>
          <input type="file" id="fileStore" accept="image/*" multiple hidden>
          <div class="up-thumbs" id="thumbsStore">${storeThumbs}</div>
        </div>
      </div>` : ''}

      <div class="wizard-nav">
        <button type="button" class="btn ghost" id="btnPrev" ${step === 1 ? 'style="visibility:hidden"' : ''}>← ย้อนกลับ</button>
        <button type="button" class="btn" id="btnNext">${step === 4 ? '💾 ' + (editing ? 'บันทึกการแก้ไข' : 'บันทึกลูกค้าใหม่') : 'ถัดไป →'}</button>
      </div>
    </form>
  `, editing ? 'detail' : 'new');

  $('.back-link').onclick = e => { e.preventDefault(); location.hash = editing ? '#c/' + state.current.id : ''; };

  // --- collect helpers
  function collectStep() {
    const f = $('#wizForm');
    if (!f) return;
    if (step === 1) {
      d.shopNameTh = f.shopNameTh.value.trim();
      d.shopNameEn = f.shopNameEn.value.trim();
      d.companyNameTh = f.companyNameTh.value.trim();
      d.companyNameEn = f.companyNameEn.value.trim();
      d.businessType = f.businessType.value;
      d.businessTypeOther = f.businessTypeOther.value.trim();
      d.branchCount = f.branchCount.value;
      d.website = f.website.value.trim();
      d.ownerName = f.ownerName.value.trim();
      d.ownerNickname = f.ownerNickname.value.trim();
      d.ownerPhone = f.ownerPhone.value.trim();
      d.coordinatorName = f.coordinatorName.value.trim();
      d.coordinatorNickname = f.coordinatorNickname.value.trim();
      d.coordinatorPhone = f.coordinatorPhone.value.trim();
      d.contactEmail = f.contactEmail.value.trim();
      d.startDate = f.startDate.value;
      d.branches = $$('[data-branch-i]').map(inp => inp.value.trim()).filter(Boolean);
    } else if (step === 2) {
      d.systems = $$('input[name=sys]:checked').map(i => i.value);
      d.otherSystemApi = f.otherSystemApi.value.trim();
      d.systemFlow = f.systemFlow.value;
    } else if (step === 3) {
      $$('input[name=hwcb]').forEach(cb => {
        const qty = $(`input[data-hw="${CSS.escape(cb.value)}"]`);
        d.hardware[cb.value] = cb.checked && qty ? (qty.value === '' ? 0 : Math.max(0, Number(qty.value) || 0)) : null;
      });
      d.otherHardware = f.otherHardware.value.trim();
    }
  }

  // --- live bindings per step
  if (step === 1) {
    f_businessType();
    function f_businessType() {
      const sel = $('select[name=businessType]');
      sel.onchange = () => { $('#otherTypeWrap').style.display = sel.value === 'Other' ? 'block' : 'none'; };
    }
    $('#addBranch').onclick = () => { collectStep(); d.branches.push(''); renderForm(); };
    $$('[data-rm-branch]').forEach(b => b.onclick = () => { collectStep(); d.branches.splice(Number(b.dataset.rmBranch), 1); renderForm(); });
  }
  if (step === 3) {
    $$('input[name=hwcb]').forEach(cb => cb.onchange = () => {
      const qty = $(`input[data-hw="${CSS.escape(cb.value)}"]`);
      if (cb.checked) { qty.disabled = false; if (!qty.value) qty.value = 1; qty.focus(); }
      else { qty.disabled = true; qty.value = ''; }
      cb.closest('.hw-input').querySelector('label.cb').classList.toggle('on', cb.checked);
    });
  }
  if (step === 4) {
    bindUpload('upLogo', 'fileLogo', 'logo', state.newLogo, 2);
    bindUpload('upStore', 'fileStore', 'storefront', state.newStorefront, 5);
    $$('.up-thumb .rm').forEach(b => b.onclick = () => {
      const [kind, idxS] = b.dataset.rmKeep ? b.dataset.rmKeep.split(':') : b.dataset.rmNew.split(':');
      const isKeep = !!b.dataset.rmKeep;
      const arr = isKeep ? (kind === 'logo' ? state.keepLogo : state.keepStorefront) : (kind === 'logo' ? state.newLogo : state.newStorefront);
      arr.splice(Number(idxS), 1);
      renderForm();
    });
  }

  function bindUpload(boxId, inputId, kind, newArr, max) {
    const box = $('#' + boxId), inp = $('#' + inputId);
    const keepArr = kind === 'logo' ? state.keepLogo : state.keepStorefront;
    box.onclick = () => inp.click();
    box.ondragover = e => { e.preventDefault(); box.classList.add('drag'); };
    box.ondragleave = () => box.classList.remove('drag');
    box.ondrop = e => { e.preventDefault(); box.classList.remove('drag'); addFiles(e.dataTransfer.files); };
    inp.onchange = () => { addFiles(inp.files); inp.value = ''; };
    function addFiles(fileList) {
      const room = max - keepArr.length - newArr.length;
      const files = Array.from(fileList).slice(0, Math.max(0, room));
      if (!files.length) { toast(kind === 'logo' ? 'สูงสุด 2 รูป' : 'สูงสุด 5 รูป', true); return; }
      let pending = files.length;
      files.forEach(file => {
        if (!/^image\//.test(file.type)) { toast('รองรับเฉพาะไฟล์รูปภาพ', true); pending--; if (!pending) renderForm(); return; }
        const rd = new FileReader();
        rd.onload = () => { newArr.push({ name: file.name, dataUrl: rd.result }); if (--pending === 0) renderForm(); };
        rd.readAsDataURL(file);
      });
    }
  }

  // --- nav
  $('#btnPrev').onclick = () => { collectStep(); state.step--; renderForm(); };
  $('#btnNext').onclick = async () => {
    collectStep();
    if (step === 1) {
      if (!d.shopNameTh && !d.shopNameEn) { toast('กรุณากรอกชื่อร้านอย่างน้อยหนึ่งภาษา', true); return; }
      if (!d.businessType) { toast('กรุณาเลือกประเภทธุรกิจ', true); return; }
    }
    if (step < 4) { state.step++; renderForm(); window.scrollTo(0, 0); return; }
    // final save
    const btn = $('#btnNext');
    btn.disabled = true; btn.textContent = 'กำลังบันทึก…';
    try {
      const payload = JSON.parse(JSON.stringify(d));
      payload.logo = state.keepLogo;
      payload.storefront = state.keepStorefront;
      let saved;
      if (editing) {
        saved = (await api('/api/customers/' + state.current.id, { method: 'PUT', json: payload })).customer;
      } else {
        saved = (await api('/api/customers', { method: 'POST', json: payload })).customer;
      }
      // upload new images
      for (const [kind, arr] of [['logo', state.newLogo], ['storefront', state.newStorefront]]) {
        for (const f of arr) {
          const blob = dataUrlToBlob(f.dataUrl);
          if (!blob) continue;
          const fd = new FormData();
          fd.append('kind', kind);
          fd.append('customerId', saved.id);
          fd.append('files', blob, f.name || ('img.' + (blob.type.split('/')[1] || 'png')));
          const r = await fetch('/api/upload', { method: 'POST', body: fd });
          if (!r.ok) { const e = await r.json().catch(() => ({})); toast(e.error || 'อัปโหลดรูปไม่สำเร็จ', true); }
        }
      }
      toast(editing ? 'บันทึกการแก้ไขเรียบร้อย' : 'เพิ่มลูกค้าใหม่เรียบร้อย');
      await loadCustomers();
      location.hash = '#c/' + saved.id;
    } catch (e) {
      toast(e.message, true);
      btn.disabled = false; btn.textContent = step === 4 ? '💾 บันทึก' : 'ถัดไป →';
    }
  };
}

function dataUrlToBlob(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) return null;
  const bin = atob(m[2]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: m[1] });
}

/* ================= ROUTER / BOOT ================= */
async function loadMeta() {
  if (state.meta) return;
  try { state.meta = await api('/api/meta'); } catch (e) { state.meta = null; }
}
async function loadCustomers() {
  const data = await api('/api/customers');
  state.customers = data.customers;
}

async function route() {
  const h = location.hash || '';
  if (!state.authed) {
    try { const me = await api('/api/me'); state.authed = !!me.authed; } catch (e) { state.authed = false; }
    if (!state.authed) { renderLogin(); return; }
    await loadMeta();
  }
  if (h === '' || h === '#') {
    try { await loadCustomers(); renderDashboard(); } catch (e) { if (e.message !== 'unauthorized') toast(e.message, true); }
    return;
  }
  if (h === '#new') {
    state.draft = emptyDraft(); state.step = 1;
    state.keepLogo = []; state.keepStorefront = []; state.newLogo = []; state.newStorefront = [];
    renderForm();
    return;
  }
  let m;
  if ((m = h.match(/^#c\/(.+)$/))) {
    try {
      const data = await api('/api/customers/' + m[1]);
      state.current = data.customer;
      renderDetail();
    } catch (e) { toast('ไม่พบข้อมูลลูกค้า', true); location.hash = ''; }
    return;
  }
  if ((m = h.match(/^#edit\/(.+)$/))) {
    try {
      const data = await api('/api/customers/' + m[1]);
      state.current = data.customer;
      const c = data.customer;
      state.draft = {
        shopNameTh: c.shopNameTh, shopNameEn: c.shopNameEn, companyNameTh: c.companyNameTh, companyNameEn: c.companyNameEn,
        businessType: c.businessType, businessTypeOther: c.businessTypeOther, branchCount: c.branchCount,
        branches: (c.branches || []).slice(), website: c.website,
        ownerName: c.ownerName, ownerNickname: c.ownerNickname, ownerPhone: c.ownerPhone,
        coordinatorName: c.coordinatorName, coordinatorNickname: c.coordinatorNickname, coordinatorPhone: c.coordinatorPhone,
        contactEmail: c.contactEmail, startDate: c.startDate,
        systems: (c.systems || []).slice(), otherSystemApi: c.otherSystemApi, systemFlow: c.systemFlow,
        hardware: Object.assign({}, c.hardware), otherHardware: c.otherHardware,
      };
      state.step = 1;
      state.keepLogo = (c.logo || []).slice();
      state.keepStorefront = (c.storefront || []).slice();
      state.newLogo = []; state.newStorefront = [];
      renderForm();
    } catch (e) { toast('ไม่พบข้อมูลลูกค้า', true); location.hash = ''; }
    return;
  }
  location.hash = '';
}

window.addEventListener('hashchange', route);
route();
