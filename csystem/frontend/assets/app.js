'use strict';
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const app = $('#app');
const state = {
  user: null,
  meta: null,
  shops: [],
  shopsLoaded: false,
  current: null,
  q: '',
  businessType: '',
  dataSource: '',
  hasE: false,
  page: 1,
  pageSize: 40,
  draft: null,
  sideOpen: false,
};

let routeSeq = 0;
let qTimer = null;
let toastTimer = null;

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

function toast(msg, isErr) {
  let t = $('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

function setBusy(on, label) {
  let el = $('#globalBusy');
  if (on) {
    if (!el) {
      el = document.createElement('div');
      el.id = 'globalBusy';
      el.className = 'global-busy';
      el.innerHTML = '<div class="global-busy-card"><div class="spinner"></div><div class="busy-label"></div></div>';
      document.body.appendChild(el);
    }
    el.querySelector('.busy-label').textContent = label || 'กำลังโหลด…';
    el.classList.add('show');
  } else if (el) {
    el.classList.remove('show');
  }
}

async function api(path, opts) {
  opts = opts || {};
  const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
  if (opts.json !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.json);
  }
  const r = await fetch(path, init);
  if (opts.blob) {
    if (r.status === 401) {
      state.user = null;
      renderLogin('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
      throw new Error('กรุณาเข้าสู่ระบบ');
    }
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data.error || ('HTTP ' + r.status));
    }
    return r.blob();
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) {
    if (state.user) {
      state.user = null;
      state.meta = null;
      state.shopsLoaded = false;
      renderLogin('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    }
    throw new Error(data.error || 'กรุณาเข้าสู่ระบบ');
  }
  if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
  return data;
}

async function downloadExcelReport() {
  setBusy(true, 'กำลังดึงข้อมูลจาก BD_CSystem…');
  try {
    const r = await fetch('/api/export/shops.xlsx?t=' + Date.now(), {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    });
    if (r.status === 401) {
      state.user = null;
      renderLogin('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
      throw new Error('กรุณาเข้าสู่ระบบ');
    }
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data.error || ('ดาวน์โหลดไม่สำเร็จ (HTTP ' + r.status + ')'));
    }
    const ab = await r.arrayBuffer();
    if (!ab || ab.byteLength < 64) throw new Error('ไฟล์ว่างหรือสร้างไม่สำเร็จ');
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = 'CS-System-Report-' + stamp + '.xlsx';
    const blob = new Blob([ab], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename; // บังคับนามสกุล .xlsx ให้ Windows เปิดด้วย Excel ได้
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2500);
    toast('ดาวน์โหลด ' + filename + ' แล้ว — เปิดใน Excel ชีต «ดูตามร้าน» แล้วกดลูกศรเลือกร้าน');
  } finally {
    setBusy(false);
  }
}

function bizLabel(en) {
  const key = String(en || '').trim();
  if (!key || key === '(ไม่ระบุ)') return key || '—';
  const types = (state.meta && state.meta.businessTypes) || [];
  let t = types.find(x => x.en === key);
  if (!t && /^caf/i.test(key) && /coffee/i.test(key)) {
    t = types.find(x => /^cafe\s*\//i.test(x.en));
  }
  if (!t) t = types.find(x => x.th === key);
  return t ? t.th : key;
}

function fmtDate(v) {
  if (!v) return '—';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split('-');
    return d + '/' + m + '/' + y;
  }
  return s;
}

function fmtWhen(v) {
  if (!v) return '—';
  return String(v).replace('T', ' ').replace(/\.\d+Z?$/, '').replace('Z', '').slice(0, 19);
}

function navActive() {
  const h = location.hash || '#';
  if (h === '#' || h === '' || h.startsWith('#shop/')) return 'home';
  if (h === '#new' || h.startsWith('#edit/')) return 'new';
  if (h === '#logs') return 'logs';
  if (h === '#users') return 'users';
  return '';
}

function go(hash) {
  state.sideOpen = false;
  const next = hash === '#' ? '' : hash;
  if ((location.hash || '') === next || (next === '' && (!location.hash || location.hash === '#'))) {
    route().catch(e => toast(e.message, true));
    return;
  }
  location.hash = next;
}

function closeSide() {
  state.sideOpen = false;
  const side = $('#sidebar');
  const back = $('#sideBackdrop');
  if (side) side.classList.remove('open');
  if (back) back.remove();
}

function openSide() {
  state.sideOpen = true;
  const side = $('#sidebar');
  if (side) side.classList.add('open');
  if (!$('#sideBackdrop')) {
    const b = document.createElement('div');
    b.id = 'sideBackdrop';
    b.className = 'side-backdrop';
    b.onclick = closeSide;
    document.body.appendChild(b);
  }
}

function shell(content, opts) {
  opts = opts || {};
  document.title = (opts.title ? opts.title + ' — ' : '') + 'CS System';
  const isAdmin = state.user && state.user.role === 'Admin';
  const active = navActive();
  app.innerHTML = `
  <div class="app-shell">
    <div class="app-fx" aria-hidden="true">
      <div class="app-fx-grid"></div>
      <div class="app-fx-orb o1"></div>
      <div class="app-fx-orb o2"></div>
      <div class="app-fx-spark s1"></div>
      <div class="app-fx-spark s2"></div>
    </div>
    <aside class="sidebar ${state.sideOpen ? 'open' : ''}" id="sidebar">
      <button type="button" class="side-brand" id="btnBrandHome" title="ไปหน้าหลัก" aria-label="CS System หน้าหลัก">
        <div class="brand-lockup">
          <img class="brand-logo" src="/assets/thanvasu-logo.png" alt="THANVASU">
          <div>
            <div class="mark">CS System</div>
            <div class="tag">THANVASU · Customer Profile</div>
          </div>
        </div>
      </button>
      <nav class="side-nav">
        <button type="button" class="side-link ${active === 'home' ? 'on' : ''}" data-go="#"><span class="ni">01</span>รายการร้าน</button>
        <button type="button" class="side-link ${active === 'new' ? 'on' : ''}" data-go="#new"><span class="ni">02</span>เพิ่มร้าน</button>
        ${isAdmin ? `<button type="button" class="side-link ${active === 'users' ? 'on' : ''}" data-go="#users"><span class="ni">03</span>ผู้ใช้</button>` : ''}
        ${isAdmin ? `<button type="button" class="side-link ${active === 'logs' ? 'on' : ''}" data-go="#logs"><span class="ni">04</span>ประวัติ</button>` : ''}
      </nav>
      <div class="side-foot">
        <div class="who">${esc(state.user.username)}</div>
        <div class="role">${esc(roleLabel(state.user.role))}</div>
        <button type="button" class="logout" id="navChangePw" style="margin-bottom:8px">เปลี่ยนรหัสผ่าน</button>
        <button type="button" class="logout" id="navLogout">ออกจากระบบ</button>
      </div>
    </aside>
    <main class="main">
      <div class="top-mobile">
        <button type="button" class="icon-btn" id="btnMenu" aria-label="เมนู">☰</button>
        <button type="button" class="mobile-brand" id="btnBrandHomeMobile" title="ไปหน้าหลัก" aria-label="CS System หน้าหลัก"><img class="brand-logo sm" src="/assets/thanvasu-logo.png" alt=""><span class="mark">CS System</span></button>
        <button type="button" class="btn primary sm" id="btnAddMobile">+ เพิ่ม</button>
      </div>
      ${content}
    </main>
  </div>`;

  $$('.side-link').forEach(btn => btn.onclick = () => go(btn.dataset.go || '#'));
  const brandHome = $('#btnBrandHome');
  if (brandHome) brandHome.onclick = () => go('#');
  const brandHomeM = $('#btnBrandHomeMobile');
  if (brandHomeM) brandHomeM.onclick = () => go('#');
  const menu = $('#btnMenu');
  if (menu) menu.onclick = () => (state.sideOpen ? closeSide() : openSide());
  const addM = $('#btnAddMobile');
  if (addM) addM.onclick = () => go('#new');
  $('#navLogout').onclick = async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch (e) {}
    state.user = null;
    state.meta = null;
    state.shopsLoaded = false;
    location.hash = '';
    renderLogin();
  };
  const chg = $('#navChangePw');
  if (chg) chg.onclick = () => openChangePasswordModal();
  bindAppFx();
}

function bindAppFx() {
  const fx = document.querySelector('.app-fx');
  if (!fx || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const orbs = fx.querySelectorAll('.app-fx-orb');
  if (!orbs.length) return;
  const onMove = (e) => {
    const x = (e.clientX / window.innerWidth - .5) * 18;
    const y = (e.clientY / window.innerHeight - .5) * 14;
    orbs.forEach((el, i) => {
      const k = i === 0 ? 1 : -.7;
      el.style.setProperty('--tx', (x * k) + 'px');
      el.style.setProperty('--ty', (y * k) + 'px');
    });
  };
  window.removeEventListener('pointermove', window.__csAppFxMove);
  window.__csAppFxMove = onMove;
  window.addEventListener('pointermove', onMove, { passive: true });
}

function roleLabel(role) {
  return role === 'Admin' ? 'ผู้ดูแลระบบ' : 'ผู้ใช้งาน';
}

function actionLabel(action) {
  const map = { create: 'สร้าง', update: 'แก้ไข', delete: 'ลบ', login: 'เข้าสู่ระบบ' };
  return map[action] || action || '—';
}

function statusLabel(st) {
  if (st === 'Y') return 'ใช้งาน';
  if (st === 'E') return 'มีปัญหา';
  return 'ปิดชั่วคราว';
}

/** โชว์แฟลกสถานะเดียว (หน้าดู / รายการ) */
function oneStatusChip(st, note) {
  const s = (st === 'Y' || st === 'E' || st === 'N') ? st : 'N';
  return `<span class="chip ${s.toLowerCase()}${s === 'E' ? ' hot' : ''}" title="${statusLabel(s)}">${esc(s)} ${statusLabel(s)}${note ? esc(note) : ''}</span>`;
}

/** สรุปสถานะร้าน: ถ้ามี E โชว์ E, ไม่มีแล้วมี Y โชว์ Y, นอกนั้น N — โชว์แค่อันเดียว */
function shopFlagChip(sum) {
  sum = sum || { Y: 0, E: 0, N: 0 };
  if ((sum.E || 0) > 0) {
    return oneStatusChip('E', (sum.E > 1 ? ` · ${sum.E} ระบบ` : ''));
  }
  if ((sum.Y || 0) > 0) {
    return oneStatusChip('Y', (sum.Y > 1 ? ` · ${sum.Y} ระบบ` : ''));
  }
  return oneStatusChip('N');
}

function summaryChips(sum) {
  return shopFlagChip(sum);
}

function hasActiveFilters() {
  return !!(state.q.trim() || state.businessType);
}

function clearFilters() {
  state.q = '';
  state.businessType = '';
  state.dataSource = '';
  state.hasE = false;
  state.page = 1;
}

function foldSearch(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\u00A0/g, ' ')
    .replace(/ย/g, '')
    .replace(/[^a-z0-9\u0e00-\u0e7f]+/g, '');
}

function matchesQuery(parts, q) {
  const raw = String(q || '').trim().toLowerCase();
  if (!raw) return true;
  const blob = parts.map(p => String(p || '').toLowerCase()).join(' ');
  if (blob.includes(raw)) return true;
  const nq = foldSearch(q);
  if (!nq) return true;
  return foldSearch(blob).includes(nq);
}

function naturalCompare(a, b, locale) {
  return String(a || '').localeCompare(String(b || ''), locale || 'en', {
    numeric: true,
    sensitivity: 'base',
  });
}

function compareServerLabels(a, b) {
  const rank = (name) => {
    const s = String(name || '').trim().toLowerCase();
    if (!s || s === '(ไม่ระบุ)') return 9;
    if (s.startsWith('tvsdb2')) return 0;
    if (s.startsWith('tvsdb1')) return 1;
    if (s.includes('thanvasupos.com')) return 2;
    if (/^\d{1,3}(\.\d{1,3}){3}/.test(s)) return 4;
    return 3;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  return naturalCompare(a, b, 'en');
}

function filteredShops() {
  const q = state.q.trim();
  const list = (state.shops || []).filter(s => {
    if (state.businessType && s.businessType !== state.businessType) return false;
    return matchesQuery([
      s.name, s.brandName, s.companyNameTh, s.companyNameEn,
      s.notes, s.businessType, s.ownerName, s.contactName, s.contactEmail,
      s.facebookUrl, s.instagramUrl, s.contactLine, s.contactOther,
    ], q);
  });
  return list.slice().sort((a, b) => naturalCompare(a.name, b.name, 'th'));
}

async function loadShops(force) {
  if (state.shopsLoaded && !force) return;
  const data = await api('/api/shops');
  state.shops = data.shops || [];
  state.shopsLoaded = true;
}

async function loadMeta() {
  if (state.meta) return;
  state.meta = await api('/api/meta');
  // meta ซิงก์ฐานบน tvsdb2 เข้า Shops — ต้องโหลดรายการร้านใหม่
  state.shopsLoaded = false;
}

function listTableHtml(list, sources) {
  const pages = Math.max(1, Math.ceil(list.length / state.pageSize));
  if (state.page > pages) state.page = pages;
  if (state.page < 1) state.page = 1;
  const start = (state.page - 1) * state.pageSize;
  const pageItems = list.slice(start, start + state.pageSize);

  if (!pageItems.length) {
    return {
      pages,
      html: `<div class="empty">
        <h3>${hasActiveFilters() ? 'ไม่พบรายการ' : 'ยังไม่มีร้าน'}</h3>
        <p>${hasActiveFilters() ? 'ลองปรับคำค้นหาหรือล้างตัวกรอง' : 'เริ่มจากเพิ่มร้านแรกของคุณ'}</p>
        ${hasActiveFilters()
          ? '<button type="button" class="btn secondary sm" id="btnClearEmpty" style="margin-top:14px">ล้างตัวกรอง</button>'
          : '<button type="button" class="btn primary sm" id="btnEmptyAdd" style="margin-top:14px">+ เพิ่มร้าน</button>'}
      </div>`,
    };
  }

  const rows = pageItems.map(s => `
    <tr data-id="${s.id}" tabindex="0">
      <td><div class="shop-name">${esc(s.name)}</div></td>
      <td class="nowrap">${esc(fmtDate(s.startDate))}</td>
      <td>${esc(s.businessType ? bizLabel(s.businessType) : '—')}</td>
      <td>${summaryChips(s.serviceSummary)}</td>
    </tr>`).join('');

  return {
    pages,
    html: `<div class="table-wrap">
      <table class="data">
        <thead><tr><th>ร้าน</th><th>วันเริ่มใช้</th><th>ประเภท</th><th>ระบบที่เปิดใช้</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`,
  };
}

function bindListInteractions(pages) {
  const qEl = $('#q');
  if (qEl) {
    // กันเบราว์เซอร์เติม username ลงช่องค้นหาหลังล็อกอิน
    const unlock = () => qEl.removeAttribute('readonly');
    qEl.addEventListener('focus', unlock, { once: true });
    qEl.addEventListener('pointerdown', unlock, { once: true });
    qEl.oninput = e => {
      state.q = e.target.value;
      state.page = 1;
      clearTimeout(qTimer);
      qTimer = setTimeout(() => refreshListBody(true), 150);
    };
    qEl.onkeydown = e => {
      if (e.key === 'Escape') {
        state.q = '';
        qEl.value = '';
        state.page = 1;
        refreshListBody(true);
      }
    };
  }

  const type = $('#typeFilter');
  if (type) type.onchange = e => {
    state.businessType = e.target.value;
    state.page = 1;
    refreshListBody(false);
  };

  const clear = () => {
    clearFilters();
    renderList().catch(err => toast(err.message, true));
  };
  const c1 = $('#btnClearFilters');
  if (c1) c1.onclick = clear;
  const c2 = $('#btnClearEmpty');
  if (c2) c2.onclick = clear;
  const emptyAdd = $('#btnEmptyAdd');
  if (emptyAdd) emptyAdd.onclick = () => go('#new');

  const exportBtn = $('#btnExportExcel');
  if (exportBtn) exportBtn.onclick = () => {
    downloadExcelReport().catch(err => toast(err.message, true));
  };

  $('#btnReload').onclick = async () => {
    try {
      setBusy(true, 'กำลังรีเฟรช…');
      state.shopsLoaded = false;
      state.meta = null;
      await loadMeta();
      await loadShops(true);
      await renderList();
      toast('อัปเดตแล้ว');
    } catch (err) {
      toast(err.message, true);
    } finally {
      setBusy(false);
    }
  };
  const add = $('#btnAddTop');
  if (add) add.onclick = () => go('#new');

  const prev = $('#pgPrev');
  const next = $('#pgNext');
  if (prev) prev.onclick = () => {
    if (state.page <= 1) return;
    state.page -= 1;
    refreshListBody(false);
  };
  if (next) next.onclick = () => {
    if (state.page >= pages) return;
    state.page += 1;
    refreshListBody(false);
  };
  $$('.pager-num[data-page]').forEach(btn => {
    btn.onclick = () => {
      const p = Number(btn.dataset.page);
      if (!p || p === state.page) return;
      state.page = p;
      refreshListBody(false);
    };
  });

  $$('table.data tr[data-id]').forEach(tr => {
    const open = () => go('#shop/' + tr.dataset.id);
    tr.onclick = open;
    tr.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    };
  });
}

function pagerHtml(pages, total) {
  pages = Math.max(1, pages || 1);
  total = Number(total || 0);
  const start = total ? ((state.page - 1) * state.pageSize) + 1 : 0;
  const end = Math.min(state.page * state.pageSize, total);
  const windowSize = 5;
  let from = Math.max(1, state.page - Math.floor(windowSize / 2));
  let to = Math.min(pages, from + windowSize - 1);
  from = Math.max(1, to - windowSize + 1);
  const nums = [];
  for (let i = from; i <= to; i++) nums.push(i);

  return `
  <div class="pager-bar">
    <div class="pager-range">
      ${total
        ? `แสดง <b>${start.toLocaleString('th-TH')}–${end.toLocaleString('th-TH')}</b> จาก <b>${total.toLocaleString('th-TH')}</b> ร้าน`
        : 'ไม่มีรายการ'}
    </div>
    <div class="pager-controls" role="navigation" aria-label="แบ่งหน้า">
      <button type="button" class="pager-btn" id="pgPrev" aria-label="หน้าก่อน" ${state.page <= 1 ? 'disabled' : ''}>
        <span aria-hidden="true">‹</span>
      </button>
      ${from > 1 ? `<button type="button" class="pager-num" data-page="1">1</button>${from > 2 ? '<span class="pager-ellipsis">…</span>' : ''}` : ''}
      ${nums.map(n => `
        <button type="button" class="pager-num ${n === state.page ? 'is-current' : ''}" data-page="${n}" ${n === state.page ? 'aria-current="page"' : ''}>${n}</button>
      `).join('')}
      ${to < pages ? `${to < pages - 1 ? '<span class="pager-ellipsis">…</span>' : ''}<button type="button" class="pager-num" data-page="${pages}">${pages}</button>` : ''}
      <button type="button" class="pager-btn" id="pgNext" aria-label="หน้าถัดไป" ${state.page >= pages ? 'disabled' : ''}>
        <span aria-hidden="true">›</span>
      </button>
    </div>
  </div>`;
}

function refreshListBody(keepFocus) {
  const sources = (state.meta && state.meta.dataSources) || [];
  const list = filteredShops();
  const painted = listTableHtml(list, sources);
  const wrap = $('#listBody');
  if (!wrap) {
    renderList().catch(err => toast(err.message, true));
    return;
  }
  const focusId = keepFocus && document.activeElement && document.activeElement.id;
  const pos = keepFocus && focusId === 'q' ? $('#q').selectionStart : null;

  wrap.innerHTML = painted.html;
  const countVal = $('#listCountVal');
  if (countVal) countVal.textContent = list.length.toLocaleString('th-TH');
  const count = $('#listCount');
  if (count) {
    count.textContent = list.length !== state.shops.length ? 'หลังกรองจากทั้งหมด' : 'ครบทุกรายการ';
  }
  const pager = $('#listPager');
  if (pager) pager.innerHTML = pagerHtml(painted.pages, list.length);

  let clearBtn = $('#btnClearFilters');
  const actions = $('#controlActions');
  if (hasActiveFilters()) {
    if (!clearBtn && actions) {
      clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'btn ghost sm';
      clearBtn.id = 'btnClearFilters';
      clearBtn.textContent = 'ล้างตัวกรอง';
      actions.appendChild(clearBtn);
    }
  } else if (clearBtn) {
    clearBtn.remove();
  }

  bindListInteractions(painted.pages);
  if (keepFocus && focusId === 'q') {
    const n = $('#q');
    if (n) {
      n.focus();
      try { if (pos != null) n.setSelectionRange(pos, pos); } catch (e) {}
    }
  }
}

async function renderList() {
  await loadMeta();
  await loadShops(false);
  const types = state.meta ? state.meta.businessTypes : [];
  const sources = ((state.meta && state.meta.dataSources) || [])
    .filter(s => s.dataSource && s.valid !== false && s.dataSource !== '.' && s.dataSource !== '(ไม่ระบุ)');
  const list = filteredShops();
  const painted = listTableHtml(list, sources);

  shell(`
    <div class="page-head">
      <div>
        <div class="page-kicker">หน้าหลัก</div>
        <h1>รายการร้าน</h1>
        <p class="lede">ค้นหาและดูโปรไฟล์ลูกค้า / ระบบที่ใช้งานได้จากหน้านี้</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn secondary sm" id="btnExportExcel">ส่งออก Excel</button>
        <button type="button" class="btn secondary sm" id="btnReload">รีเฟรช</button>
        <button type="button" class="btn primary sm" id="btnAddTop">+ เพิ่มร้าน</button>
      </div>
    </div>

    <div class="stat-strip">
      <div class="stat">
        <div class="label">ร้านทั้งหมด</div>
        <div class="value">${(state.shops || []).length.toLocaleString('th-TH')}</div>
        <div class="hint">ใน CS System</div>
      </div>
      <div class="stat">
        <div class="label">กำลังแสดง</div>
        <div class="value" id="listCountVal">${list.length.toLocaleString('th-TH')}</div>
        <div class="hint" id="listCount">${list.length !== state.shops.length ? 'หลังกรองจากทั้งหมด' : 'ครบทุกรายการ'}</div>
      </div>
      <div class="stat">
        <div class="label">ระบบที่เปิดใช้</div>
        <div class="value">${(state.shops || []).reduce((n, s) => n + ((s.serviceSummary && s.serviceSummary.Y) || 0), 0).toLocaleString('th-TH')}</div>
        <div class="hint">โมดูลที่ติ๊กใช้งาน</div>
      </div>
    </div>

    <div class="surface control-bar glow-edge">
      <div class="field">
        <label for="q">ค้นหา</label>
        <input type="search" id="q" name="csystem_shop_search" placeholder="ชื่อร้าน / แบรนด์ / ผู้ติดต่อ…" value="${esc(state.q)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" data-form-type="other" readonly>
      </div>
      <div class="field">
        <label for="typeFilter">ประเภทธุรกิจ</label>
        <select id="typeFilter">
          <option value="">ทุกประเภท</option>
          ${types.map(t => `<option value="${esc(t.en)}" ${state.businessType === t.en ? 'selected' : ''}>${esc(t.th)}</option>`).join('')}
        </select>
      </div>
      <div class="control-actions" id="controlActions">
        ${hasActiveFilters() ? '<button type="button" class="btn ghost sm" id="btnClearFilters">ล้างตัวกรอง</button>' : ''}
      </div>
    </div>

    <div class="list-hint">กดที่แถวเพื่อเปิดรายละเอียดโปรไฟล์</div>

    <div class="surface table-shell glow-edge" id="listBody">${painted.html}</div>
    <div class="list-pager" id="listPager">${pagerHtml(painted.pages, list.length)}</div>
  `, { title: 'รายการร้าน' });

  bindListInteractions(painted.pages);
}

function serviceCardClass(st) {
  if (st === 'Y') return 'on-y';
  if (st === 'E') return 'on-e';
  return 'on-n';
}

/** แยกชื่อ Other system API หลายรายการจากข้อความที่บันทึกไว้ */
function parseOtherApis(text) {
  const raw = String(text || '').trim();
  if (!raw) return [''];
  const parts = raw.split(/\r?\n+| · | \| |;/).map(s => s.trim()).filter(Boolean);
  return parts.length ? parts : [''];
}

function joinOtherApis(list) {
  return (list || []).map(s => String(s || '').trim()).filter(Boolean).join(' · ');
}

function formatOtherApisDisplay(text) {
  return joinOtherApis(parseOtherApis(text));
}

function serviceEditorHtml(services) {
  return `
  <div class="check-grid" id="svcGrid">
    ${(services || []).map(s => {
      const st = (s.status === 'Y' || s.status === 'E' || s.status === 'N') ? s.status : 'N';
      const otherDisp = s.allowsFreeText ? formatOtherApisDisplay(s.otherText || '') : '';
      return `
      <button type="button" class="check-card ${serviceCardClass(st)}" data-sid="${s.serviceId}"
        data-status="${st}"
        data-status-note="${esc(s.statusNote || '')}"
        data-other="${esc(s.otherText || '')}"
        data-free="${s.allowsFreeText ? '1' : '0'}"
        data-name="${esc(s.name)}">
        <span class="check-box" aria-hidden="true"></span>
        <span class="check-body">
          <span class="check-name">${esc(s.name)}</span>
          <span class="check-status">${esc(st)} · ${statusLabel(st)}</span>
          <span class="check-other"${otherDisp ? '' : ' hidden'}>${esc(otherDisp)}</span>
        </span>
      </button>`;
    }).join('')}
  </div>
  <div class="legend">กดการ์ดเพื่อตั้งค่า Y / E / N</div>`;
}

function paintServiceCard(card) {
  if (!card) return;
  const st = card.dataset.status || 'N';
  card.classList.remove('on-y', 'on-e', 'on-n');
  card.classList.add(serviceCardClass(st));
  const label = card.querySelector('.check-status');
  if (label) label.textContent = st + ' · ' + statusLabel(st);
  const otherEl = card.querySelector('.check-other');
  if (otherEl && card.dataset.free === '1') {
    const disp = formatOtherApisDisplay(card.dataset.other || '');
    otherEl.textContent = disp;
    if (disp) otherEl.removeAttribute('hidden');
    else otherEl.setAttribute('hidden', '');
  }
}

function otherApiRowsHtml(values) {
  const list = (values && values.length) ? values : [''];
  return list.map((v, i) => `
    <div class="other-api-row">
      <input type="text" class="svc-modal-other-input" value="${esc(v)}" placeholder="ชื่อระบบ / API #${i + 1}">
      <button type="button" class="btn ghost sm other-api-del" title="ลบรายการ" aria-label="ลบรายการ">×</button>
    </div>`).join('');
}

function openServiceStatusModal(card, onDone) {
  if (!card) return;
  let back = $('#svcStatusModal');
  if (back) back.remove();
  const name = card.dataset.name || 'ระบบ';
  const st0 = (card.dataset.status === 'Y' || card.dataset.status === 'E' || card.dataset.status === 'N')
    ? card.dataset.status : 'N';
  const free = card.dataset.free === '1';
  const otherValues = free ? parseOtherApis(card.dataset.other || '') : [];
  back = document.createElement('div');
  back.id = 'svcStatusModal';
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal-card svc-status-modal" role="dialog" aria-modal="true" aria-labelledby="svcModalTitle">
      <h3 id="svcModalTitle">${esc(name)}</h3>
      <p class="hint">เลือกแฟลกสถานะของระบบนี้</p>
      <div class="status-seg modal-status-seg" role="radiogroup" aria-label="สถานะ">
        <label class="${st0 === 'Y' ? 'on-y' : ''}"><input type="radio" name="svcModalStatus" value="Y" ${st0 === 'Y' ? 'checked' : ''}><span class="seg-code">Y</span><span class="seg-name">ใช้งาน</span></label>
        <label class="${st0 === 'E' ? 'on-e' : ''}"><input type="radio" name="svcModalStatus" value="E" ${st0 === 'E' ? 'checked' : ''}><span class="seg-code">E</span><span class="seg-name">มีปัญหา</span></label>
        <label class="${st0 === 'N' ? 'on-n' : ''}"><input type="radio" name="svcModalStatus" value="N" ${st0 === 'N' ? 'checked' : ''}><span class="seg-code">N</span><span class="seg-name">ปิดชั่วคราว</span></label>
      </div>
      <label for="svcModalNote">หมายเหตุ (เมื่อเป็น E)</label>
      <input id="svcModalNote" value="${esc(card.dataset.statusNote || '')}" placeholder="เช่น รอซ่อม / เครื่องเสีย">
      <div id="svcModalOtherWrap" style="${free ? '' : 'display:none'}">
        <div class="other-api-head">
          <label>ระบุระบบที่เชื่อม</label>
          <button type="button" class="btn secondary sm" id="svcModalOtherAdd">+ เพิ่มระบบ</button>
        </div>
        <div id="svcModalOtherList" class="other-api-list">${otherApiRowsHtml(otherValues)}</div>
        <p class="field-hint">กด + เพื่อเพิ่มระบบ/API ได้เรื่อยๆ (ลูกค้าใช้หลายระบบได้)</p>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn secondary sm" id="svcModalCancel">ยกเลิก</button>
        <button type="button" class="btn primary sm" id="svcModalOk">ตกลง</button>
      </div>
    </div>`;
  document.body.appendChild(back);

  const syncSeg = () => {
    const checked = back.querySelector('input[name="svcModalStatus"]:checked');
    const st = checked ? checked.value : 'N';
    $$('.modal-status-seg label', back).forEach(lab => {
      lab.classList.remove('on-y', 'on-e', 'on-n');
      const inp = lab.querySelector('input');
      if (!inp || !inp.checked) return;
      if (inp.value === 'Y') lab.classList.add('on-y');
      if (inp.value === 'E') lab.classList.add('on-e');
      if (inp.value === 'N') lab.classList.add('on-n');
    });
    const note = $('#svcModalNote');
    if (note) note.style.opacity = st === 'E' ? '1' : '.55';
  };
  $$('input[name="svcModalStatus"]', back).forEach(inp => { inp.onchange = syncSeg; });
  syncSeg();

  const bindOtherList = () => {
    const list = $('#svcModalOtherList');
    if (!list) return;
    const syncDel = () => {
      const rows = $$('.other-api-row', list);
      rows.forEach(row => {
        const del = row.querySelector('.other-api-del');
        if (!del) return;
        del.style.visibility = rows.length > 1 ? 'visible' : 'hidden';
        del.onclick = () => {
          if ($$('.other-api-row', list).length <= 1) return;
          row.remove();
          syncDel();
          renumberOtherPlaceholders();
        };
      });
    };
    const renumberOtherPlaceholders = () => {
      $$('.svc-modal-other-input', list).forEach((inp, i) => {
        inp.placeholder = 'ชื่อระบบ / API #' + (i + 1);
      });
    };
    syncDel();
  };
  if (free) {
    bindOtherList();
    const addBtn = $('#svcModalOtherAdd');
    if (addBtn) {
      addBtn.onclick = () => {
        const list = $('#svcModalOtherList');
        if (!list) return;
        list.insertAdjacentHTML('beforeend', otherApiRowsHtml(['']));
        bindOtherList();
        const inputs = $$('.svc-modal-other-input', list);
        const last = inputs[inputs.length - 1];
        if (last) last.focus();
      };
    }
  }

  const close = () => back.remove();
  back.onclick = e => { if (e.target === back) close(); };
  $('#svcModalCancel').onclick = close;
  $('#svcModalOk').onclick = () => {
    const checked = back.querySelector('input[name="svcModalStatus"]:checked');
    const status = checked && (checked.value === 'Y' || checked.value === 'E' || checked.value === 'N')
      ? checked.value : 'N';
    const statusNote = ($('#svcModalNote').value || '').trim();
    const otherText = free
      ? joinOtherApis($$('.svc-modal-other-input', back).map(inp => inp.value))
      : '';
    card.dataset.status = status;
    card.dataset.statusNote = status === 'E' ? statusNote : '';
    card.dataset.other = otherText;
    paintServiceCard(card);
    close();
    if (onDone) onDone();
  };
}

function bindStatusSeg(onChange) {
  $$('#svcGrid .check-card[data-sid]').forEach(card => {
    paintServiceCard(card);
    card.onclick = () => openServiceStatusModal(card, onChange);
  });
}

function collectServicesFromForm() {
  return $$('#svcGrid .check-card[data-sid]').map(card => {
    const serviceId = Number(card.dataset.sid);
    const status = (card.dataset.status === 'Y' || card.dataset.status === 'E' || card.dataset.status === 'N')
      ? card.dataset.status : 'N';
    return {
      serviceId,
      status,
      statusNote: status === 'E' ? String(card.dataset.statusNote || '').trim() : '',
      otherText: card.dataset.free === '1' ? String(card.dataset.other || '').trim() : '',
    };
  });
}


function normalizeDraftBranches(list) {
  const arr = Array.isArray(list) ? list : [];
  return arr.map(b => ({
    name: String((b && b.name) || '').trim(),
    province: String((b && b.province) || '').trim(),
    mapUrl: String((b && b.mapUrl) || '').trim(),
  })).filter(b => b.name);
}

function branchesEditorHtml(branches) {
  const rows = (branches && branches.length) ? branches : [{ name: '', province: '', mapUrl: '' }];
  return `
    <div id="branchList" class="branch-list">
      ${rows.map((b, i) => `
        <div class="branch-row" data-idx="${i}">
          <div>
            <label>ชื่อสาขา</label>
            <input class="br-name" value="${esc(b.name)}" placeholder="เช่น สาขาสยาม">
          </div>
          <div>
            <label>จังหวัด</label>
            <input class="br-province" value="${esc(b.province)}" placeholder="เช่น กรุงเทพฯ">
          </div>
          <div>
            <label>Link map</label>
            <input class="br-map" value="${esc(b.mapUrl)}" placeholder="https://maps.google.com/...">
          </div>
          <button type="button" class="btn ghost sm br-del" title="ลบสาขา">ลบ</button>
        </div>`).join('')}
    </div>
    <button type="button" class="btn secondary sm" id="btnAddBranch">+ เพิ่มสาขา</button>`;
}

function collectBranchesFromForm() {
  return $$('#branchList .branch-row').map(row => ({
    name: (($('.br-name', row) || {}).value || '').trim(),
    province: (($('.br-province', row) || {}).value || '').trim(),
    mapUrl: (($('.br-map', row) || {}).value || '').trim(),
  })).filter(b => b.name);
}

function bindBranchEditor() {
  const list = $('#branchList');
  if (!list) return;
  const bindDel = (btn) => {
    if (!btn) return;
    btn.onclick = () => {
      const row = btn.closest('.branch-row');
      if (!row) return;
      if ($$('#branchList .branch-row').length <= 1) {
        $$('input', row).forEach(i => { i.value = ''; });
        syncBranchCount();
        return;
      }
      row.remove();
      syncBranchCount();
    };
  };
  const addRow = (b) => {
    const wrap = document.createElement('div');
    wrap.className = 'branch-row';
    wrap.innerHTML = `
      <div><label>ชื่อสาขา</label><input class="br-name" value="${esc((b && b.name) || '')}" placeholder="เช่น สาขาสยาม"></div>
      <div><label>จังหวัด</label><input class="br-province" value="${esc((b && b.province) || '')}" placeholder="เช่น กรุงเทพฯ"></div>
      <div><label>Link map</label><input class="br-map" value="${esc((b && b.mapUrl) || '')}" placeholder="https://maps.google.com/..."></div>
      <button type="button" class="btn ghost sm br-del" title="ลบสาขา">ลบ</button>`;
    list.appendChild(wrap);
    bindDel($('.br-del', wrap));
    syncBranchCount();
  };
  $$('#branchList .br-del').forEach(bindDel);
  const addBtn = $('#btnAddBranch');
  if (addBtn) addBtn.onclick = () => addRow({ name: '', province: '', mapUrl: '' });
}

function syncBranchCount() {
  const el = $('#fBranchCount');
  if (!el) return;
  const n = Math.max($$('#branchList .branch-row').length, collectBranchesFromForm().length);
  if (!el.value || Number(el.value) < n) el.value = String(n || '');
}

function emptyDraft(services, hardware) {
  const hw = hardware || (state.meta && state.meta.hardware) || [];
  return {
    name: '', brandName: '', companyNameTh: '', companyNameEn: '',
    startDate: '', businessType: '', businessTypeOther: '',
    branchCount: '', branches: [{ name: '', province: '', mapUrl: '' }],
    websiteSocial: '', facebookUrl: '', instagramUrl: '',
    ownerName: '', ownerNickname: '', ownerPhone: '',
    contactName: '', contactNickname: '', contactPhone: '', contactEmail: '',
    contactLine: '', contactOther: '',
    dataSource: '', restDb: '', restId: '', notes: '', systemFlow: '', hardwareOther: '',
    hardware: hw.map(h => ({
      hardwareId: h.id, code: h.code, name: h.name, qty: 0,
    })),
    images: [],
    pendingImages: [],
    services: (services || []).map(s => ({
      serviceId: s.id, code: s.code, name: s.name, allowsFreeText: s.allowsFreeText,
      status: 'N', statusNote: '', otherText: '',
    })),
  };
}

function draftFromShop(shop) {
  const hwMeta = (state.meta && state.meta.hardware) || [];
  const byId = new Map((shop.hardware || []).map(h => [Number(h.hardwareId), h]));
  return {
    name: shop.name || '',
    brandName: shop.brandName || '',
    companyNameTh: shop.companyNameTh || '',
    companyNameEn: shop.companyNameEn || '',
    startDate: shop.startDate || '',
    businessType: shop.businessType || '',
    businessTypeOther: shop.businessTypeOther || '',
    branchCount: shop.branchCount != null ? shop.branchCount : '',
    branches: (shop.branches && shop.branches.length)
      ? shop.branches
      : (shop.branchNames || []).map(name => typeof name === 'object' ? name : ({ name, province: '', mapUrl: '' })),
    websiteSocial: shop.websiteSocial || '',
    facebookUrl: shop.facebookUrl || '',
    instagramUrl: shop.instagramUrl || '',
    ownerName: shop.ownerName || '',
    ownerNickname: shop.ownerNickname || '',
    ownerPhone: shop.ownerPhone || '',
    contactName: shop.contactName || '',
    contactNickname: shop.contactNickname || '',
    contactPhone: shop.contactPhone || '',
    contactEmail: shop.contactEmail || '',
    contactLine: shop.contactLine || '',
    contactOther: shop.contactOther || '',
    dataSource: shop.dataSource || '',
    restDb: shop.restDb || '',
    restId: shop.restId || '',
    notes: shop.notes || '',
    systemFlow: shop.systemFlow || '',
    hardwareOther: shop.hardwareOther || '',
    hardware: hwMeta.map(h => {
      const cur = byId.get(Number(h.id));
      return {
        hardwareId: h.id, code: h.code, name: h.name,
        qty: cur ? Number(cur.qty || 0) : 0,
      };
    }),
    images: shop.images || [],
    pendingImages: [],
    services: shop.services || [],
  };
}

function collectHardwareFromForm() {
  return $$('.hw-qty').map(inp => ({
    hardwareId: Number(inp.dataset.id),
    code: inp.dataset.code,
    qty: Number(inp.value || 0),
  }));
}

function hardwareEditorHtml(hardware) {
  return `
    <div class="hw-grid">
      ${(hardware || []).map(h => `
        <label class="hw-item">
          <span class="hw-name">${esc(h.name)}</span>
          <input class="hw-qty" type="number" min="0" max="9999" step="1"
            data-id="${h.hardwareId}" data-code="${esc(h.code)}"
            value="${Number(h.qty || 0)}">
          <span class="hw-unit">เครื่อง</span>
        </label>`).join('')}
    </div>`;
}

function imageGalleryHtml(images, pending, editing) {
  const logos = (images || []).filter(i => i.kind === 'logo');
  const stores = (images || []).filter(i => i.kind === 'store');
  const pendLogo = (pending || []).filter(i => i.kind === 'logo');
  const pendStore = (pending || []).filter(i => i.kind === 'store');
  const card = (img, pendingIdx) => {
    const src = img.url || img.preview || '';
    const delAttr = pendingIdx != null
      ? `data-pending="${pendingIdx}"`
      : `data-id="${img.id}"`;
    return `<div class="img-card">
      <img src="${esc(src)}" alt="">
      <button type="button" class="btn danger sm img-del" ${delAttr}>ลบ</button>
    </div>`;
  };
  const dropZone = (kind, title, fileId, cardsHtml, empty) => `
    <div class="img-block">
      <div class="img-head">
        <h3>${title}</h3>
        <label class="btn secondary sm file-btn">เลือกไฟล์
          <input type="file" id="${fileId}" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>
        </label>
      </div>
      <div class="img-drop" data-kind="${kind}" tabindex="0" role="button"
        aria-label="ลากไฟล์รูปมาวาง หรือคลิกเพื่อเลือกไฟล์">
        <div class="img-drop-hint">
          <strong>ลากไฟล์มาวางที่นี่</strong>
          <span>หรือคลิกเพื่อเลือก · PNG / JPG / WEBP / GIF · สูงสุด 8MB</span>
        </div>
        <div class="img-grid" id="${kind}Grid">
          ${cardsHtml}
          ${empty ? '<div class="img-empty">ยังไม่มีรูป</div>' : ''}
        </div>
      </div>
    </div>`;
  return `
    <div class="img-section">
      ${dropZone(
        'logo',
        'โลโก้ร้าน (สูงสุด 2)',
        'fileLogo',
        logos.map(i => card(i)).join('') + pendLogo.map(i => card(i, (pending || []).indexOf(i))).join(''),
        !logos.length && !pendLogo.length
      )}
      ${dropZone(
        'store',
        'รูปหน้าร้าน / บรรยากาศ (สูงสุด 5)',
        'fileStore',
        stores.map(i => card(i)).join('') + pendStore.map(i => card(i, (pending || []).indexOf(i))).join(''),
        !stores.length && !pendStore.length
      )}
      ${editing ? '' : '<p class="field-hint">รูปจะถูกอัปโหลดหลังบันทึกร้าน</p>'}
    </div>`;
}

function bindImageDropZones(refreshImages) {
  const addFiles = async (kind, files) => {
    try {
      await queuePendingImages(kind, files);
      await refreshImages();
    } catch (e) {
      toast(e.message, true);
    }
  };

  const fileLogo = $('#fileLogo');
  if (fileLogo) {
    fileLogo.onchange = async () => {
      await addFiles('logo', fileLogo.files);
      fileLogo.value = '';
    };
  }
  const fileStore = $('#fileStore');
  if (fileStore) {
    fileStore.onchange = async () => {
      await addFiles('store', fileStore.files);
      fileStore.value = '';
    };
  }

  $$('.img-drop').forEach(zone => {
    const kind = zone.dataset.kind;
    const input = kind === 'logo' ? fileLogo : fileStore;
    const onDrag = e => {
      e.preventDefault();
      e.stopPropagation();
    };
    zone.addEventListener('dragenter', e => {
      onDrag(e);
      zone.classList.add('dragover');
    });
    zone.addEventListener('dragover', e => {
      onDrag(e);
      zone.classList.add('dragover');
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    zone.addEventListener('dragleave', e => {
      onDrag(e);
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('dragover');
    });
    zone.addEventListener('drop', async e => {
      onDrag(e);
      zone.classList.remove('dragover');
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) await addFiles(kind, files);
    });
    zone.addEventListener('click', e => {
      if (e.target.closest('.img-del') || e.target.closest('.img-card')) return;
      if (input) input.click();
    });
    zone.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (input) input.click();
      }
    });
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
    r.readAsDataURL(file);
  });
}

async function queuePendingImages(kind, fileList) {
  const limits = (state.meta && state.meta.imageLimits) || { logo: 2, store: 5 };
  const max = limits[kind] || 2;
  const d = state.draft;
  const existing = (d.images || []).filter(i => i.kind === kind).length
    + (d.pendingImages || []).filter(i => i.kind === kind).length;
  const files = Array.from(fileList || []);
  let room = max - existing;
  if (room <= 0) {
    toast(kind === 'logo' ? 'โลโก้ครบ 2 รูปแล้ว' : 'รูปหน้าร้านครบ 5 รูปแล้ว', true);
    return;
  }
  for (const f of files) {
    if (room <= 0) break;
    if (!/^image\//i.test(f.type)) { toast('รองรับเฉพาะไฟล์รูป', true); continue; }
    if (f.size > 8 * 1024 * 1024) { toast('ไฟล์ ' + f.name + ' ใหญ่เกิน 8MB', true); continue; }
    const dataUrl = await readFileAsDataUrl(f);
    d.pendingImages.push({
      kind,
      originalName: f.name,
      mime: f.type,
      preview: dataUrl,
      dataBase64: dataUrl,
    });
    room -= 1;
  }
}

async function uploadPendingImages(shopId) {
  const pending = (state.draft && state.draft.pendingImages) || [];
  for (const img of pending) {
    await api('/api/shops/' + shopId + '/images', {
      method: 'POST',
      json: {
        kind: img.kind,
        originalName: img.originalName,
        mime: img.mime,
        dataBase64: img.dataBase64,
      },
    });
  }
  if (state.draft) state.draft.pendingImages = [];
}

async function renderForm(editing) {
  const types = state.meta.businessTypes || [];
  const d = state.draft;
  const sourceMeta = ((state.meta.dataSources || [])
    .filter(s => s.dataSource && s.valid !== false && s.dataSource !== '.' && s.dataSource !== '(ไม่ระบุ)'));
  const sourceValues = new Set(sourceMeta.map(s => s.dataSource));
  if (d.dataSource && !sourceValues.has(d.dataSource)) {
    sourceMeta.push({ dataSource: d.dataSource, label: d.dataSource, count: 0, central: false, valid: false });
  }
  const backTo = editing && state.current ? '#shop/' + state.current.id : '#';

  shell(`
    <button type="button" class="back" id="btnBack">← กลับ</button>
    <div class="page-head">
      <div>
        <div class="page-kicker">${editing ? 'แก้ไข' : 'สร้างใหม่'}</div>
        <h1>${editing ? 'แก้ไขโปรไฟล์ลูกค้า' : 'เพิ่มโปรไฟล์ลูกค้า'}</h1>
        <p class="lede">กรอกข้อมูลตาม Customer Profile — ข้อมูลลูกค้า · ระบบ · Hardware · รูปภาพ</p>
      </div>
    </div>

    <div class="surface panel glow-edge">
      <h2>1. ข้อมูลลูกค้า</h2>
      <div class="form-grid">
        <div>
          <label for="fName">ชื่อร้าน (ภาษาไทย) *</label>
          <input id="fName" value="${esc(d.name)}" autocomplete="organization">
        </div>
        <div>
          <label for="fBrand">Brand Name (ภาษาอังกฤษ)</label>
          <input id="fBrand" value="${esc(d.brandName)}" placeholder="Brand Name">
        </div>
        <div>
          <label for="fCoTh">ชื่อบริษัท (ภาษาไทย)</label>
          <input id="fCoTh" value="${esc(d.companyNameTh)}">
        </div>
        <div>
          <label for="fCoEn">Company Name (ภาษาอังกฤษ)</label>
          <input id="fCoEn" value="${esc(d.companyNameEn)}">
        </div>
        <div class="full">
          <label for="fType">ประเภทธุรกิจ</label>
          <select id="fType">
            <option value="">— เลือก —</option>
            ${types.map(t => `<option value="${esc(t.en)}" ${d.businessType === t.en ? 'selected' : ''}>${esc(t.en)} — ${esc(t.th)}</option>`).join('')}
          </select>
        </div>
        <div class="full" id="otherWrap" style="display:${d.businessType === 'Other' ? 'block' : 'none'}">
          <label for="fTypeOther">ระบุประเภทอื่น ๆ</label>
          <input id="fTypeOther" value="${esc(d.businessTypeOther)}">
        </div>
        <div>
          <label for="fBranchCount">จำนวนสาขา</label>
          <input id="fBranchCount" type="number" min="0" max="9999" value="${esc(d.branchCount === '' || d.branchCount == null ? '' : d.branchCount)}">
        </div>
        <div>
          <label for="fStart">วันที่เริ่มใช้ระบบ</label>
          <input id="fStart" type="date" value="${esc(d.startDate || '')}">
        </div>
        <div class="full">
          <label>ชื่อสาขา</label>
          ${branchesEditorHtml(d.branches)}
        </div>
        <div>
          <label for="fFb">Website · Facebook</label>
          <input id="fFb" value="${esc(d.facebookUrl)}" placeholder="https://facebook.com/...">
        </div>
        <div>
          <label for="fIg">Website · Instagram</label>
          <input id="fIg" value="${esc(d.instagramUrl)}" placeholder="https://instagram.com/...">
        </div>
        <div>
          <label for="fOwner">ชื่อเจ้าของ / ผู้บริหาร (ชื่อจริง)</label>
          <input id="fOwner" value="${esc(d.ownerName)}">
        </div>
        <div>
          <label for="fOwnerNick">ชื่อเล่น</label>
          <input id="fOwnerNick" value="${esc(d.ownerNickname)}">
        </div>
        <div class="full">
          <label for="fOwnerPhone">เบอร์โทรติดต่อ (เจ้าของ)</label>
          <input id="fOwnerPhone" value="${esc(d.ownerPhone)}" inputmode="tel">
        </div>
        <div>
          <label for="fContact">ผู้ประสานงานหลัก (ชื่อจริง)</label>
          <input id="fContact" value="${esc(d.contactName)}">
        </div>
        <div>
          <label for="fContactNick">ชื่อเล่น</label>
          <input id="fContactNick" value="${esc(d.contactNickname)}">
        </div>
        <div>
          <label for="fContactPhone">เบอร์โทรติดต่อ</label>
          <input id="fContactPhone" value="${esc(d.contactPhone)}" inputmode="tel">
        </div>
        <div>
          <label for="fContactEmail">Email ติดต่อ</label>
          <input id="fContactEmail" type="email" value="${esc(d.contactEmail)}">
        </div>
        <div>
          <label for="fContactLine">LINE</label>
          <input id="fContactLine" value="${esc(d.contactLine)}" placeholder="@lineid หรือเบอร์ที่ผูก LINE">
        </div>
        <div>
          <label for="fContactOther">ช่องทางติดต่ออื่นๆ</label>
          <input id="fContactOther" value="${esc(d.contactOther)}" placeholder="เช่น WhatsApp, WeChat, Telegram">
        </div>
        <div class="full">
          <label for="fNotes">หมายเหตุ</label>
          <textarea id="fNotes" rows="2">${esc(d.notes)}</textarea>
        </div>
      </div>
    </div>

    <div class="surface panel glow-edge">
      <h2>2. ระบบที่ใช้กับ THANVASU</h2>
      <p class="field-hint" style="margin-top:-6px;margin-bottom:12px">กดการ์ดระบบเพื่อตั้งค่า Y / E / N</p>
      ${serviceEditorHtml(d.services)}
      <div style="margin-top:16px">
        <label for="fFlow">System Flow</label>
        <textarea id="fFlow" rows="4" placeholder="อธิบาย Flow ของระบบในร้าน">${esc(d.systemFlow)}</textarea>
      </div>
    </div>

    <div class="surface panel glow-edge">
      <h2>3. Hardware ที่ใช้งาน</h2>
      ${hardwareEditorHtml(d.hardware)}
      <div style="margin-top:14px">
        <label for="fHwOther">Hardware อื่น ๆ</label>
        <input id="fHwOther" value="${esc(d.hardwareOther)}" placeholder="ระบุอุปกรณ์อื่นและจำนวน">
      </div>
    </div>

    <div class="surface panel glow-edge">
      <h2>4. รูปภาพ</h2>
      ${imageGalleryHtml(d.images, d.pendingImages, editing)}
    </div>

    <div class="surface sticky-actions glow-edge">
      <button type="button" class="btn primary" id="btnSave">บันทึก</button>
      <button type="button" class="btn secondary" id="btnCancel">ยกเลิก</button>
    </div>
  `, { title: editing ? 'แก้ไขร้าน' : 'เพิ่มร้าน' });

  $('#btnBack').onclick = () => go(backTo);
  $('#btnCancel').onclick = () => go(backTo);
  $('#fType').onchange = e => {
    $('#otherWrap').style.display = e.target.value === 'Other' ? 'block' : 'none';
  };
  bindStatusSeg();
  bindBranchEditor();
  $('#fName').focus();

  const refreshImages = async () => {
    await renderForm(editing);
  };

  bindImageDropZones(refreshImages);

  $$('.img-del').forEach(btn => {
    btn.onclick = async () => {
      const pendingIdx = btn.dataset.pending;
      if (pendingIdx != null && pendingIdx !== '') {
        state.draft.pendingImages.splice(Number(pendingIdx), 1);
        await refreshImages();
        return;
      }
      const id = btn.dataset.id;
      if (!id || !state.current) return;
      if (!confirm('ลบรูปนี้?')) return;
      try {
        await api('/api/images/' + id, { method: 'DELETE' });
        state.draft.images = (state.draft.images || []).filter(x => Number(x.id) !== Number(id));
        toast('ลบรูปแล้ว');
        await refreshImages();
      } catch (e) { toast(e.message, true); }
    };
  });

  $('#btnSave').onclick = async () => {
    const payload = {
      name: $('#fName').value.trim(),
      brandName: $('#fBrand').value.trim(),
      companyNameTh: $('#fCoTh').value.trim(),
      companyNameEn: $('#fCoEn').value.trim(),
      startDate: $('#fStart').value || null,
      businessType: $('#fType').value,
      businessTypeOther: $('#fTypeOther') ? $('#fTypeOther').value.trim() : '',
      branchCount: $('#fBranchCount').value === '' ? null : Number($('#fBranchCount').value),
      branches: collectBranchesFromForm(),
      facebookUrl: $('#fFb').value.trim(),
      instagramUrl: $('#fIg').value.trim(),
      ownerName: $('#fOwner').value.trim(),
      ownerNickname: $('#fOwnerNick').value.trim(),
      ownerPhone: $('#fOwnerPhone').value.trim(),
      contactName: $('#fContact').value.trim(),
      contactNickname: $('#fContactNick').value.trim(),
      contactPhone: $('#fContactPhone').value.trim(),
      contactEmail: $('#fContactEmail').value.trim(),
      contactLine: ($('#fContactLine') || {}).value ? $('#fContactLine').value.trim() : '',
      contactOther: ($('#fContactOther') || {}).value ? $('#fContactOther').value.trim() : '',
      dataSource: '',
      notes: $('#fNotes').value.trim(),
      systemFlow: $('#fFlow').value.trim(),
      hardwareOther: $('#fHwOther').value.trim(),
      hardware: collectHardwareFromForm(),
      services: collectServicesFromForm(),
    };
    if (!payload.name) {
      toast('กรุณากรอกชื่อร้าน', true);
      $('#fName').focus();
      return;
    }
    const btn = $('#btnSave');
    try {
      btn.disabled = true;
      btn.textContent = 'กำลังบันทึก…';
      setBusy(true, 'กำลังบันทึก…');
      const r = editing
        ? await api('/api/shops/' + state.current.id, { method: 'PUT', json: payload })
        : await api('/api/shops', { method: 'POST', json: payload });
      if ((state.draft.pendingImages || []).length) {
        setBusy(true, 'กำลังอัปโหลดรูป…');
        await uploadPendingImages(r.shop.id);
      }
      state.shopsLoaded = false;
      state.meta = null;
      toast(editing ? 'บันทึกแล้ว' : 'เพิ่มร้านแล้ว');
      go('#shop/' + r.shop.id);
    } catch (e) {
      toast(e.message, true);
      btn.disabled = false;
      btn.textContent = 'บันทึก';
    } finally {
      setBusy(false);
    }
  };
}

async function renderDetail() {
  const s = state.current;
  const isAdmin = state.user.role === 'Admin';
  const eCount = (s.serviceSummary && s.serviceSummary.E) || 0;
  const branches = s.branchNames || [];
  const logos = (s.images || []).filter(i => i.kind === 'logo');
  const stores = (s.images || []).filter(i => i.kind === 'store');
  const hw = (s.hardware || []).filter(h => Number(h.qty) > 0);

  shell(`
    <button type="button" class="back" id="btnBack">← รายการร้าน</button>
    <div class="surface detail-hero glow-edge">
      <div>
        <div class="page-kicker">โปรไฟล์ลูกค้า</div>
        <h1>${esc(s.name)}</h1>
        ${s.brandName ? `<div class="detail-sub">${esc(s.brandName)}</div>` : ''}
        <div class="gold-rule"></div>
        <div class="path">${esc(s.brandName || s.companyNameTh || 'โปรไฟล์ลูกค้า')}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:14px;position:relative;z-index:1">
        ${summaryChips(s.serviceSummary)}
        <div class="actions">
          <button type="button" class="btn primary sm" id="btnEdit">แก้ไข</button>
          ${isAdmin ? '<button type="button" class="btn danger sm" id="btnDel">ลบ</button>' : ''}
        </div>
      </div>
    </div>
    ${eCount ? `<div class="warn-banner">มีระบบสถานะ “มีปัญหา (E)” อยู่ ${eCount} รายการ — ควรตรวจสอบก่อนปิดงาน</div>` : ''}

    <div class="surface panel glow-edge">
      <h2>1. ข้อมูลลูกค้า</h2>
      <div class="grid-facts">
        <div class="fact"><label>ชื่อร้าน</label><div class="value">${esc(s.name)}</div></div>
        <div class="fact"><label>Brand Name</label><div class="value">${esc(s.brandName || '—')}</div></div>
        <div class="fact"><label>ชื่อบริษัท</label><div class="value">${esc(s.companyNameTh || '—')}</div></div>
        <div class="fact"><label>Company Name</label><div class="value">${esc(s.companyNameEn || '—')}</div></div>
        <div class="fact"><label>ประเภทธุรกิจ</label><div class="value">${esc(s.businessType ? bizLabel(s.businessType) : '—')}${s.businessTypeOther ? ' — ' + esc(s.businessTypeOther) : ''}</div></div>
        <div class="fact"><label>วันเริ่มใช้</label><div class="value">${esc(fmtDate(s.startDate))}</div></div>
        <div class="fact"><label>จำนวนสาขา</label><div class="value">${s.branchCount != null ? esc(s.branchCount) : '—'}</div></div>
        <div class="fact"><label>Website / Social</label><div class="value">${esc(s.websiteSocial || '—')}</div></div>
        <div class="fact" style="grid-column:1/-1"><label>ชื่อสาขา</label><div class="value">${(s.branches || []).length
          ? `<div class="branch-view">${(s.branches || []).map(b => {
              const title = [b.name, b.province && ('(' + b.province + ')')].filter(Boolean).join(' ');
              const map = String(b.mapUrl || '').trim();
              const mapHtml = map
                ? `<a class="map-link" href="${esc(map)}" target="_blank" rel="noopener noreferrer">เปิดแผนที่</a><div class="map-url mono">${esc(map)}</div>`
                : '<span class="field-hint">ไม่มีลิงก์แผนที่</span>';
              return `<div class="branch-view-row"><div class="branch-view-name">${esc(title || '—')}</div>${mapHtml}</div>`;
            }).join('')}</div>`
          : (branches.length ? esc(branches.join(' · ')) : '—')}</div></div>
        <div class="fact"><label>Facebook</label><div class="value">${esc(s.facebookUrl || '—')}</div></div>
        <div class="fact"><label>Instagram</label><div class="value">${esc(s.instagramUrl || '—')}</div></div>
        <div class="fact"><label>เจ้าของ / ผู้บริหาร</label><div class="value">${esc([s.ownerName, s.ownerNickname && '(' + s.ownerNickname + ')'].filter(Boolean).join(' ') || '—')}</div></div>
        <div class="fact"><label>เบอร์เจ้าของ</label><div class="value">${esc(s.ownerPhone || '—')}</div></div>
        <div class="fact"><label>ผู้ประสานงาน</label><div class="value">${esc([s.contactName, s.contactNickname && '(' + s.contactNickname + ')'].filter(Boolean).join(' ') || '—')}</div></div>
        <div class="fact"><label>เบอร์ผู้ประสานงาน</label><div class="value">${esc(s.contactPhone || '—')}</div></div>
        <div class="fact"><label>Email</label><div class="value">${esc(s.contactEmail || '—')}</div></div>
        <div class="fact"><label>LINE</label><div class="value">${esc(s.contactLine || '—')}</div></div>
        <div class="fact" style="grid-column:1/-1"><label>ช่องทางติดต่ออื่นๆ</label><div class="value">${esc(s.contactOther || '—')}</div></div>
        <div class="fact" style="grid-column:1/-1"><label>หมายเหตุ</label><div class="value">${esc(s.notes || '—')}</div></div>
      </div>
    </div>

    <div class="surface panel glow-edge">
      <h2>2. ระบบที่ใช้กับ THANVASU</h2>
      <div class="check-grid readonly">
        ${(s.services || []).map(x => {
          const st = (x.status === 'Y' || x.status === 'E' || x.status === 'N') ? x.status : 'N';
          return `
          <div class="check-card ${serviceCardClass(st)}">
            <span class="check-box" aria-hidden="true"></span>
            <span class="check-body">
              <span class="check-name">${esc(x.name)}</span>
              <span class="check-status">${esc(st)} · ${statusLabel(st)}${x.statusNote ? ' · ' + esc(x.statusNote) : ''}</span>
              ${x.otherText ? `<span class="check-other">${esc(formatOtherApisDisplay(x.otherText))}</span>` : ''}
            </span>
          </div>`;
        }).join('')}
      </div>
      <div class="legend">Y = ใช้งาน · E = มีปัญหา · N = ปิดชั่วคราว</div>
      <div class="fact" style="margin-top:14px"><label>System Flow</label><div class="value pre">${esc(s.systemFlow || '—')}</div></div>
    </div>

    <div class="surface panel glow-edge">
      <h2>3. Hardware</h2>
      ${hw.length ? `
        <div class="hw-view">
          ${hw.map(h => `<div class="hw-chip"><b>${esc(h.name)}</b> · ${esc(h.qty)} เครื่อง</div>`).join('')}
        </div>` : '<p class="field-hint">ยังไม่ได้ระบุจำนวนเครื่อง</p>'}
      ${s.hardwareOther ? `<div class="fact" style="margin-top:12px"><label>Hardware อื่น ๆ</label><div class="value">${esc(s.hardwareOther)}</div></div>` : ''}
    </div>

    <div class="surface panel glow-edge">
      <h2>4. รูปภาพ</h2>
      <div class="img-block">
        <h3>โลโก้</h3>
        <div class="img-grid">
          ${logos.map(i => `<a class="img-card" href="${esc(i.url)}" target="_blank" rel="noopener"><img src="${esc(i.url)}" alt=""></a>`).join('') || '<div class="img-empty">ไม่มีโลโก้</div>'}
        </div>
      </div>
      <div class="img-block" style="margin-top:16px">
        <h3>หน้าร้าน / บรรยากาศ</h3>
        <div class="img-grid">
          ${stores.map(i => `<a class="img-card" href="${esc(i.url)}" target="_blank" rel="noopener"><img src="${esc(i.url)}" alt=""></a>`).join('') || '<div class="img-empty">ไม่มีรูป</div>'}
        </div>
      </div>
    </div>
  `, { title: s.name });

  $('#btnBack').onclick = () => go('#');
  $('#btnEdit').onclick = () => go('#edit/' + s.id);
  const del = $('#btnDel');
  if (del) {
    del.onclick = async () => {
      if (!confirm('ลบร้าน "' + s.name + '" ?\nการลบไม่สามารถย้อนกลับได้')) return;
      try {
        setBusy(true, 'กำลังลบ…');
        await api('/api/shops/' + s.id, { method: 'DELETE' });
        state.shopsLoaded = false;
        state.meta = null;
        toast('ลบแล้ว');
        go('#');
      } catch (e) {
        toast(e.message, true);
      } finally {
        setBusy(false);
      }
    };
  }
}

async function renderReports() {
  setBusy(true, 'กำลังโหลดรายงาน…');
  try {
    const data = await api('/api/reports/summary');
    shell(`
      <div class="page-head">
        <div>
          <div class="page-kicker">สรุปข้อมูล</div>
          <h1>รายงาน</h1>
          <p class="lede">ภาพรวมประเภทธุรกิจและสถานะระบบของร้านทั้งหมด</p>
        </div>
      </div>
      <div class="report-grid">
        <div class="surface panel glow-edge">
          <h2>ตามประเภทธุรกิจ</h2>
          <div class="table-wrap" style="max-height:420px">
            <table class="data"><thead><tr><th>ประเภท</th><th>จำนวน</th></tr></thead>
            <tbody>${(data.byType || []).map(r => `<tr><td>${esc(bizLabel(r.businessType) || r.businessType)}</td><td class="num">${esc(r.cnt)}</td></tr>`).join('') || '<tr><td colspan="2">ไม่มีข้อมูล</td></tr>'}</tbody></table>
          </div>
        </div>
        <div class="surface panel glow-edge">
          <h2>ร้านที่มีปัญหา (E)</h2>
          <div class="table-wrap" style="max-height:420px">
            <table class="data"><thead><tr><th>ร้าน</th><th>ประเภท</th></tr></thead>
            <tbody>${(data.issues || []).map(r => `<tr class="click-row" data-id="${r.id}"><td>${esc(r.name)}</td><td>${esc(r.businessType ? bizLabel(r.businessType) : '—')}</td></tr>`).join('') || '<tr><td colspan="2">ไม่มีร้านที่มีปัญหา</td></tr>'}</tbody></table>
          </div>
        </div>
        <div class="surface panel glow-edge span-all">
          <h2>สรุปสถานะระบบ (Y / E / N)</h2>
          <div class="table-wrap" style="max-height:none">
            <table class="data"><thead><tr><th>ระบบ / บริการ</th><th>Y ใช้งาน</th><th>E มีปัญหา</th><th>N ปิดชั่วคราว</th></tr></thead>
            <tbody>${(data.byStatus || []).map(r => `<tr><td>${esc(r.serviceName)}</td><td class="num y-text">${r.y}</td><td class="num e-text">${r.e}</td><td class="num">${r.n}</td></tr>`).join('')}</tbody></table>
          </div>
        </div>
      </div>
    `, { title: 'รายงาน' });
    $$('.click-row[data-id]').forEach(tr => tr.onclick = () => go('#shop/' + tr.dataset.id));
  } finally {
    setBusy(false);
  }
}

async function renderUsers() {
  setBusy(true, 'กำลังโหลดผู้ใช้…');
  try {
    const data = await api('/api/users');
    const users = data.users || [];
    shell(`
      <div class="page-head">
        <div>
          <div class="page-kicker">ผู้ดูแลระบบ</div>
          <h1>ผู้ใช้ระบบ</h1>
          <p class="lede">สร้างบัญชีให้ทีมเข้าใช้ CS System — ผู้ดูแลจัดการได้เต็มสิทธิ์ / ผู้ใช้งานดูและแก้ไขร้านได้</p>
        </div>
      </div>

      <div class="surface form-grid glow-edge">
        <div>
          <label for="uName">ชื่อผู้ใช้ *</label>
          <input id="uName" autocomplete="off" placeholder="เช่น somchai">
        </div>
        <div>
          <label for="uRole">สิทธิ์</label>
          <select id="uRole">
            <option value="User">ผู้ใช้งาน — ดู / แก้ไขร้าน</option>
            <option value="Admin">ผู้ดูแลระบบ — เต็มสิทธิ์</option>
          </select>
        </div>
        <div>
          <label for="uPass">รหัสผ่าน *</label>
          <input id="uPass" type="password" autocomplete="new-password" placeholder="อย่างน้อย 6 ตัวอักษร">
        </div>
        <div>
          <label for="uPass2">ยืนยันรหัสผ่าน *</label>
          <input id="uPass2" type="password" autocomplete="new-password">
        </div>
        <div class="full">
          <button type="button" class="btn primary" id="btnCreateUser">เพิ่มผู้ใช้</button>
        </div>
      </div>

      <div class="surface panel glow-edge">
        <h2>บัญชีทั้งหมด (${users.length})</h2>
        <div class="table-wrap" style="max-height:none">
          <table class="data">
            <thead><tr><th>ชื่อผู้ใช้</th><th>สิทธิ์</th><th>สถานะ</th><th>สร้างเมื่อ</th><th></th></tr></thead>
            <tbody>
              ${users.map(u => `
                <tr data-uid="${u.id}">
                  <td><b>${esc(u.username)}</b></td>
                  <td><span class="badge">${esc(roleLabel(u.role))}</span></td>
                  <td>${u.isActive ? '<span class="chip y">เปิดใช้</span>' : '<span class="chip n">ปิด</span>'}</td>
                  <td class="nowrap">${esc(fmtWhen(u.createdAt))}</td>
                  <td>
                    ${Number(u.id) === Number(state.user.id) ? '' : `
                      <button type="button" class="btn ghost sm btn-toggle-user" data-id="${u.id}" data-active="${u.isActive ? '0' : '1'}">
                        ${u.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                      </button>`}
                  </td>
                </tr>`).join('') || '<tr><td colspan="5">ยังไม่มีผู้ใช้</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `, { title: 'ผู้ใช้' });

    $('#btnCreateUser').onclick = async () => {
      const username = $('#uName').value.trim();
      const password = $('#uPass').value;
      const password2 = $('#uPass2').value;
      const role = $('#uRole').value;
      if (!username) { toast('กรุณากรอกชื่อผู้ใช้', true); return; }
      if (password.length < 6) { toast('รหัสผ่านอย่างน้อย 6 ตัวอักษร', true); return; }
      if (password !== password2) { toast('รหัสผ่านยืนยันไม่ตรงกัน', true); return; }
      const btn = $('#btnCreateUser');
      try {
        btn.disabled = true;
        await api('/api/users', { method: 'POST', json: { username, password, role } });
        toast('เพิ่มผู้ใช้แล้ว');
        await renderUsers();
      } catch (e) {
        toast(e.message, true);
        btn.disabled = false;
      }
    };

    $$('.btn-toggle-user').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        const isActive = btn.dataset.active === '1';
        try {
          await api('/api/users/' + id + '/active', { method: 'PUT', json: { isActive } });
          toast(isActive ? 'เปิดใช้งานแล้ว' : 'ปิดใช้งานแล้ว');
          await renderUsers();
        } catch (e) {
          toast(e.message, true);
        }
      };
    });
  } finally {
    setBusy(false);
  }
}

function fmtIp(ip) {
  const s = String(ip || '').trim();
  if (!s) return '—';
  if (s.startsWith('::ffff:')) return s.slice(7);
  if (s === '::1') return '127.0.0.1 (localhost)';
  if (s === '127.0.0.1') return '127.0.0.1 (localhost)';
  return s;
}

function actionChip(action) {
  const label = actionLabel(action);
  const kind = action === 'create' ? 'y' : action === 'delete' ? 'e' : action === 'update' ? 'hot' : '';
  const cls = kind ? `chip ${kind === 'hot' ? 'e hot' : kind}` : 'badge';
  return `<span class="${cls}">${esc(label)}</span>`;
}

async function renderLogs() {
  setBusy(true, 'กำลังโหลดประวัติ…');
  try {
    const [login, audit] = await Promise.all([api('/api/login-logs'), api('/api/audit')]);
    shell(`
      <div class="page-head">
        <div>
          <div class="page-kicker">ผู้ดูแลระบบ</div>
          <h1>ประวัติการใช้งาน</h1>
          <p class="lede">บันทึกการเข้าสู่ระบบและการแก้ไขข้อมูลในระบบ</p>
        </div>
      </div>
      <div class="report-grid">
        <div class="surface panel">
          <h2>การเข้าสู่ระบบ</h2>
          <div class="table-wrap" style="max-height:520px">
            <table class="data"><thead><tr><th>เวลา</th><th>ชื่อผู้ใช้</th><th>ผล</th><th>IP</th></tr></thead>
            <tbody>${(login.logs || []).map(l => `<tr>
              <td class="nowrap">${esc(fmtWhen(l.createdAt))}</td>
              <td>${esc(l.username)}</td>
              <td>${l.success ? '<span class="chip y">สำเร็จ</span>' : '<span class="chip e">ไม่สำเร็จ</span>'}</td>
              <td class="mono">${esc(fmtIp(l.ip))}</td>
            </tr>`).join('') || '<tr><td colspan="4">ยังไม่มีประวัติ</td></tr>'}</tbody></table>
          </div>
        </div>
        <div class="surface panel">
          <h2>บันทึกการแก้ไข</h2>
          <div class="table-wrap" style="max-height:520px">
            <table class="data"><thead><tr><th>เวลา</th><th>ผู้ทำ</th><th>การกระทำ</th><th>สรุป</th></tr></thead>
            <tbody>${(audit.logs || []).map(l => `<tr>
              <td class="nowrap">${esc(fmtWhen(l.createdAt))}</td>
              <td>${esc(l.username || l.userId || '')}</td>
              <td>${actionChip(l.action)}</td>
              <td>${esc(l.summary || '—')}</td>
            </tr>`).join('') || '<tr><td colspan="4">ยังไม่มีประวัติ</td></tr>'}</tbody></table>
          </div>
        </div>
      </div>
    `, { title: 'ประวัติการใช้งาน' });
  } finally {
    setBusy(false);
  }
}

function openChangePasswordModal() {
  let back = $('#chgPwModal');
  if (back) back.remove();
  back = document.createElement('div');
  back.id = 'chgPwModal';
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal-card">
      <h3>เปลี่ยนรหัสผ่าน</h3>
      <p class="hint">ท่านตั้งรหัสใหม่เอง — ไม่มีใครในระบบเห็นรหัสใหม่ของท่าน</p>
      <div class="err" id="chgErr" style="display:none"></div>
      <label for="chgCur">รหัสผ่านปัจจุบัน</label>
      <input id="chgCur" type="password" autocomplete="current-password">
      <label for="chgNew">รหัสผ่านใหม่</label>
      <input id="chgNew" type="password" autocomplete="new-password">
      <label for="chgNew2">ยืนยันรหัสผ่านใหม่</label>
      <input id="chgNew2" type="password" autocomplete="new-password">
      <div class="modal-actions">
        <button type="button" class="btn secondary sm" id="chgCancel">ยกเลิก</button>
        <button type="button" class="btn primary sm" id="chgSave">บันทึก</button>
      </div>
    </div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.onclick = e => { if (e.target === back) close(); };
  $('#chgCancel').onclick = close;
  $('#chgSave').onclick = async () => {
    const errEl = $('#chgErr');
    errEl.style.display = 'none';
    const currentPassword = $('#chgCur').value;
    const password = $('#chgNew').value;
    const password2 = $('#chgNew2').value;
    if (password.length < 6) {
      errEl.style.display = 'block';
      errEl.textContent = 'รหัสผ่านใหม่อย่างน้อย 6 ตัวอักษร';
      return;
    }
    if (password !== password2) {
      errEl.style.display = 'block';
      errEl.textContent = 'รหัสผ่านยืนยันไม่ตรงกัน';
      return;
    }
    try {
      await api('/api/change-password', {
        method: 'POST',
        json: { currentPassword, password, password2 },
      });
      toast('เปลี่ยนรหัสผ่านแล้ว');
      close();
    } catch (e) {
      errEl.style.display = 'block';
      errEl.textContent = e.message || 'ไม่สำเร็จ';
    }
  };
  $('#chgCur').focus();
}

function renderLogin(err) {
  document.title = 'เข้าสู่ระบบ — CS System';
  closeSide();
  const year = new Date().getFullYear();
  app.innerHTML = `
  <div class="login-wrap" id="loginStage">
    <div class="login-bg" aria-hidden="true">
      <div class="login-grid-fx"></div>
      <div class="login-orb o1" data-parallax="0.02"></div>
      <div class="login-orb o2" data-parallax="-0.03"></div>
      <div class="login-orb o3" data-parallax="0.025"></div>
      <span class="login-spark s1"></span>
      <span class="login-spark s2"></span>
      <span class="login-spark s3"></span>
    </div>
    <div class="login-stage">
      <aside class="login-hero">
        <div class="login-hero-top">
          <img class="brand-logo login" src="/assets/thanvasu-logo.png" alt="THANVASU">
        </div>
        <div class="login-hero-copy">
          <p class="login-kicker">THANVASU · BCS</p>
          <h1>CS System</h1>
          <p class="login-tag">คอนโซลโปรไฟล์ลูกค้าภายใน — ดูร้าน ระบบที่ใช้งาน และสถานะซัพพอร์ตได้ในที่เดียว</p>
          <div class="login-gold-line" aria-hidden="true"></div>
          <ul class="login-points">
            <li><span class="dot" aria-hidden="true"></span>โปรไฟล์ลูกค้าครบ สาขา · ผู้ติดต่อ · ระบบ</li>
            <li><span class="dot" aria-hidden="true"></span>แฟลกสถานะ Y / E / N ตามงานซัพพอร์ต</li>
            <li><span class="dot" aria-hidden="true"></span>ส่งออกรายงานจาก BD_CSystem ได้ทันที</li>
          </ul>
        </div>
        <div class="login-hero-meta">
          <span class="login-badge"><i aria-hidden="true"></i> Internal use only</span>
          <span>Brand red · Gold CI</span>
        </div>
      </aside>
      <div class="login-panel">
        <form class="login-card" id="loginForm">
          <h2 class="form-title">ยินดีต้อนรับกลับ</h2>
          <p class="sub">เข้าสู่ระบบด้วยบัญชีพนักงาน THANVASU</p>
          <div class="err" id="loginErr" style="${err ? 'display:block' : ''}">${esc(err || '')}</div>
          <div class="fields">
            <div class="login-field">
              <label for="usr">ชื่อผู้ใช้</label>
              <input id="usr" autocomplete="username" autofocus placeholder="username">
            </div>
            <div class="login-field">
              <label for="pw">รหัสผ่าน</label>
              <div class="pw-wrap">
                <input id="pw" type="password" autocomplete="current-password" placeholder="••••••••">
                <button type="button" class="pw-toggle" id="btnTogglePw" aria-label="แสดงรหัสผ่าน">แสดง</button>
              </div>
            </div>
            <button class="btn-login" type="submit" id="btnLogin">เข้าสู่ระบบ <span class="btn-ico" aria-hidden="true">→</span></button>
          </div>
        </form>
        <p class="login-foot">© ${year} <strong>THANVASU</strong> Business Consulting System · สำหรับเจ้าหน้าที่ภายใน</p>
      </div>
    </div>
  </div>`;

  const toggle = $('#btnTogglePw');
  if (toggle) {
    toggle.onclick = () => {
      const pw = $('#pw');
      const show = pw.type === 'password';
      pw.type = show ? 'text' : 'password';
      toggle.textContent = show ? 'ซ่อน' : 'แสดง';
      toggle.setAttribute('aria-label', show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน');
    };
  }

  const stage = $('#loginStage');
  if (stage && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    stage.onmousemove = e => {
      const r = stage.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      $$('[data-parallax]', stage).forEach(el => {
        const f = Number(el.dataset.parallax || 0);
        el.style.setProperty('--tx', (x * f * 240) + 'px');
        el.style.setProperty('--ty', (y * f * 240) + 'px');
      });
    };
  }

  $('#loginForm').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#btnLogin');
    const errEl = $('#loginErr');
    errEl.style.display = 'none';
    try {
      btn.disabled = true;
      btn.innerHTML = 'กำลังเข้าสู่ระบบ…';
      const data = await api('/api/login', {
        method: 'POST',
        json: { username: $('#usr').value.trim(), password: $('#pw').value },
      });
      state.user = data.user;
      state.meta = null;
      state.shopsLoaded = false;
      state.q = '';
      state.page = 1;
      await loadMeta();
      await route();
    } catch (ex) {
      errEl.style.display = 'block';
      errEl.textContent = ex.message || 'เข้าสู่ระบบไม่สำเร็จ';
      btn.disabled = false;
      btn.innerHTML = 'เข้าสู่ระบบ <span class="btn-ico" aria-hidden="true">→</span>';
      $('#pw').focus();
    }
  };
}

async function route() {
  const seq = ++routeSeq;
  closeSide();

  const h = location.hash || '';

  if (!state.user) {
    try {
      const me = await api('/api/me');
      if (seq !== routeSeq) return;
      if (!me.authed) { renderLogin(); return; }
      state.user = me.user;
      await loadMeta();
      if (seq !== routeSeq) return;
    } catch (e) {
      if (seq !== routeSeq) return;
      renderLogin();
      return;
    }
  }

  try {
    if (h === '' || h === '#') { await renderList(); return; }
    if (h === '#new') {
      state.current = null;
      state.draft = emptyDraft(state.meta.services, state.meta.hardware);
      await renderForm(false);
      return;
    }
    if (h === '#users') {
      if (state.user.role !== 'Admin') {
        toast('สำหรับผู้ดูแลระบบเท่านั้น', true);
        go('#');
        return;
      }
      await renderUsers();
      return;
    }
    if (h === '#logs') {
      if (state.user.role !== 'Admin') {
        toast('สำหรับผู้ดูแลระบบเท่านั้น', true);
        go('#');
        return;
      }
      await renderLogs();
      return;
    }
    let m;
    if ((m = h.match(/^#shop\/(\d+)$/))) {
      setBusy(true, 'กำลังเปิดร้าน…');
      try {
        const data = await api('/api/shops/' + m[1]);
        if (seq !== routeSeq) return;
        state.current = data.shop;
        await renderDetail();
      } finally { setBusy(false); }
      return;
    }
    if ((m = h.match(/^#edit\/(\d+)$/))) {
      setBusy(true, 'กำลังโหลดฟอร์ม…');
      try {
        const data = await api('/api/shops/' + m[1]);
        if (seq !== routeSeq) return;
        state.current = data.shop;
        state.draft = draftFromShop(data.shop);
        await renderForm(true);
      } finally { setBusy(false); }
      return;
    }
    location.hash = '';
  } catch (e) {
    if (seq !== routeSeq) return;
    toast(e.message, true);
    if (!state.user) renderLogin(e.message);
    else if (h.startsWith('#shop/') || h.startsWith('#edit/')) go('#');
  }
}

window.addEventListener('hashchange', () => {
  route().catch(e => toast(e.message, true));
});
route().catch(e => { renderLogin(e.message); });
