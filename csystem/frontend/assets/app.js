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
  overviewType: '',
  overviewChart: 'bar',
};

let routeSeq = 0;
let qTimer = null;
let toastTimer = null;
let formGuardHash = null;
let formCleanSnap = null;
let hashGuardLock = false;

/** แก้ข้อความไทยที่ถูก encode ผิด (เช่น à¸… = UTF-8 ทีละไบต์) ให้กลับมาอ่านได้ */
function repairText(s) {
  let str = String(s == null ? '' : s);
  if (!str) return '';
  // น + ํ + ็ + า → น้ำ
  str = str.replace(/\u0E19\u0E4D\u0E47\u0E32/g, 'น้ำ');
  let looks = /à¸|à¹|Ã.|Â.|เธ/.test(str);
  if (!looks) {
    for (let i = 0; i < str.length - 2; i++) {
      const a = str.charCodeAt(i);
      const b = str.charCodeAt(i + 1);
      const c = str.charCodeAt(i + 2);
      if (a === 0xe0 && (b === 0xb8 || b === 0xb9) && c >= 0x80 && c <= 0xbf) { looks = true; break; }
    }
  }
  if (!looks) return str;
  try {
    const bytes = Uint8Array.from(Array.from(str, ch => ch.charCodeAt(0) & 0xff));
    const fixed = new TextDecoder('utf-8').decode(bytes);
    if (fixed && !fixed.includes('\uFFFD') && /[\u0E00-\u0E7F]/.test(fixed)) {
      return fixed.replace(/\u0E19\u0E4D\u0E47\u0E32/g, 'น้ำ');
    }
  } catch (_) {}
  return str;
}

const esc = s => repairText(s).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

/** โหลดรูปที่ต้อง login — ใช้ src ตรงก่อน ไม่ซ่อนรูปตอนยังโหลดอยู่ */
const PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function looksLikeImageBytes(u8) {
  if (!u8 || u8.length < 4) return false;
  if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return 'image/png';
  if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return 'image/jpeg';
  if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46) return 'image/gif';
  if (u8.length >= 12 && u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46
    && u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50) return 'image/webp';
  return '';
}

async function hydrateProtectedImages(root) {
  const scope = root || document;
  const imgs = $$('img[data-auth-src]', scope);
  await Promise.all(imgs.map(async (img) => {
    const url = img.getAttribute('data-auth-src');
    if (!url) return;
    img.removeAttribute('data-auth-src');

    const showPh = () => {
      img.style.display = 'none';
      const ph = img.nextElementSibling;
      if (ph && (ph.classList.contains('ov-logo-ph') || ph.classList.contains('img-ph'))) {
        ph.hidden = false;
      }
      const card = img.closest('.img-card');
      if (card) card.classList.add('img-missing');
    };

    const applyBlob = async () => {
      const blob = await api(url, { blob: true });
      if (!blob || !blob.size) return false;
      const ab = await blob.arrayBuffer();
      const u8 = new Uint8Array(ab);
      const magic = looksLikeImageBytes(u8);
      const type = String(blob.type || '').startsWith('image/')
        ? blob.type
        : (magic || '');
      if (!type && !magic) return false;
      img.style.display = '';
      img.src = URL.createObjectURL(new Blob([ab], { type: magic || type || 'image/png' }));
      return true;
    };

    // ถ้าโหลดจาก src ตรงอยู่แล้วและสำเร็จ — จบ
    if (img.complete && img.naturalWidth > 0) return;

    // ตั้ง src เป็น API (cookie same-origin) — อย่า timeout แล้วซ่อนรูป
    img.style.display = '';
    if (!img.getAttribute('src') || String(img.getAttribute('src')).startsWith('data:')) {
      img.src = url;
    }

    const okNative = await new Promise((resolve) => {
      if (img.complete && img.naturalWidth > 0) return resolve(true);
      if (img.complete && img.naturalWidth === 0) return resolve(false);
      const onOk = () => { cleanup(); resolve(true); };
      const onBad = () => { cleanup(); resolve(false); };
      const cleanup = () => {
        img.removeEventListener('load', onOk);
        img.removeEventListener('error', onBad);
      };
      img.addEventListener('load', onOk);
      img.addEventListener('error', onBad);
      // ไม่มี timeout ที่ไปโชว์ "โหลดรูปไม่ได้" — รอจนกว่าจะโหลดหรือ error จริง
    });
    if (okNative) return;

    try {
      if (await applyBlob()) return;
    } catch (_) {}
    showPh();
  }));
}

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
  toastTimer = setTimeout(() => t.classList.remove('show'), isErr ? 3200 : 2200);
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

const TH_MONTHS = [
  { v: '01', t: 'ม.ค.' }, { v: '02', t: 'ก.พ.' }, { v: '03', t: 'มี.ค.' },
  { v: '04', t: 'เม.ย.' }, { v: '05', t: 'พ.ค.' }, { v: '06', t: 'มิ.ย.' },
  { v: '07', t: 'ก.ค.' }, { v: '08', t: 'ส.ค.' }, { v: '09', t: 'ก.ย.' },
  { v: '10', t: 'ต.ค.' }, { v: '11', t: 'พ.ย.' }, { v: '12', t: 'ธ.ค.' },
];

function daysInMonth(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!y || !m) return 31;
  return new Date(y, m, 0).getDate();
}

function isoToDisplayDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').slice(0, 10));
  if (!m) return '';
  return m[3] + '/' + m[2] + '/' + m[1];
}

function parseTypedDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  let y; let m; let d;
  let hit = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (hit) {
    y = Number(hit[1]); m = Number(hit[2]); d = Number(hit[3]);
  } else {
    hit = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(s);
    if (!hit) return null;
    d = Number(hit[1]); m = Number(hit[2]); y = Number(hit[3]);
    if (y < 100) y += 2000;
    if (y >= 2400) y -= 543; // พ.ศ. → ค.ศ.
  }
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12 || d < 1) return null;
  const max = daysInMonth(y, m);
  if (d > max) return null;
  if (y < 1900 || y > 2100) return null;
  return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

function todayIso() {
  const n = new Date();
  return n.getFullYear() + '-'
    + String(n.getMonth() + 1).padStart(2, '0') + '-'
    + String(n.getDate()).padStart(2, '0');
}

function dateEasyHtml(id, value) {
  const raw = String(value || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const yy = m ? m[1] : '';
  const mm = m ? m[2] : '';
  let dd = m ? m[3] : '';
  const nowY = new Date().getFullYear();
  const years = [];
  const yMin = 1980;
  const yMax = nowY + 10;
  let yFrom = yMax;
  let yTo = yMin;
  if (yy) {
    const existing = Number(yy);
    if (Number.isFinite(existing)) {
      if (existing > yFrom) yFrom = existing;
      if (existing < yTo) yTo = existing;
    }
  }
  for (let y = yFrom; y >= yTo; y--) years.push(y);
  const maxD = daysInMonth(yy || nowY, mm || '01');
  if (dd && Number(dd) > maxD) dd = String(maxD).padStart(2, '0');
  const dayOpts = ['<option value="">วัน</option>'];
  for (let d = 1; d <= (yy && mm ? maxD : 31); d++) {
    const v = String(d).padStart(2, '0');
    dayOpts.push(`<option value="${v}" ${dd === v ? 'selected' : ''}>${d}</option>`);
  }
  const display = isoToDisplayDate(raw);
  return `
    <div class="date-easy" data-date-id="${esc(id)}">
      <div class="date-easy-row">
        <input type="text" class="date-typed" inputmode="numeric" autocomplete="off"
          placeholder="พิมพ์ วว/ดด/ปปปป เช่น ${isoToDisplayDate(todayIso())}"
          value="${esc(display)}" aria-label="พิมพ์วันที่">
        <button type="button" class="btn secondary sm date-today" title="เลือกวันนี้">วันนี้</button>
        <button type="button" class="btn ghost sm date-clear" title="ล้างวันที่">ล้าง</button>
      </div>
      <div class="date-easy-row date-easy-picks">
        <select class="date-d" aria-label="วัน">${dayOpts.join('')}</select>
        <select class="date-m" aria-label="เดือน">
          <option value="">เดือน</option>
          ${TH_MONTHS.map(x => `<option value="${x.v}" ${mm === x.v ? 'selected' : ''}>${x.t}</option>`).join('')}
        </select>
        <select class="date-y" aria-label="ปี (ค.ศ.)">
          <option value="">ปี</option>
          ${years.map(y => `<option value="${y}" ${yy === String(y) ? 'selected' : ''}>ค.ศ. ${y}</option>`).join('')}
        </select>
      </div>
      <p class="field-hint date-easy-hint">ใช้ปี ค.ศ. เช่น 14/09/2026</p>
      <input type="hidden" id="${esc(id)}" value="${esc(raw)}">
    </div>`;
}

function readDateEasy(wrap) {
  if (!wrap) return '';
  const d = ($('.date-d', wrap) || {}).value || '';
  const m = ($('.date-m', wrap) || {}).value || '';
  const y = ($('.date-y', wrap) || {}).value || '';
  if (!d || !m || !y) return '';
  const max = daysInMonth(y, m);
  const day = Math.min(Number(d), max);
  return y + '-' + m + '-' + String(day).padStart(2, '0');
}

function applyIsoToDateEasy(wrap, iso) {
  const hidden = wrap.querySelector('input[type="hidden"]');
  const typed = $('.date-typed', wrap);
  const dSel = $('.date-d', wrap);
  const mSel = $('.date-m', wrap);
  const ySel = $('.date-y', wrap);
  const raw = String(iso || '').slice(0, 10);
  const hit = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!hit) {
    if (hidden) hidden.value = '';
    if (typed) typed.value = '';
    if (dSel) dSel.value = '';
    if (mSel) mSel.value = '';
    if (ySel) ySel.value = '';
    wrap.classList.remove('date-invalid');
    return;
  }
  const y = hit[1];
  const m = hit[2];
  const d = hit[3];
  if (ySel) {
    if (![...ySel.options].some(o => o.value === y)) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = 'ค.ศ. ' + y;
      ySel.appendChild(opt);
    }
    ySel.value = y;
  }
  if (mSel) mSel.value = m;
  if (dSel) {
    const max = daysInMonth(y, m);
    let html = '<option value="">วัน</option>';
    for (let i = 1; i <= max; i++) {
      const v = String(i).padStart(2, '0');
      html += `<option value="${v}">${i}</option>`;
    }
    dSel.innerHTML = html;
    dSel.value = d;
  }
  if (hidden) hidden.value = raw;
  if (typed) typed.value = isoToDisplayDate(raw);
  wrap.classList.remove('date-invalid');
}

function bindDateEasy() {
  $$('.date-easy').forEach(wrap => {
    const typed = $('.date-typed', wrap);
    const hidden = wrap.querySelector('input[type="hidden"]');

    const syncFromSelects = () => {
      const y = ($('.date-y', wrap) || {}).value;
      const m = ($('.date-m', wrap) || {}).value;
      const dSel = $('.date-d', wrap);
      if (dSel && y && m) {
        const max = daysInMonth(y, m);
        const cur = dSel.value;
        let html = '<option value="">วัน</option>';
        for (let d = 1; d <= max; d++) {
          const v = String(d).padStart(2, '0');
          html += `<option value="${v}" ${cur === v ? 'selected' : ''}>${d}</option>`;
        }
        dSel.innerHTML = html;
        if (cur && Number(cur) > max) dSel.value = String(max).padStart(2, '0');
      }
      const iso = readDateEasy(wrap);
      if (hidden) hidden.value = iso;
      if (typed) typed.value = iso ? isoToDisplayDate(iso) : typed.value;
      if (iso) wrap.classList.remove('date-invalid');
    };

    const syncFromTyped = () => {
      if (!typed) return;
      const raw = typed.value.trim();
      if (!raw) {
        applyIsoToDateEasy(wrap, '');
        return;
      }
      const iso = parseTypedDate(raw);
      if (iso == null) {
        wrap.classList.add('date-invalid');
        if (hidden) hidden.value = '';
        return;
      }
      applyIsoToDateEasy(wrap, iso);
    };

    $$('select', wrap).forEach(sel => { sel.onchange = syncFromSelects; });
    if (typed) {
      typed.addEventListener('change', syncFromTyped);
      typed.addEventListener('blur', syncFromTyped);
      typed.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          syncFromTyped();
        }
      });
    }
    const todayBtn = $('.date-today', wrap);
    if (todayBtn) {
      todayBtn.onclick = () => applyIsoToDateEasy(wrap, todayIso());
    }
    const clr = $('.date-clear', wrap);
    if (clr) {
      clr.onclick = () => applyIsoToDateEasy(wrap, '');
    }
  });
}

function pullFormIntoDraft() {
  const d = state.draft;
  if (!d || !$('#fName')) return;
  d.name = $('#fName').value;
  d.brandName = ($('#fBrand') || {}).value || '';
  d.companyNameTh = ($('#fCoTh') || {}).value || '';
  d.companyNameEn = ($('#fCoEn') || {}).value || '';
  d.startDate = ($('#fStart') || {}).value || '';
  d.businessType = ($('#fType') || {}).value || '';
  d.businessTypeOther = ($('#fTypeOther') || {}).value || '';
  d.branchCount = ($('#fBranchCount') || {}).value === '' ? '' : ($('#fBranchCount') || {}).value;
  d.branches = $$('#branchList .branch-row').map(row => ({
    id: String(row.dataset.branchId || '').trim() || newBranchId(),
    name: (($('.br-name', row) || {}).value || ''),
    province: (($('.br-province', row) || {}).value || ''),
    mapUrl: (($('.br-map', row) || {}).value || ''),
    hardware: $$('.br-hw-qty', row).map(inp => ({
      hardwareId: Number(inp.dataset.id),
      code: inp.dataset.code || '',
      qty: Math.max(0, Math.min(9999, Number(inp.value) || 0)),
    })),
  }));
  if (!d.branches.length) {
    d.branches = normalizeDraftBranches([{ name: '', province: '', mapUrl: '' }]);
  }
  d.facebookUrl = ($('#fFb') || {}).value || '';
  d.instagramUrl = ($('#fIg') || {}).value || '';
  d.ownerName = ($('#fOwner') || {}).value || '';
  d.ownerNickname = ($('#fOwnerNick') || {}).value || '';
  d.ownerPhone = ($('#fOwnerPhone') || {}).value || '';
  d.contactName = ($('#fContact') || {}).value || '';
  d.contactNickname = ($('#fContactNick') || {}).value || '';
  d.contactPhone = ($('#fContactPhone') || {}).value || '';
  d.contactEmail = ($('#fContactEmail') || {}).value || '';
  d.contactLine = ($('#fContactLine') || {}).value || '';
  d.contactOther = ($('#fContactOther') || {}).value || '';
  d.notes = ($('#fNotes') || {}).value || '';
  d.systemFlow = ($('#fFlow') || {}).value || '';
  d.hardwareOther = ($('#fHwOther') || {}).value || '';
  d.hardware = aggregateHardwareFromBranches(d.branches);
  const svc = collectServicesFromForm();
  const svcMap = new Map(svc.map(s => [Number(s.serviceId), s]));
  d.services = (d.services || []).map(s => {
    const c = svcMap.get(Number(s.serviceId));
    if (!c) return s;
    return Object.assign({}, s, {
      status: c.status,
      statusNote: c.statusNote,
      otherText: c.otherText,
    });
  });
}

function fmtWhen(v) {
  if (!v) return '—';
  return String(v).replace('T', ' ').replace(/\.\d+Z?$/, '').replace('Z', '').slice(0, 19);
}

function navActive() {
  const h = location.hash || '#';
  if (h === '#' || h === '' || h === '#overview') return 'overview';
  if (h === '#shops' || h.startsWith('#shop/')) return 'home';
  if (h === '#new' || h.startsWith('#edit/')) return 'new';
  if (h === '#logs') return 'logs';
  if (h === '#users') return 'users';
  return '';
}

async function go(hash) {
  state.sideOpen = false;
  let next = hash || '#overview';
  if (next === '#' || next === '') next = '#overview';
  if (formGuardHash && next !== formGuardHash) {
    const ok = await allowLeaveForm(next);
    if (!ok) return false;
  }
  if ((location.hash || '') === next) {
    route().catch(e => toast(e.message, true));
    return true;
  }
  location.hash = next;
  return true;
}

function formSnapPayload() {
  const d = state.draft;
  if (!d) return null;
  return {
    name: d.name || '',
    brandName: d.brandName || '',
    companyNameTh: d.companyNameTh || '',
    companyNameEn: d.companyNameEn || '',
    startDate: d.startDate || '',
    businessType: d.businessType || '',
    businessTypeOther: d.businessTypeOther || '',
    branchCount: d.branchCount === '' || d.branchCount == null ? '' : String(d.branchCount),
    branches: (d.branches || []).map(b => ({
      id: b.id || '',
      name: b.name || '',
      province: b.province || '',
      mapUrl: b.mapUrl || '',
      hardware: (b.hardware || []).map(h => ({
        hardwareId: Number(h.hardwareId),
        qty: Number(h.qty || 0),
      })).sort((a, c) => a.hardwareId - c.hardwareId),
    })),
    facebookUrl: d.facebookUrl || '',
    instagramUrl: d.instagramUrl || '',
    ownerName: d.ownerName || '',
    ownerNickname: d.ownerNickname || '',
    ownerPhone: d.ownerPhone || '',
    contactName: d.contactName || '',
    contactNickname: d.contactNickname || '',
    contactPhone: d.contactPhone || '',
    contactEmail: d.contactEmail || '',
    contactLine: d.contactLine || '',
    contactOther: d.contactOther || '',
    notes: d.notes || '',
    systemFlow: d.systemFlow || '',
    hardwareOther: d.hardwareOther || '',
    hardware: aggregateHardwareFromBranches(d.branches || []).map(h => ({
      hardwareId: Number(h.hardwareId),
      qty: Number(h.qty || 0),
    })).sort((a, b) => a.hardwareId - b.hardwareId),
    services: (d.services || []).map(s => ({
      serviceId: Number(s.serviceId),
      status: s.status || 'N',
      statusNote: s.statusNote || '',
      otherText: s.otherText || '',
    })).sort((a, b) => a.serviceId - b.serviceId),
    images: (d.images || []).map(i => Number(i.id)).filter(Number.isFinite).sort((a, b) => a - b),
    pendingImages: (d.pendingImages || []).map(p => ({
      kind: p.kind || '',
      originalName: p.originalName || '',
      mime: p.mime || '',
    })),
  };
}

function armFormGuard(hash) {
  pullFormIntoDraft();
  formGuardHash = hash || location.hash || '#new';
  formCleanSnap = JSON.stringify(formSnapPayload());
}

function clearFormGuard() {
  formGuardHash = null;
  formCleanSnap = null;
}

function isFormDirty() {
  if (!formGuardHash || formCleanSnap == null || !state.draft || !$('#fName')) return false;
  pullFormIntoDraft();
  return JSON.stringify(formSnapPayload()) !== formCleanSnap;
}

function confirmDialog(opts) {
  const o = opts || {};
  const title = o.title || 'ยืนยัน';
  const message = o.message || '';
  const okText = o.okText || 'ตกลง';
  const cancelText = o.cancelText || 'ยกเลิก';
  const danger = !!o.danger;
  return new Promise(resolve => {
    let back = $('#appConfirmModal');
    if (back) back.remove();
    back = document.createElement('div');
    back.id = 'appConfirmModal';
    back.className = 'modal-back confirm-back';
    back.innerHTML = `
      <div class="modal-card confirm-card" role="dialog" aria-modal="true" aria-labelledby="confirmTitle">
        <div class="confirm-mark ${danger ? 'danger' : ''}" aria-hidden="true"></div>
        <h3 id="confirmTitle">${esc(title)}</h3>
        <p class="hint confirm-msg">${esc(message)}</p>
        <div class="modal-actions confirm-actions">
          <button type="button" class="btn secondary" id="confirmCancel">${esc(cancelText)}</button>
          <button type="button" class="btn ${danger ? 'danger' : 'primary'}" id="confirmOk">${esc(okText)}</button>
        </div>
      </div>`;
    document.body.appendChild(back);
    const finish = (val) => {
      document.removeEventListener('keydown', onKey);
      back.remove();
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      }
    };
    document.addEventListener('keydown', onKey);
    back.onclick = (e) => { if (e.target === back) finish(false); };
    $('#confirmCancel', back).onclick = () => finish(false);
    $('#confirmOk', back).onclick = () => finish(true);
    requestAnimationFrame(() => {
      const ok = $('#confirmOk', back);
      if (ok) ok.focus();
    });
  });
}

function confirmDiscardForm() {
  return confirmDialog({
    title: 'ยังไม่ได้บันทึก',
    message: 'มีการแก้ไขที่ยังไม่บันทึก ต้องการออกโดยไม่บันทึกหรือไม่?',
    okText: 'ออกโดยไม่บันทึก',
    cancelText: 'อยู่ต่อ',
    danger: true,
  });
}

async function allowLeaveForm(nextHash) {
  const next = nextHash || '';
  if (!formGuardHash || next === formGuardHash) return true;
  if (!isFormDirty()) {
    clearFormGuard();
    return true;
  }
  const ok = await confirmDiscardForm();
  if (!ok) return false;
  clearFormGuard();
  return true;
}

function openSide() {
  state.sideOpen = true;
  const side = $('#sidebar');
  const mobile = window.matchMedia('(max-width: 980px)').matches;
  if (side) {
    side.classList.add('open');
    if (mobile) {
      // พอร์ตออกจาก .app-shell — กัน stacking/backdrop-filter บนมือถือที่ทำให้เมนูเบลอทั้งจอ
      side.style.position = 'fixed';
      side.style.top = '0';
      side.style.left = '0';
      side.style.bottom = '0';
      side.style.width = 'min(82vw, 300px)';
      side.style.maxWidth = '300px';
      side.style.height = '100dvh';
      side.style.zIndex = '10050';
      side.style.background = '#ffffff';
      side.style.backdropFilter = 'none';
      side.style.webkitBackdropFilter = 'none';
      side.style.filter = 'none';
      side.style.transform = 'translateX(0)';
      document.body.appendChild(side);
    }
  }
  if (!mobile) return;
  let back = $('#sideBackdrop');
  if (!back) {
    back = document.createElement('div');
    back.id = 'sideBackdrop';
    back.className = 'side-backdrop';
    back.onclick = closeSide;
    document.body.appendChild(back);
  }
  // inline สำรอง — ไม่พึ่ง media query / cache CSS เก่า
  // แผ่นมืดทึบธรรมดา — ไม่ใช้ blur / glass ใด ๆ
  back.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:10040',
    'background:rgba(0,0,0,0.4)',
    'backdrop-filter:none',
    '-webkit-backdrop-filter:none',
    'filter:none',
    'opacity:1',
  ].join(';');
  document.documentElement.classList.add('side-is-open');
  document.body.classList.add('side-is-open');
}

function closeSide() {
  state.sideOpen = false;
  const side = $('#sidebar');
  const back = $('#sideBackdrop');
  if (back) back.remove();
  if (side) {
    side.classList.remove('open');
    side.style.cssText = '';
    const shellEl = document.querySelector('.app-shell');
    const main = shellEl && shellEl.querySelector('.main');
    if (shellEl && main) shellEl.insertBefore(side, main);
    else if (shellEl) shellEl.appendChild(side);
  }
  document.documentElement.classList.remove('side-is-open');
  document.body.classList.remove('side-is-open');
}

function shell(content, opts) {
  opts = opts || {};
  document.title = (opts.title ? opts.title + ' — ' : '') + 'CS System';
  const isAdmin = isAdminUser();
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
      <button type="button" class="side-brand" id="btnBrandHome" title="ไปหน้าภาพรวม" aria-label="CS System หน้าภาพรวม">
        <div class="brand-lockup">
          <img class="brand-logo" src="/assets/thanvasu-logo.png" alt="THANVASU">
          <div>
            <div class="mark">CS System</div>
            <div class="tag">THANVASU · Customer Profile</div>
          </div>
        </div>
      </button>
      <nav class="side-nav">
        <button type="button" class="side-link ${active === 'overview' ? 'on' : ''}" data-go="#overview"><span class="ni">01</span>ภาพรวม Brand</button>
        <button type="button" class="side-link ${active === 'home' ? 'on' : ''}" data-go="#shops"><span class="ni">02</span>รายการร้าน</button>
        <button type="button" class="side-link ${active === 'new' ? 'on' : ''}" data-go="#new"><span class="ni">03</span>เพิ่มร้าน</button>
        ${isAdmin ? `<button type="button" class="side-link ${active === 'users' ? 'on' : ''}" data-go="#users"><span class="ni">04</span>ผู้ใช้</button>` : ''}
        ${isAdmin ? `<button type="button" class="side-link ${active === 'logs' ? 'on' : ''}" data-go="#logs"><span class="ni">05</span>ประวัติ</button>` : ''}
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
        <button type="button" class="mobile-brand" id="btnBrandHomeMobile" title="ไปหน้าภาพรวม" aria-label="CS System หน้าภาพรวม"><img class="brand-logo sm" src="/assets/thanvasu-logo.png" alt=""><span class="mark">CS System</span></button>
        <button type="button" class="btn primary sm" id="btnAddMobile">+ เพิ่ม</button>
      </div>
      ${content}
      <footer class="page-scroll-foot">
        <button type="button" class="page-scroll-top" id="btnPageScrollTop" aria-label="กลับขึ้นบนสุด" title="กลับขึ้นบนสุด">↑</button>
      </footer>
    </main>
  </div>`;

  $$('.side-link').forEach(btn => btn.onclick = () => go(btn.dataset.go || '#'));
  const brandHome = $('#btnBrandHome');
  if (brandHome) brandHome.onclick = () => go('#overview');
  const brandHomeM = $('#btnBrandHomeMobile');
  if (brandHomeM) brandHomeM.onclick = () => go('#overview');
  const menu = $('#btnMenu');
  if (menu) menu.onclick = () => (state.sideOpen ? closeSide() : openSide());
  const addM = $('#btnAddMobile');
  if (addM) addM.onclick = () => go('#new');
  $('#navLogout').onclick = async () => {
    if (formGuardHash && isFormDirty()) {
      const ok = await confirmDiscardForm();
      if (!ok) return;
    }
    clearFormGuard();
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
  ensureScrollTopBtn();
  const pageTopBtn = $('#btnPageScrollTop');
  if (pageTopBtn) pageTopBtn.onclick = (e) => {
    e.preventDefault();
    scrollToVeryTop();
  };
}

function scrollToVeryTop() {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const candidates = [
    document.querySelector('.main'),
    document.scrollingElement,
    document.documentElement,
    document.body,
  ].filter(Boolean);

  let scroller = window;
  let startY = window.scrollY || document.documentElement.scrollTop || 0;
  for (const el of candidates) {
    if (el.scrollTop > 2 && el.scrollHeight > el.clientHeight + 40) {
      scroller = el;
      startY = el.scrollTop;
      break;
    }
  }
  if (scroller === window && startY < 2) {
    const main = document.querySelector('.main');
    if (main && main.scrollTop > 2) {
      scroller = main;
      startY = main.scrollTop;
    }
  }

  // ปุ่มเด้งนิดตอนกด
  $$('.page-scroll-top, #btnScrollTop, #btnPageScrollTop').forEach(b => {
    b.classList.remove('scroll-fly');
    void b.offsetWidth;
    b.classList.add('scroll-fly');
  });

  if (reduce || startY <= 0) {
    if (scroller === window) window.scrollTo(0, 0);
    else scroller.scrollTop = 0;
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    const main = document.querySelector('.main');
    if (main) main.scrollTop = 0;
    return;
  }

  if (window.__csScrollTopAnim) {
    cancelAnimationFrame(window.__csScrollTopAnim);
    window.__csScrollTopAnim = 0;
  }

  // easeInOutCubic — ลื่นขึ้นช้า-เร็ว-ช้า
  const ease = (t) => (t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const duration = Math.min(1100, Math.max(520, startY * 0.55));
  const t0 = performance.now();

  const step = (now) => {
    const p = Math.min(1, (now - t0) / duration);
    const y = startY * (1 - ease(p));
    if (scroller === window) {
      window.scrollTo(0, y);
    } else {
      scroller.scrollTop = y;
      // sync window เผื่อมี scroll คู่
      if (window.scrollY > 0) window.scrollTo(0, y);
    }
    if (p < 1) {
      window.__csScrollTopAnim = requestAnimationFrame(step);
    } else {
      window.__csScrollTopAnim = 0;
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      const main = document.querySelector('.main');
      if (main) main.scrollTop = 0;
      if (scroller !== window && scroller !== main) scroller.scrollTop = 0;
    }
  };
  window.__csScrollTopAnim = requestAnimationFrame(step);
}

function ensureScrollTopBtn() {
  let btn = $('#btnScrollTop');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'btnScrollTop';
    btn.className = 'scroll-top-btn';
    btn.setAttribute('aria-label', 'กลับขึ้นบนสุด');
    btn.title = 'กลับขึ้นบนสุด';
    btn.textContent = '↑';
    document.body.appendChild(btn);
  }

  btn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    scrollToVeryTop();
  };

  const update = () => {
    if (!document.querySelector('.app-shell')) {
      btn.classList.remove('show', 'at-bottom');
      return;
    }
    let scrolled = false;
    let nearBottom = false;
    const check = (el) => {
      if (!el) return;
      const top = el === window ? (window.scrollY || document.documentElement.scrollTop || 0) : el.scrollTop;
      const max = el === window
        ? Math.max(0, (document.documentElement.scrollHeight || document.body.scrollHeight || 0) - window.innerHeight)
        : Math.max(0, el.scrollHeight - el.clientHeight);
      if (max <= 40) return;
      if (top > 80) scrolled = true;
      if (top >= max - 64) nearBottom = true;
    };
    check(window);
    check(document.querySelector('.main'));
    check(document.querySelector('.app-shell'));
    btn.classList.toggle('show', scrolled || nearBottom);
    btn.classList.toggle('at-bottom', nearBottom);
  };

  if (!window.__csScrollTopBound) {
    window.__csScrollTopBound = true;
    window.addEventListener('scroll', update, { passive: true, capture: true });
    window.addEventListener('resize', update, { passive: true });
    document.addEventListener('scroll', update, { passive: true, capture: true });
  }

  $$('.main, .app-shell').forEach(el => {
    if (el.__csScrollTopAttached) return;
    el.__csScrollTopAttached = true;
    el.addEventListener('scroll', update, { passive: true });
  });

  update();
  requestAnimationFrame(update);
  setTimeout(update, 200);
}

function bindAppFx() {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const main = document.querySelector('.main');
  const routeKey = String(location.hash || '#overview');
  const routeChanged = window.__csLastFxRoute !== routeKey;
  window.__csLastFxRoute = routeKey;

  if (main && routeChanged && !reduce) {
    main.classList.remove('page-enter');
    void main.offsetWidth;
    main.classList.add('page-enter');
  }

  if (main && routeChanged) {
    main.querySelectorAll(
      '.page-head, .stat, .surface, .detail-hero, .panel, .empty, .ov-kpi, .ov-chart, .control-bar'
    ).forEach((el, i) => {
      el.classList.add('fx-rise');
      el.style.setProperty('--fx-delay', (Math.min(i, 10) * 0.04) + 's');
    });
  }

  // Count-up เฉพาะครั้งแรกของแต่ละตัวเลขในรอบนี้ (ไม่รีเซ็ตตอนสลับกราฟ/ฟิลเตอร์)
  if (!reduce) {
    $$('.ov-kpi-value, .stat .value').forEach(el => {
      const raw = String(el.textContent || '').replace(/[^\d.-]/g, '');
      const target = Number(raw);
      if (!Number.isFinite(target) || target < 0 || target > 999999) return;
      const key = el.className + ':' + target;
      if (el.dataset.countKey === key) return;
      el.dataset.countKey = key;
      if (!routeChanged && el.dataset.counted === '1') {
        el.textContent = target.toLocaleString('th-TH');
        return;
      }
      el.dataset.counted = '1';
      if (target === 0) {
        el.textContent = '0';
        return;
      }
      const start = performance.now();
      const dur = 650;
      const tick = (now) => {
        const t = Math.min(1, (now - start) / dur);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = Math.round(target * eased).toLocaleString('th-TH');
        if (t < 1) requestAnimationFrame(tick);
      };
      el.textContent = '0';
      requestAnimationFrame(tick);
    });
  }

  if (!reduce) {
    $$('.btn.primary, .btn-login').forEach(btn => {
      btn.onpointermove = (e) => {
        const r = btn.getBoundingClientRect();
        btn.style.setProperty('--mx', ((e.clientX - r.left) / r.width) * 100 + '%');
        btn.style.setProperty('--my', ((e.clientY - r.top) / r.height) * 100 + '%');
      };
      btn.onpointerleave = () => {
        btn.style.removeProperty('--mx');
        btn.style.removeProperty('--my');
      };
    });
  }

  // Side nav indicator — bind ครั้งเดียวต่อ nav element
  const nav = document.querySelector('.side-nav');
  if (nav) {
    let ink = nav.querySelector('.side-ink');
    if (!ink) {
      ink = document.createElement('span');
      ink.className = 'side-ink';
      ink.setAttribute('aria-hidden', 'true');
      nav.prepend(ink);
    }
    const placeInk = (el, preview) => {
      if (!el) {
        ink.classList.remove('show', 'preview');
        return;
      }
      ink.style.setProperty('--ink-y', el.offsetTop + 'px');
      ink.style.height = el.offsetHeight + 'px';
      ink.classList.add('show');
      ink.classList.toggle('preview', !!preview);
    };
    placeInk(nav.querySelector('.side-link.on'), false);
    if (!nav.__csInkBound) {
      nav.__csInkBound = true;
      nav.addEventListener('pointerover', (e) => {
        const link = e.target.closest('.side-link');
        if (!link || !nav.contains(link)) return;
        placeInk(link, true);
      });
      nav.addEventListener('pointerleave', () => {
        placeInk(nav.querySelector('.side-link.on'), false);
      });
    }
  }

  const fx = document.querySelector('.app-fx');
  if (!fx || reduce) return;
  const orbs = fx.querySelectorAll('.app-fx-orb');
  if (!orbs.length) return;
  const onMove = (e) => {
    const x = (e.clientX / window.innerWidth - .5) * 18;
    const y = (e.clientY / window.innerHeight - .5) * 12;
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
  if (role === 'SuperAdmin') return 'Super Admin';
  if (role === 'Admin') return 'ผู้ดูแลระบบ';
  return 'ผู้ใช้งาน';
}

function isAdminUser(u) {
  const user = u || state.user;
  return !!(user && (user.role === 'Admin' || user.role === 'SuperAdmin'));
}

function isSuperAdminUser(u) {
  const user = u || state.user;
  return !!(user && user.role === 'SuperAdmin');
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
      s.name, s.brandName,
      s.companyNameTh, s.companyNameEn,
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
    <tr data-id="${s.id}" tabindex="0" class="shop-row">
      <td data-label="ร้าน"><div class="shop-name">${esc(s.name)}</div></td>
      <td data-label="วันเริ่มใช้" class="nowrap">${esc(fmtDate(s.startDate))}</td>
      <td data-label="ประเภท">${esc(s.businessType ? bizLabel(s.businessType) : '—')}</td>
      <td data-label="ระบบที่เปิดใช้">${summaryChips(s.serviceSummary)}</td>
    </tr>`).join('');

  return {
    pages,
    html: `<div class="table-wrap shop-list-wrap">
      <table class="data shop-list">
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
  const hint = document.querySelector('.list-hint');
  if (hint) {
    hint.textContent = `กดที่แถวเพื่อเปิดรายละเอียดโปรไฟล์ · แสดง ${list.length.toLocaleString('th-TH')} จาก ${(state.shops || []).length.toLocaleString('th-TH')} ร้าน`;
  }
  const metaShow = document.querySelector('.sh-meta-chip strong');
  if (metaShow) metaShow.textContent = list.length.toLocaleString('th-TH');
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

  let overview = { totalBrands: 0, totalBranches: 0, totalBusinessTypes: 0 };
  try {
    overview = await api('/api/overview/brands');
  } catch (e) { /* keep zeros */ }
  const fmtN = (n) => Number(n || 0).toLocaleString('th-TH');

  shell(`
    <section class="shops-board">
      <div class="sh-hero">
        <div class="sh-hero-copy">
          <p class="sh-kicker">THANVASU · Customer Profile</p>
          <h1 class="sh-title">รายการร้าน</h1>
          <p class="sh-sub">ค้นหาและดูโปรไฟล์ลูกค้า / ระบบที่ใช้งานได้จากหน้านี้</p>
          <div class="sh-meta-row">
            <span class="sh-meta-chip"><strong>${fmtN(list.length)}</strong> รายการที่แสดง</span>
            <span class="sh-meta-chip soft"><strong>${fmtN((state.shops || []).length)}</strong> ร้านทั้งหมด</span>
          </div>
        </div>
        <div class="sh-hero-actions page-actions">
          <button type="button" class="btn secondary sm" id="btnExportExcel">ส่งออก Excel</button>
          <button type="button" class="btn secondary sm" id="btnReload">รีเฟรช</button>
          <button type="button" class="btn primary sm" id="btnAddTop">+ เพิ่มร้าน</button>
        </div>
      </div>

      <div class="ov-kpis list-ov-kpis sh-kpis">
        <div class="ov-kpi" style="--i:0">
          <div class="ov-kpi-label">TOTAL BRANDS</div>
          <div class="ov-kpi-value">${fmtN(overview.totalBrands)}</div>
        </div>
        <div class="ov-kpi" style="--i:1">
          <div class="ov-kpi-label">TOTAL BRANCH</div>
          <div class="ov-kpi-value">${fmtN(overview.totalBranches)}</div>
        </div>
        <div class="ov-kpi" style="--i:2">
          <div class="ov-kpi-label">TOTAL BUSINESS TYPE</div>
          <div class="ov-kpi-value">${fmtN(overview.totalBusinessTypes)}</div>
        </div>
      </div>

      <div class="surface control-bar glow-edge sh-controls">
        <div class="field">
          <label for="q">ค้นหา</label>
          <input type="search" id="q" name="csystem_shop_search" placeholder="ชื่อร้าน / Brand / ชื่อบริษัท / Company…" value="${esc(state.q)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" data-form-type="other" readonly>
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

      <div class="list-hint sh-hint">กดที่แถวเพื่อเปิดรายละเอียดโปรไฟล์ · แสดง ${list.length.toLocaleString('th-TH')} จาก ${(state.shops || []).length.toLocaleString('th-TH')} ร้าน</div>

      <div class="surface table-shell glow-edge sh-table" id="listBody">${painted.html}</div>
      <div class="list-pager" id="listPager">${pagerHtml(painted.pages, list.length)}</div>
    </section>
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


function newBranchId() {
  return 'b' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function emptyBranchHardware() {
  const hw = (state.meta && state.meta.hardware) || [];
  return hw.map(h => ({
    hardwareId: h.id, code: h.code, name: h.name, qty: 0,
  }));
}

function normalizeDraftBranches(list) {
  const arr = Array.isArray(list) ? list : [];
  const seen = new Set();
  return arr.map(b => {
    let id = String((b && b.id) || '').trim();
    if (!id || seen.has(id)) id = newBranchId();
    seen.add(id);
    const hwMeta = emptyBranchHardware();
    const byId = new Map(((b && b.hardware) || []).map(h => [Number(h.hardwareId || h.id), Number(h.qty || 0)]));
    return {
      id,
      name: String((b && b.name) || '').trim(),
      province: String((b && b.province) || '').trim(),
      mapUrl: String((b && b.mapUrl) || '').trim(),
      hardwareLegacy: !!(b && b.hardwareLegacy),
      hardware: hwMeta.map(h => ({
        ...h,
        qty: byId.has(Number(h.hardwareId)) ? byId.get(Number(h.hardwareId)) : 0,
      })),
    };
  });
}

function branchHwStats(hardware) {
  const items = (hardware || []).filter(h => Number(h.qty) > 0);
  const kinds = items.length;
  const units = items.reduce((n, h) => n + (Number(h.qty) || 0), 0);
  const preview = items.slice(0, 3).map(h => `${h.name} ${h.qty}`).join(' · ');
  const more = kinds > 3 ? ` · +${kinds - 3}` : '';
  return { items, kinds, units, preview: preview ? preview + more : '' };
}

function branchesViewHtml(branches) {
  const list = Array.isArray(branches) ? branches : [];
  if (!list.length) return '—';
  const rows = list.map((b, i) => {
    const title = String(b.name || '—').trim() || '—';
    const prov = String(b.province || '').trim();
    const map = String(b.mapUrl || '').trim();
    const stats = branchHwStats(b.hardware);
    const idx = String(i + 1).padStart(2, '0');
    const hwLabel = stats.kinds
      ? `${stats.kinds} ชนิด · ${stats.units} เครื่อง`
      : 'ยังไม่ระบุ HW';
    const hwBody = stats.items.length
      ? `<div class="hw-view br-hw-view">${stats.items.map(h =>
          `<div class="hw-chip"><b>${esc(h.name)}</b> · ${esc(h.qty)} เครื่อง</div>`
        ).join('')}</div>`
      : '<div class="field-hint">ยังไม่ระบุ Hardware</div>';
    const legacy = b.hardwareLegacy
      ? '<div class="br-hw-legacy">ข้อมูลเดิมยังไม่แยกสาขา (แสดงที่สาขาแรก)</div>'
      : '';
    const mapHtml = map
      ? `<a class="map-link" href="${esc(map)}" target="_blank" rel="noopener noreferrer">เปิดแผนที่</a>`
      : '<span class="field-hint">ไม่มีลิงก์แผนที่</span>';
    return `
      <div class="branch-acc" data-search="${esc((title + ' ' + prov).toLowerCase())}">
        <button type="button" class="branch-acc-sum" aria-expanded="false">
          <span class="br-acc-idx">${idx}</span>
          <span class="br-acc-main">
            <span class="br-acc-name">${esc(title)}</span>
            ${prov ? `<span class="br-acc-prov">${esc(prov)}</span>` : ''}
          </span>
          <span class="br-acc-hw ${stats.kinds ? '' : 'empty'}">${esc(hwLabel)}</span>
          <span class="br-acc-chev" aria-hidden="true"></span>
        </button>
        <div class="branch-acc-body" hidden>
          ${legacy}
          <div class="branch-acc-map">${mapHtml}</div>
          ${hwBody}
        </div>
      </div>`;
  }).join('');
  return `
    <div class="branch-board" id="branchBoard">
      <div class="branch-board-toolbar">
        <input type="search" id="branchFilter" class="branch-filter" placeholder="ค้นหาสาขา / จังหวัด…" autocomplete="off">
        <span class="branch-board-count"><b data-shown="${list.length}">${list.length}</b> / ${list.length} สาขา</span>
      </div>
      <div class="branch-board-list">${rows}</div>
    </div>`;
}

function bindBranchBoard() {
  const board = $('#branchBoard');
  if (!board) return;
  const list = $('.branch-board-list', board);
  const input = $('#branchFilter', board);
  const shown = board.querySelector('[data-shown]');
  const items = $$('.branch-acc', board);

  const setOpen = (acc, open) => {
    const btn = $('.branch-acc-sum', acc);
    const body = $('.branch-acc-body', acc);
    if (!btn || !body) return;
    acc.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    body.hidden = !open;
    if (open && list) {
      requestAnimationFrame(() => {
        const top = acc.offsetTop - 4;
        list.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      });
    }
  };

  items.forEach(acc => {
    const btn = $('.branch-acc-sum', acc);
    if (!btn) return;
    btn.onclick = () => {
      const willOpen = !acc.classList.contains('is-open');
      items.forEach(other => {
        if (other !== acc) setOpen(other, false);
      });
      setOpen(acc, willOpen);
    };
  });

  if (input) {
    const apply = () => {
      const q = String(input.value || '').trim().toLowerCase();
      let n = 0;
      items.forEach(el => {
        const hay = el.getAttribute('data-search') || '';
        const ok = !q || hay.includes(q);
        el.hidden = !ok;
        if (!ok) setOpen(el, false);
        if (ok) n++;
      });
      if (shown) shown.textContent = String(n);
    };
    input.addEventListener('input', apply);
  }
}

function branchHardwareEditorHtml(hardware) {
  const stats = branchHwStats(hardware);
  const sumLabel = stats.kinds
    ? `Hardware ที่สาขานี้ · ${stats.kinds} ชนิด · ${stats.units} เครื่อง`
    : 'Hardware ที่สาขานี้ · ยังไม่ระบุ';
  return `
    <details class="br-hw-fold">
      <summary class="br-hw-fold-sum">${esc(sumLabel)}</summary>
      <div class="br-hw">
        <div class="hw-grid br-hw-grid">
          ${(hardware || emptyBranchHardware()).map(h => `
            <label class="hw-item">
              <span class="hw-name">${esc(h.name)}</span>
              <input class="hw-qty br-hw-qty" type="number" min="0" max="9999" step="1"
                data-id="${h.hardwareId}" data-code="${esc(h.code)}"
                value="${esc(h.qty != null ? h.qty : 0)}">
              <span class="hw-unit">เครื่อง</span>
            </label>`).join('')}
        </div>
      </div>
    </details>`;
}

function branchesEditorHtml(branches) {
  const rows = (branches && branches.length)
    ? normalizeDraftBranches(branches)
    : [normalizeDraftBranches([{ name: '', province: '', mapUrl: '' }])[0]];
  return `
    <div id="branchList" class="branch-list">
      ${rows.map((b, i) => `
        <div class="branch-row" data-idx="${i}" data-branch-id="${esc(b.id)}">
          <div class="br-field">
            <label>ชื่อสาขา</label>
            <input class="br-name" value="${esc(b.name)}" placeholder="เช่น สาขาสยาม">
          </div>
          <div class="br-field">
            <label>จังหวัด</label>
            <input class="br-province" value="${esc(b.province)}" placeholder="เช่น กรุงเทพฯ">
          </div>
          <div class="br-field">
            <label>Link map</label>
            <input class="br-map" value="${esc(b.mapUrl)}" placeholder="https://maps.google.com/...">
          </div>
          <button type="button" class="btn ghost sm br-del" title="ลบสาขา">ลบ</button>
          ${b.hardwareLegacy ? '<div class="br-hw-legacy">ข้อมูล Hardware เดิมยังไม่แยกสาขา — ใส่ไว้ที่สาขาแรก ให้กระจายตามจริงแล้วบันทึก</div>' : ''}
          ${branchHardwareEditorHtml(b.hardware)}
        </div>`).join('')}
    </div>
    <button type="button" class="btn secondary sm" id="btnAddBranch">+ เพิ่มสาขา</button>`;
}

function collectBranchesFromForm() {
  return $$('#branchList .branch-row').map(row => {
    const hardware = $$('.br-hw-qty', row).map(inp => ({
      hardwareId: Number(inp.dataset.id),
      code: inp.dataset.code || '',
      qty: Math.max(0, Math.min(9999, Number(inp.value) || 0)),
    }));
    return {
      id: String(row.dataset.branchId || '').trim() || newBranchId(),
      name: (($('.br-name', row) || {}).value || '').trim(),
      province: (($('.br-province', row) || {}).value || '').trim(),
      mapUrl: (($('.br-map', row) || {}).value || '').trim(),
      hardware,
    };
  }).filter(b => b.name);
}

function aggregateHardwareFromBranches(branches) {
  const hwMeta = emptyBranchHardware();
  const totals = new Map(hwMeta.map(h => [Number(h.hardwareId), { ...h, qty: 0 }]));
  for (const b of branches || []) {
    for (const h of b.hardware || []) {
      const id = Number(h.hardwareId);
      if (!totals.has(id)) continue;
      totals.get(id).qty += Number(h.qty) || 0;
    }
  }
  return [...totals.values()];
}

function hardwareSummaryHtml(hardware) {
  const items = (hardware || []).filter(h => Number(h.qty) > 0);
  if (!items.length) {
    return '<p class="field-hint">ยังไม่มีจำนวนเครื่องจากสาขา — กรอก Hardware ในแต่ละสาขาด้านบน</p>';
  }
  return `
    <div class="hw-view">
      ${items.map(h => `<div class="hw-chip"><b>${esc(h.name)}</b> · รวม ${esc(h.qty)} เครื่อง</div>`).join('')}
    </div>`;
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
        $$('input', row).forEach(i => {
          if (i.classList.contains('br-hw-qty')) i.value = '0';
          else i.value = '';
        });
        updateBranchMatchHint();
        refreshHardwareSummary();
        return;
      }
      row.remove();
      updateBranchMatchHint();
      refreshHardwareSummary();
    };
  };
  const addRow = (b) => {
    const branch = normalizeDraftBranches([b || { name: '', province: '', mapUrl: '' }])[0];
    const wrap = document.createElement('div');
    wrap.className = 'branch-row';
    wrap.dataset.branchId = branch.id;
    wrap.innerHTML = `
      <div class="br-field"><label>ชื่อสาขา</label><input class="br-name" value="${esc(branch.name)}" placeholder="เช่น สาขาสยาม"></div>
      <div class="br-field"><label>จังหวัด</label><input class="br-province" value="${esc(branch.province)}" placeholder="เช่น กรุงเทพฯ"></div>
      <div class="br-field"><label>Link map</label><input class="br-map" value="${esc(branch.mapUrl)}" placeholder="https://maps.google.com/..."></div>
      <button type="button" class="btn ghost sm br-del" title="ลบสาขา">ลบ</button>
      ${branchHardwareEditorHtml(branch.hardware)}`;
    list.appendChild(wrap);
    bindDel($('.br-del', wrap));
    const nameInp = $('.br-name', wrap);
    if (nameInp) nameInp.addEventListener('input', updateBranchMatchHint);
    $$('.br-hw-qty', wrap).forEach(inp => inp.addEventListener('input', refreshHardwareSummary));
    updateBranchMatchHint();
    refreshHardwareSummary();
  };
  $$('#branchList .br-del').forEach(bindDel);
  $$('#branchList .br-name').forEach(inp => inp.addEventListener('input', updateBranchMatchHint));
  $$('#branchList .br-hw-qty').forEach(inp => inp.addEventListener('input', refreshHardwareSummary));
  const addBtn = $('#btnAddBranch');
  if (addBtn) addBtn.onclick = () => addRow({ name: '', province: '', mapUrl: '' });

  const countEl = $('#fBranchCount');
  if (countEl) {
    countEl.addEventListener('change', () => {
      const target = Number(countEl.value);
      if (!Number.isFinite(target) || target < 0) {
        updateBranchMatchHint();
        return;
      }
      let rows = $$('#branchList .branch-row');
      while (rows.length < target) {
        addRow({ name: '', province: '', mapUrl: '' });
        rows = $$('#branchList .branch-row');
      }
      updateBranchMatchHint();
    });
  }
  updateBranchMatchHint();
  refreshHardwareSummary();
}

function refreshHardwareSummary() {
  const box = $('#hwSummary');
  const branches = $$('#branchList .branch-row').map(row => ({
    hardware: $$('.br-hw-qty', row).map(inp => ({
      hardwareId: Number(inp.dataset.id),
      name: (($('.hw-name', inp.closest('.hw-item')) || {}).textContent || '').trim(),
      qty: Number(inp.value) || 0,
    })),
  }));
  const hw = emptyBranchHardware().map(h => {
    let qty = 0;
    for (const b of branches) {
      const hit = (b.hardware || []).find(x => Number(x.hardwareId) === Number(h.hardwareId));
      if (hit) qty += Number(hit.qty) || 0;
    }
    return { ...h, qty };
  });
  if (box) box.innerHTML = hardwareSummaryHtml(hw);

  $$('#branchList .branch-row').forEach(row => {
    const sum = $('.br-hw-fold-sum', row);
    if (!sum) return;
    const items = $$('.br-hw-qty', row).map(inp => ({
      name: (($('.hw-name', inp.closest('.hw-item')) || {}).textContent || '').trim(),
      qty: Number(inp.value) || 0,
    })).filter(h => h.qty > 0);
    const kinds = items.length;
    const units = items.reduce((n, h) => n + h.qty, 0);
    sum.textContent = kinds
      ? `Hardware ที่สาขานี้ · ${kinds} ชนิด · ${units} เครื่อง`
      : 'Hardware ที่สาขานี้ · ยังไม่ระบุ';
  });
}

function updateBranchMatchHint() {
  const hint = $('#branchMatchHint');
  const countEl = $('#fBranchCount');
  if (!hint) return;
  const declared = countEl && countEl.value !== '' ? Number(countEl.value) : null;
  const named = collectBranchesFromForm().length;
  if (declared == null || !Number.isFinite(declared)) {
    hint.textContent = named ? `มีชื่อสาขา ${named} รายการ` : '';
    hint.className = 'field-hint branch-match-hint';
    return;
  }
  if (named === declared) {
    hint.textContent = `ครบแล้ว ${named}/${declared} สาขา`;
    hint.className = 'field-hint branch-match-hint ok';
  } else {
    hint.textContent = `ต้องมีชื่อสาขาครบ ${declared} รายการ (ตอนนี้มี ${named})`;
    hint.className = 'field-hint branch-match-hint bad';
  }
}

function validateBranchCountMatch(branchCount, branches) {
  const named = (branches || []).length;
  if (branchCount == null || branchCount === '') return null;
  const n = Number(branchCount);
  if (!Number.isFinite(n) || n < 0) return 'จำนวนสาขาไม่ถูกต้อง';
  if (named !== n) {
    return `จำนวนสาขาที่กรอกเป็น ${n} ต้องเพิ่มชื่อสาขาให้ครบ ${n} รายการ (ตอนนี้มี ${named})`;
  }
  return null;
}

function emptyDraft(services, hardware) {
  const hw = hardware || (state.meta && state.meta.hardware) || [];
  return {
    name: '', brandName: '', companyNameTh: '', companyNameEn: '',
    startDate: '', businessType: '', businessTypeOther: '',
    branchCount: '',
    branches: normalizeDraftBranches([{ name: '', province: '', mapUrl: '' }]),
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
  const branches = normalizeDraftBranches(
    (shop.branches && shop.branches.length)
      ? shop.branches
      : (shop.branchNames || []).map(name => typeof name === 'object' ? name : ({ name, province: '', mapUrl: '' }))
  );
  return {
    name: shop.name || '',
    brandName: shop.brandName || '',
    companyNameTh: shop.companyNameTh || '',
    companyNameEn: shop.companyNameEn || '',
    startDate: shop.startDate || '',
    businessType: shop.businessType || '',
    businessTypeOther: shop.businessTypeOther || '',
    branchCount: shop.branchCount != null ? shop.branchCount : '',
    branches: branches.length ? branches : normalizeDraftBranches([{ name: '', province: '', mapUrl: '' }]),
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
    hardware: aggregateHardwareFromBranches(branches),
    images: shop.images || [],
    pendingImages: [],
    services: shop.services || [],
  };
}

function collectHardwareFromForm() {
  return aggregateHardwareFromBranches(collectBranchesFromForm());
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
    const isRemote = src.startsWith('/api/media/');
    return `<div class="img-card">
      ${isRemote
        ? `<img src="${esc(src)}" data-auth-src="${esc(src)}" alt=""><span class="img-ph" hidden>โหลดรูปไม่ได้</span>`
        : `<img src="${esc(src)}" alt="">`}
      <button type="button" class="img-del" ${delAttr} aria-label="ลบรูป">ลบ</button>
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

async function renderForm(editing, opts) {
  const keepGuard = !!(opts && opts.keepGuard);
  const types = state.meta.businessTypes || [];
  const d = state.draft;
  const sourceMeta = ((state.meta.dataSources || [])
    .filter(s => s.dataSource && s.valid !== false && s.dataSource !== '.' && s.dataSource !== '(ไม่ระบุ)'));
  const sourceValues = new Set(sourceMeta.map(s => s.dataSource));
  if (d.dataSource && !sourceValues.has(d.dataSource)) {
    sourceMeta.push({ dataSource: d.dataSource, label: d.dataSource, count: 0, central: false, valid: false });
  }
  const backTo = editing && state.current ? '#shop/' + state.current.id : '#shops';

  shell(`
    <button type="button" class="back" id="btnBack">← กลับ</button>
    <section class="form-board">
      <div class="form-hero">
        <div class="form-hero-copy">
          <p class="form-kicker">THANVASU · Customer Profile</p>
          <h1 class="form-title">${editing ? 'แก้ไขโปรไฟล์ลูกค้า' : 'เพิ่มโปรไฟล์ลูกค้า'}</h1>
          <p class="form-sub">กรอกทีละส่วน — กดแถบด้านบนเพื่อกระโดดไปยังข้อมูลลูกค้า · ระบบ · Hardware · รูปภาพ</p>
          <div class="form-meta-row">
            <span class="form-meta-chip"><strong>4</strong> ส่วน</span>
            <span class="form-meta-chip soft">${editing ? 'โหมดแก้ไข' : 'สร้างใหม่'}</span>
            <span class="form-meta-chip soft">ช่อง * จำเป็น</span>
          </div>
        </div>
        <div class="form-hero-aside" aria-hidden="true">
          <div class="form-hero-badge">${editing ? 'EDIT' : 'NEW'}</div>
          <div class="form-hero-ring"></div>
        </div>
      </div>

      <nav class="form-steps" aria-label="ส่วนของฟอร์ม">
        <a class="form-step on" href="#form-sec-1" data-sec="form-sec-1">
          <span class="form-step-num">01</span>
          <span class="form-step-body">
            <span class="form-step-label">ข้อมูลลูกค้า</span>
            <span class="form-step-hint">ร้าน · สาขา · ผู้ติดต่อ</span>
          </span>
        </a>
        <a class="form-step" href="#form-sec-2" data-sec="form-sec-2">
          <span class="form-step-num">02</span>
          <span class="form-step-body">
            <span class="form-step-label">ระบบ</span>
            <span class="form-step-hint">Y / E / N · Flow</span>
          </span>
        </a>
        <a class="form-step" href="#form-sec-3" data-sec="form-sec-3">
          <span class="form-step-num">03</span>
          <span class="form-step-body">
            <span class="form-step-label">Hardware</span>
            <span class="form-step-hint">จำนวนเครื่อง</span>
          </span>
        </a>
        <a class="form-step" href="#form-sec-4" data-sec="form-sec-4">
          <span class="form-step-num">04</span>
          <span class="form-step-body">
            <span class="form-step-label">รูปภาพ</span>
            <span class="form-step-hint">โลโก้ · หน้าร้าน</span>
          </span>
        </a>
      </nav>

    <div class="surface panel glow-edge form-panel" id="form-sec-1">
      <div class="form-panel-head">
        <span class="form-panel-num" aria-hidden="true">01</span>
        <div class="form-panel-copy">
          <h2 class="form-step-title">ข้อมูลลูกค้า</h2>
          <p class="form-panel-sub">ชื่อร้าน แบรนด์ สาขา และผู้ติดต่อหลัก</p>
        </div>
      </div>
      <div class="form-grid">
        <div class="form-section full">
          <div class="form-section-title"><span class="form-section-mark" aria-hidden="true"></span>ร้าน / บริษัท</div>
          <div class="form-subgrid">
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
            <div class="full date-field">
              <label for="fStart">วันที่เริ่มใช้ระบบ *</label>
              ${dateEasyHtml('fStart', d.startDate || '')}
            </div>
          </div>
        </div>

        <div class="form-section full">
          <div class="form-section-head">
            <div class="form-section-title"><span class="form-section-mark" aria-hidden="true"></span>สาขา</div>
            <div class="branch-count-inline">
              <label for="fBranchCount">จำนวนสาขา</label>
              <input id="fBranchCount" type="number" min="0" max="9999" value="${esc(d.branchCount === '' || d.branchCount == null ? '' : d.branchCount)}">
            </div>
          </div>
          <div class="form-subgrid">
            <div class="full">
              <label>รายชื่อสาขา</label>
              ${branchesEditorHtml(d.branches)}
              <p class="field-hint branch-match-hint" id="branchMatchHint"></p>
            </div>
          </div>
        </div>

        <div class="form-section full">
          <div class="form-section-title"><span class="form-section-mark" aria-hidden="true"></span>โซเชียล / เว็บไซต์</div>
          <div class="form-subgrid">
            <div>
              <label for="fFb">Website · Facebook</label>
              <input id="fFb" value="${esc(d.facebookUrl)}" placeholder="https://facebook.com/...">
            </div>
            <div>
              <label for="fIg">Website · Instagram</label>
              <input id="fIg" value="${esc(d.instagramUrl)}" placeholder="https://instagram.com/...">
            </div>
          </div>
        </div>

        <div class="form-section full">
          <div class="form-section-title"><span class="form-section-mark" aria-hidden="true"></span>เจ้าของ / ผู้บริหาร</div>
          <div class="form-subgrid">
            <div>
              <label for="fOwner">ชื่อจริง</label>
              <input id="fOwner" value="${esc(d.ownerName)}">
            </div>
            <div>
              <label for="fOwnerNick">ชื่อเล่น</label>
              <input id="fOwnerNick" value="${esc(d.ownerNickname)}">
            </div>
            <div class="full">
              <label for="fOwnerPhone">เบอร์โทรติดต่อ</label>
              <input id="fOwnerPhone" value="${esc(d.ownerPhone)}" inputmode="tel">
            </div>
          </div>
        </div>

        <div class="form-section full">
          <div class="form-section-title"><span class="form-section-mark" aria-hidden="true"></span>ผู้ประสานงานหลัก</div>
          <div class="form-subgrid">
            <div>
              <label for="fContact">ชื่อจริง</label>
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
          </div>
        </div>

        <div class="form-section full">
          <div class="form-section-title"><span class="form-section-mark" aria-hidden="true"></span>หมายเหตุ</div>
          <div class="form-subgrid">
            <div class="full">
              <label for="fNotes" class="sr-only">หมายเหตุ</label>
              <textarea id="fNotes" rows="3" placeholder="รายละเอียดเพิ่มเติม">${esc(d.notes)}</textarea>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="surface panel glow-edge form-panel" id="form-sec-2">
      <div class="form-panel-head">
        <span class="form-panel-num" aria-hidden="true">02</span>
        <div class="form-panel-copy">
          <h2 class="form-step-title">ระบบที่ใช้กับ THANVASU</h2>
          <p class="form-panel-sub">กดการ์ดระบบเพื่อตั้งค่า Y / E / N</p>
        </div>
      </div>
      ${serviceEditorHtml(d.services)}
      <div class="form-block">
        <label for="fFlow">System Flow</label>
        <textarea id="fFlow" rows="4" placeholder="อธิบาย Flow ของระบบในร้าน">${esc(d.systemFlow)}</textarea>
      </div>
    </div>

    <div class="surface panel glow-edge form-panel" id="form-sec-3">
      <div class="form-panel-head">
        <span class="form-panel-num" aria-hidden="true">03</span>
        <div class="form-panel-copy">
          <h2 class="form-step-title">Hardware รวมทุกสาขา</h2>
          <p class="form-panel-sub">สรุปอัตโนมัติจากจำนวนที่กรอกในแต่ละสาขา</p>
        </div>
      </div>
      <div id="hwSummary">${hardwareSummaryHtml(aggregateHardwareFromBranches(d.branches))}</div>
      <div class="form-block">
        <label for="fHwOther">Hardware อื่น ๆ (หมายเหตุรวม)</label>
        <input id="fHwOther" value="${esc(d.hardwareOther)}" placeholder="ระบุอุปกรณ์อื่นและจำนวน — ถ้าต่างกันแต่ละสาขา ให้เขียนระบุชื่อสาขาด้วย">
      </div>
    </div>

    <div class="surface panel glow-edge form-panel" id="form-sec-4">
      <div class="form-panel-head">
        <span class="form-panel-num" aria-hidden="true">04</span>
        <div class="form-panel-copy">
          <h2 class="form-step-title">รูปภาพ</h2>
          <p class="form-panel-sub">โลโก้สูงสุด 2 รูป · หน้าร้านสูงสุด 5 รูป</p>
        </div>
      </div>
      ${imageGalleryHtml(d.images, d.pendingImages, editing)}
    </div>
    </section>

    <div class="surface sticky-actions glow-edge form-sticky">
      <div class="form-sticky-copy">
        <strong>${editing ? 'พร้อมบันทึกการแก้ไข' : 'พร้อมสร้างโปรไฟล์ใหม่'}</strong>
        <span>ตรวจชื่อร้าน แล้วกดบันทึกได้เลย</span>
      </div>
      <div class="form-sticky-actions">
        <button type="button" class="btn primary" id="btnSave">บันทึก</button>
        <button type="button" class="btn secondary" id="btnCancel">ยกเลิก</button>
      </div>
    </div>
  `, { title: editing ? 'แก้ไขร้าน' : 'เพิ่มร้าน' });

  $('#btnBack').onclick = () => { go(backTo); };
  $('#btnCancel').onclick = () => { go(backTo); };
  $('#fType').onchange = e => {
    $('#otherWrap').style.display = e.target.value === 'Other' ? 'block' : 'none';
  };
  bindStatusSeg();
  bindBranchEditor();
  bindDateEasy();
  $$('.form-step').forEach(a => {
    a.onclick = e => {
      e.preventDefault();
      const id = String(a.getAttribute('href') || '').replace(/^#/, '');
      const el = id ? document.getElementById(id) : null;
      $$('.form-step').forEach(x => x.classList.toggle('on', x === a));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });
  const stepSecs = ['form-sec-1', 'form-sec-2', 'form-sec-3', 'form-sec-4']
    .map(id => document.getElementById(id))
    .filter(Boolean);
  if (stepSecs.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      const visible = entries
        .filter(en => en.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      const id = visible.target.id;
      $$('.form-step').forEach(a => a.classList.toggle('on', a.dataset.sec === id));
    }, { rootMargin: '-20% 0px -55% 0px', threshold: [0.15, 0.35, 0.55] });
    stepSecs.forEach(el => io.observe(el));
  }
  $('#fName').focus();

  const refreshImages = async () => {
    const y = window.scrollY || 0;
    pullFormIntoDraft();
    await renderForm(editing, { keepGuard: true });
    requestAnimationFrame(() => window.scrollTo(0, y));
  };

  bindImageDropZones(refreshImages);
  // รอโหลดรูปให้จบ — กัน race ตอนโฟกัสฟอร์ม / สลับหน้า
  try { await hydrateProtectedImages(app); } catch (_) {}

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
      try {
        await api('/api/images/' + id, { method: 'DELETE' });
        state.draft.images = (state.draft.images || []).filter(x => Number(x.id) !== Number(id));
        await refreshImages();
      } catch (e) {
        toast(e.message, true);
      }
    };
  });

  $('#btnSave').onclick = async () => {
    $$('.date-easy').forEach(wrap => {
      const typed = $('.date-typed', wrap);
      if (!typed) return;
      const raw = typed.value.trim();
      if (!raw) {
        applyIsoToDateEasy(wrap, '');
        return;
      }
      const iso = parseTypedDate(raw);
      if (iso) applyIsoToDateEasy(wrap, iso);
    });
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
    if (!payload.startDate) {
      toast('กรุณากรอกวันเริ่มใช้ระบบ', true);
      const dateTyped = document.querySelector('.date-easy[data-date-id="fStart"] .date-typed');
      if (dateTyped) dateTyped.focus();
      else if ($('#fStart')) $('#fStart').focus();
      return;
    }
    const branchErr = validateBranchCountMatch(payload.branchCount, payload.branches);
    if (branchErr) {
      toast(branchErr, true);
      updateBranchMatchHint();
      const firstEmpty = $$('#branchList .br-name').find(inp => !String(inp.value || '').trim());
      if (firstEmpty) firstEmpty.focus();
      else if ($('#fBranchCount')) $('#fBranchCount').focus();
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
      clearFormGuard();
      go('#shop/' + r.shop.id);
    } catch (e) {
      toast(e.message, true);
      btn.disabled = false;
      btn.textContent = 'บันทึก';
    } finally {
      setBusy(false);
    }
  };

  if (!keepGuard) {
    armFormGuard(editing && state.current ? ('#edit/' + state.current.id) : '#new');
  }
}

async function renderDetail() {
  const s = state.current;
  const isAdmin = isAdminUser();
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
      <h2 class="form-step-title"><span class="form-step-mark" aria-hidden="true"></span>1. ข้อมูลลูกค้า</h2>
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
          ? branchesViewHtml(s.branches)
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
      <h2 class="form-step-title"><span class="form-step-mark" aria-hidden="true"></span>2. ระบบที่ใช้กับ THANVASU</h2>
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
      <h2 class="form-step-title"><span class="form-step-mark" aria-hidden="true"></span>3. Hardware รวมทุกสาขา</h2>
      ${hw.length ? `
        <div class="hw-view">
          ${hw.map(h => `<div class="hw-chip"><b>${esc(h.name)}</b> · รวม ${esc(h.qty)} เครื่อง</div>`).join('')}
        </div>
        <p class="field-hint" style="margin-top:8px">ดูรายละเอียดแต่ละสาขาได้ที่ส่วนชื่อสาขาด้านบน</p>` : '<p class="field-hint">ยังไม่ได้ระบุจำนวนเครื่อง</p>'}
      ${s.hardwareOther ? `<div class="fact" style="margin-top:12px"><label>Hardware อื่น ๆ</label><div class="value">${esc(s.hardwareOther)}</div></div>` : ''}
    </div>

    <div class="surface panel glow-edge">
      <h2 class="form-step-title"><span class="form-step-mark" aria-hidden="true"></span>4. รูปภาพ</h2>
      <div class="img-section img-section-view">
        <div class="img-block">
          <h3>โลโก้</h3>
          <div class="img-grid">
            ${logos.map(i => `<a class="img-card" href="${esc(i.url)}" target="_blank" rel="noopener"><img src="${esc(i.url)}" data-auth-src="${esc(i.url)}" alt=""><span class="img-ph" hidden>โหลดรูปไม่ได้</span></a>`).join('') || '<div class="img-empty">ไม่มีโลโก้</div>'}
          </div>
        </div>
        <div class="img-block">
          <h3>หน้าร้าน / บรรยากาศ</h3>
          <div class="img-grid">
            ${stores.map(i => `<a class="img-card" href="${esc(i.url)}" target="_blank" rel="noopener"><img src="${esc(i.url)}" data-auth-src="${esc(i.url)}" alt=""><span class="img-ph" hidden>โหลดรูปไม่ได้</span></a>`).join('') || '<div class="img-empty">ไม่มีรูป</div>'}
          </div>
        </div>
      </div>
    </div>
  `, { title: s.name });

  hydrateProtectedImages(app).catch(() => {});
  bindBranchBoard();
  $('#btnBack').onclick = () => go('#shops');
  $('#btnEdit').onclick = () => go('#edit/' + s.id);
  const del = $('#btnDel');
  if (del) {
    del.onclick = async () => {
      const ok = await confirmDialog({
        title: 'ลบร้านนี้?',
        message: 'ลบร้าน "' + s.name + '" ?\nการลบไม่สามารถย้อนกลับได้',
        okText: 'ลบร้าน',
        cancelText: 'ยกเลิก',
        danger: true,
      });
      if (!ok) return;
      try {
        setBusy(true, 'กำลังลบ…');
        await api('/api/shops/' + s.id, { method: 'DELETE' });
        state.shopsLoaded = false;
        state.meta = null;
        toast('ลบแล้ว');
        go('#shops');
      } catch (e) {
        toast(e.message, true);
      } finally {
        setBusy(false);
      }
    };
  }
}

async function renderBrandOverview() {
  await loadMeta();
  const types = (state.meta && state.meta.businessTypes) || [];
  const filter = state.overviewType || '';
  const chartMode = state.overviewChart === 'pie' ? 'pie' : 'bar';
  setBusy(true, 'กำลังโหลดภาพรวม…');
  let data;
  try {
    const q = filter ? ('?businessType=' + encodeURIComponent(filter)) : '';
    data = await api('/api/overview/brands' + q);
  } finally {
    setBusy(false);
  }

  const maxBrand = Math.max(1, ...(data.brandsByType || []).map(x => Number(x.count) || 0));
  const maxBranch = Math.max(1, ...(data.branchesByType || []).map(x => Number(x.count) || 0));
  const maxTopBranches = Math.max(1, ...(data.topBrands || []).map(b => Number(b.branches) || 0));
  const fmtN = (n) => Number(n || 0).toLocaleString('th-TH');
  const last = data.lastUpdated ? fmtDate(String(data.lastUpdated).slice(0, 10)) : '—';
  const PIE_COLORS = [
    ['#FF5A7A', '#DD0636'],
    ['#FFD84D', '#E6A800'],
    ['#60A5FA', '#2563EB'],
    ['#34D399', '#059669'],
    ['#C4B5FD', '#7C3AED'],
    ['#FB923C', '#EA580C'],
    ['#67E8F9', '#0891B2'],
    ['#F9A8D4', '#DB2777'],
    ['#9CA3AF', '#4B5563'],
    ['#FDE047', '#CA8A04'],
  ];

  const vBars = (rows, max) => {
    const list = rows || [];
    if (!list.length) return '<div class="ov-empty">ไม่มีข้อมูล</div>';
    const n = list.length;
    return `<div class="ov-vbars" data-n="${n}" style="--ov-n:${n}">${list.map((r, i) => {
      const pct = Math.max(6, Math.round((Number(r.count) || 0) / max * 100));
      return `
        <div class="ov-vbar-col" style="--i:${i}" title="${esc(bizLabel(r.businessType))}: ${fmtN(r.count)}">
          <div class="ov-vbar-val">${fmtN(r.count)}</div>
          <div class="ov-vbar-plot">
            <div class="ov-vbar-track" style="height:${pct}%"><span class="ov-vbar-fill"></span></div>
          </div>
          <div class="ov-vbar-label">${esc(bizLabel(r.businessType))}</div>
        </div>`;
    }).join('')}</div>`;
  };

  const pieChart = (rows) => {
    const list = (rows || []).filter(r => Number(r.count) > 0);
    if (!list.length) return '<div class="ov-empty">ไม่มีข้อมูล</div>';
    const total = list.reduce((n, r) => n + (Number(r.count) || 0), 0) || 1;
    const cx = 110;
    const cy = 110;
    const R = 86;
    const rInner = 52;
    const gap = list.length > 1 ? 0.035 : 0;
    let angle = -Math.PI / 2;
    const uid = 'pie' + Math.random().toString(36).slice(2, 8);

    const polar = (rad, a) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
    const arc = (rad, a0, a1) => {
      const [x0, y0] = polar(rad, a0);
      const [x1, y1] = polar(rad, a1);
      const large = (a1 - a0) > Math.PI ? 1 : 0;
      return { x0, y0, x1, y1, large };
    };

    const slices = list.map((r, i) => {
      const val = Number(r.count) || 0;
      const sweep = (val / total) * Math.PI * 2;
      const a0 = angle + gap / 2;
      const a1 = angle + sweep - gap / 2;
      angle += sweep;
      const pair = PIE_COLORS[i % PIE_COLORS.length];
      const pct = Math.round((val / total) * 100);
      let path;
      if (list.length === 1 || a1 <= a0) {
        path = [
          `M ${cx} ${cy - R}`,
          `A ${R} ${R} 0 1 1 ${cx - 0.01} ${cy - R}`,
          `L ${cx - 0.01} ${cy - rInner}`,
          `A ${rInner} ${rInner} 0 1 0 ${cx} ${cy - rInner}`,
          'Z',
        ].join(' ');
      } else {
        const o = arc(R, a0, a1);
        const inn = arc(rInner, a1, a0);
        path = [
          `M ${o.x0} ${o.y0}`,
          `A ${R} ${R} 0 ${o.large} 1 ${o.x1} ${o.y1}`,
          `L ${inn.x0} ${inn.y0}`,
          `A ${rInner} ${rInner} 0 ${o.large} 0 ${inn.x1} ${inn.y1}`,
          'Z',
        ].join(' ');
      }
      const mid = (a0 + a1) / 2;
      return {
        path,
        c0: pair[0],
        c1: pair[1],
        color: pair[1],
        label: bizLabel(r.businessType),
        count: val,
        pct,
        mid,
        i,
      };
    });

    return `
      <div class="ov-pie">
        <div class="ov-pie-visual">
          <div class="ov-pie-ring" aria-hidden="true"></div>
          <svg class="ov-pie-svg" viewBox="0 0 220 220" role="img" aria-label="Pie chart">
            <defs>
              <filter id="${uid}-soft" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="6" stdDeviation="5" flood-color="#b0052c" flood-opacity=".16"/>
              </filter>
              ${slices.map(s => `
                <linearGradient id="${uid}-g${s.i}" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="${s.c0}"/>
                  <stop offset="100%" stop-color="${s.c1}"/>
                </linearGradient>`).join('')}
            </defs>
            <circle class="ov-pie-plate" cx="110" cy="110" r="96" />
            <g class="ov-pie-slices" filter="url(#${uid}-soft)">
              ${slices.map(s => `
                <path class="ov-pie-slice" style="--i:${s.i}" d="${s.path}" fill="url(#${uid}-g${s.i})" data-label="${esc(s.label)}">
                  <title>${esc(s.label)}: ${fmtN(s.count)} (${s.pct}%)</title>
                </path>`).join('')}
            </g>
            <circle class="ov-pie-hole" cx="110" cy="110" r="${rInner - 1}" />
            <circle class="ov-pie-hole-ring" cx="110" cy="110" r="${rInner + 1}" />
            <text x="110" y="102" text-anchor="middle" class="ov-pie-total-label">รวมทั้งหมด</text>
            <text x="110" y="128" text-anchor="middle" class="ov-pie-total-val">${fmtN(total)}</text>
          </svg>
        </div>
        <ul class="ov-pie-legend">
          ${slices.map(s => `
            <li style="--i:${s.i}; --share:${Math.max(6, s.pct)}%; --c0:${s.c0}; --c1:${s.c1}" title="${esc(s.label)}: ${fmtN(s.count)} (${s.pct}%)">
              <span class="ov-pie-swatch" aria-hidden="true"></span>
              <span class="ov-pie-meta">
                <span class="ov-pie-name">${esc(s.label)}</span>
                <span class="ov-pie-bar" aria-hidden="true"><span class="ov-pie-bar-fill"></span></span>
              </span>
              <span class="ov-pie-pct">${s.pct}%</span>
              <span class="ov-pie-num">${fmtN(s.count)}</span>
            </li>`).join('')}
        </ul>
      </div>`;
  };

  const chartBody = (rows, max) => chartMode === 'pie' ? pieChart(rows) : vBars(rows, max);
  const chartCap = chartMode === 'pie' ? 'Donut Chart' : 'Bar Chart';
  const shopsN = fmtN(data.totalShops || 0);

  shell(`
    <section class="overview-board">
      <div class="ov-hero">
        <div class="ov-hero-copy">
          <p class="ov-kicker">THANVASU · Customer Profile</p>
          <h1 class="ov-title">Brand &amp; Branch Overview</h1>
          <p class="ov-sub">สรุป Brand / ประเภทธุรกิจ / สาขา — หนึ่งร้านสามารถมีได้หลายสาขา</p>
          <div class="ov-meta-row">
            <span class="ov-meta-chip"><strong>${shopsN}</strong> ร้านในระบบ</span>
            <span class="ov-meta-chip"><strong>${fmtN(data.totalBrands)}</strong> Brand</span>
            <span class="ov-meta-chip soft">อัปเดต ${esc(last)}</span>
          </div>
        </div>
        <div class="ov-head-actions">
          <div class="ov-chart-toggle" role="group" aria-label="ประเภทกราฟ">
            <button type="button" class="ov-toggle-btn ${chartMode === 'bar' ? 'on' : ''}" data-chart="bar">แท่ง</button>
            <button type="button" class="ov-toggle-btn ${chartMode === 'pie' ? 'on' : ''}" data-chart="pie">วงกลม</button>
          </div>
          <div class="ov-filter">
            <label class="sr-only" for="ovType">Business Type</label>
            <select id="ovType" class="ov-select">
              <option value="">ทุกประเภทธุรกิจ</option>
              ${types.map(t => `<option value="${esc(t.en)}" ${filter === t.en ? 'selected' : ''}>${esc(t.th)}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <div class="ov-kpis">
        <article class="ov-kpi" style="--i:0">
          <div class="ov-kpi-body">
            <div class="ov-kpi-label">Total Brands</div>
            <div class="ov-kpi-value">${fmtN(data.totalBrands)}</div>
            <div class="ov-kpi-hint">แบรนด์ทั้งหมดในระบบ</div>
          </div>
        </article>
        <article class="ov-kpi" style="--i:1">
          <div class="ov-kpi-body">
            <div class="ov-kpi-label">Total Branches</div>
            <div class="ov-kpi-value">${fmtN(data.totalBranches)}</div>
            <div class="ov-kpi-hint">สาขาที่นับจากรายชื่อจริง</div>
          </div>
        </article>
        <article class="ov-kpi" style="--i:2">
          <div class="ov-kpi-body">
            <div class="ov-kpi-label">Business Types</div>
            <div class="ov-kpi-value">${fmtN(data.totalBusinessTypes)}</div>
            <div class="ov-kpi-hint">ประเภทธุรกิจที่ใช้งาน</div>
          </div>
        </article>
      </div>

      <div class="ov-charts">
        <div class="ov-chart" style="--i:0">
          <div class="ov-chart-head">
            <h2 class="ov-chart-title">จำนวน Brand ตามประเภทธุรกิจ</h2>
            <span class="ov-chart-badge">${chartCap}</span>
          </div>
          ${chartBody(data.brandsByType, maxBrand)}
        </div>
        <div class="ov-chart" style="--i:1">
          <div class="ov-chart-head">
            <h2 class="ov-chart-title">จำนวนสาขา ตามประเภทธุรกิจ</h2>
            <span class="ov-chart-badge">${chartCap}</span>
          </div>
          ${chartBody(data.branchesByType, maxBranch)}
        </div>
      </div>

      <div class="ov-top" id="ovTop">
        <div class="ov-top-head">
          <h2 class="ov-top-title">Top 10 Brands</h2>
          <p class="ov-top-sub">เรียงตามจำนวนสาขาสูงสุด</p>
        </div>
        <ol class="ov-rank">
          ${(data.topBrands || []).map(b => {
            const branches = Number(b.branches) || 0;
            const share = Math.max(4, Math.round((branches / maxTopBranches) * 100));
            const topClass = b.rank <= 3 ? ' is-top' : '';
            const medal = b.rank === 1 ? ' gold' : b.rank === 2 ? ' silver' : b.rank === 3 ? ' bronze' : '';
            return `
            <li class="ov-rank-item${topClass}${medal}" data-id="${b.shopId || ''}" style="--i:${Math.max(0, (b.rank || 1) - 1)}; --share:${share}%">
              <span class="ov-rank-no">${String(b.rank).padStart(2, '0')}</span>
              <span class="ov-rank-logo">${b.logoUrl
                ? `<img src="${esc(b.logoUrl)}" data-auth-src="${esc(b.logoUrl)}" alt="${esc(b.brandName)}" loading="lazy"><span class="ov-logo-ph" hidden>LOGO</span>`
                : '<span class="ov-logo-ph">LOGO</span>'}</span>
              <span class="ov-rank-main">
                <span class="ov-rank-name">${esc(b.brandName)}</span>
                <span class="ov-rank-shop">${esc(bizLabel(b.businessType) || b.businessType || '')}${b.shopCount > 1 ? ' · ' + fmtN(b.shopCount) + ' ร้าน' : ''}</span>
                <span class="ov-rank-meter" aria-hidden="true"><span class="ov-rank-meter-fill"></span></span>
              </span>
              <span class="ov-rank-count"><strong>${fmtN(b.branches)}</strong><span>Branches</span></span>
            </li>`;
          }).join('') || '<li class="ov-empty">ยังไม่มีข้อมูล Brand</li>'}
        </ol>
      </div>
    </section>
  `, { title: 'ภาพรวม Brand' });

  const sel = $('#ovType');
  if (sel) {
    sel.onchange = () => {
      state.overviewType = sel.value || '';
      renderBrandOverview().catch(e => toast(e.message, true));
    };
  }
  $$('.ov-toggle-btn').forEach(btn => {
    btn.onclick = () => {
      const mode = btn.dataset.chart === 'pie' ? 'pie' : 'bar';
      if (state.overviewChart === mode) return;
      state.overviewChart = mode;
      renderBrandOverview().catch(e => toast(e.message, true));
    };
  });
  $$('.ov-rank-item[data-id]').forEach(li => {
    const id = li.dataset.id;
    if (!id) return;
    li.style.cursor = 'pointer';
    li.onclick = () => go('#shop/' + id);
  });
  hydrateProtectedImages(app).catch(() => {});
}

async function renderUsers() {
  setBusy(true, 'กำลังโหลดผู้ใช้…');
  try {
    try {
      const me = await api('/api/me');
      if (me && me.authed && me.user) state.user = me.user;
    } catch (_) {}
    const data = await api('/api/users');
    const users = data.users || [];
    const canMakeAdmin = isSuperAdminUser();
    const activeCount = users.filter(u => u.isActive).length;
    const adminCount = users.filter(u => u.role === 'Admin' || u.role === 'SuperAdmin').length;

    shell(`
      <section class="users-board">
        <header class="us-hero">
          <div class="us-hero-copy">
            <p class="us-kicker">ผู้ดูแลระบบ</p>
            <h1 class="us-title">ผู้ใช้ระบบ</h1>
            <p class="us-sub">สร้างบัญชีให้ทีม · จัดการสิทธิ์และสถานะการใช้งาน</p>
          </div>
          <div class="us-hero-stats" aria-label="สรุปผู้ใช้">
            <div class="us-stat">
              <span class="us-stat-val">${users.length.toLocaleString('th-TH')}</span>
              <span class="us-stat-lab">บัญชีทั้งหมด</span>
            </div>
            <div class="us-stat">
              <span class="us-stat-val">${activeCount.toLocaleString('th-TH')}</span>
              <span class="us-stat-lab">เปิดใช้</span>
            </div>
            <div class="us-stat soft">
              <span class="us-stat-val">${adminCount.toLocaleString('th-TH')}</span>
              <span class="us-stat-lab">ผู้ดูแล+</span>
            </div>
          </div>
        </header>

        <div class="us-layout">
          <div class="surface glow-edge us-create">
            <div class="us-card-head">
              <span class="us-card-num" aria-hidden="true">+</span>
              <div>
                <h2 class="us-card-title">เพิ่มผู้ใช้ใหม่</h2>
                <p class="us-card-sub">${canMakeAdmin
                  ? 'เลือกสิทธิ์ได้ทั้งผู้ใช้งานและผู้ดูแลระบบ'
                  : 'สร้างบัญชีผู้ใช้งาน — สิทธิ์ผู้ดูแลสร้างได้เฉพาะ Super Admin'}</p>
              </div>
            </div>
            <div class="us-form-grid">
              <div>
                <label for="uName">ชื่อผู้ใช้ *</label>
                <input id="uName" autocomplete="off" placeholder="เช่น somchai">
              </div>
              <div>
                <label for="uRole">สิทธิ์</label>
                <select id="uRole">
                  <option value="User">ผู้ใช้งาน — ดู / แก้ไขร้าน</option>
                  ${canMakeAdmin ? '<option value="Admin">ผู้ดูแลระบบ — จัดการผู้ใช้ / ประวัติ</option>' : ''}
                </select>
              </div>
              <div>
                <label for="uPass">รหัสผ่าน *</label>
                <input id="uPass" type="password" autocomplete="new-password" placeholder="อย่างน้อย 6 ตัวอักษร">
              </div>
              <div>
                <label for="uPass2">ยืนยันรหัสผ่าน *</label>
                <input id="uPass2" type="password" autocomplete="new-password" placeholder="พิมพ์ซ้ำอีกครั้ง">
              </div>
            </div>
            <div class="us-create-actions">
              <button type="button" class="btn primary" id="btnCreateUser">เพิ่มผู้ใช้</button>
            </div>
          </div>

          <div class="surface panel glow-edge us-list">
            <div class="us-card-head">
              <span class="us-card-num soft" aria-hidden="true">${String(users.length).padStart(2, '0')}</span>
              <div>
                <h2 class="us-card-title">บัญชีทั้งหมด</h2>
                <p class="us-card-sub">เปิด/ปิดการใช้งานได้จากคอลัมน์ขวาสุด</p>
              </div>
            </div>
            <div class="table-wrap us-table" style="max-height:none">
              <table class="data">
                <thead>
                  <tr>
                    <th>ชื่อผู้ใช้</th>
                    <th>สิทธิ์</th>
                    <th>สถานะ</th>
                    <th>สร้างเมื่อ</th>
                    <th class="us-col-act">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  ${users.map(u => {
                    const isSelf = Number(u.id) === Number(state.user.id);
                    const isSA = u.role === 'SuperAdmin';
                    const canToggle = !isSelf && !isSA && (u.role !== 'Admin' || canMakeAdmin);
                    return `
                    <tr data-uid="${u.id}" class="${isSA ? 'us-row-sa' : ''}">
                      <td>
                        <div class="us-user-cell">
                          <b>${esc(u.username)}</b>
                          ${isSA ? '<span class="chip y">หลัก</span>' : ''}
                          ${isSelf ? '<span class="chip soft">คุณ</span>' : ''}
                        </div>
                      </td>
                      <td><span class="badge ${isSA ? 'super' : ''}">${esc(roleLabel(u.role))}</span></td>
                      <td>${u.isActive ? '<span class="chip y">เปิดใช้</span>' : '<span class="chip n">ปิด</span>'}</td>
                      <td class="nowrap">${esc(fmtWhen(u.createdAt))}</td>
                      <td class="us-col-act">
                        ${canToggle ? `
                          <button type="button" class="btn ghost sm btn-toggle-user" data-id="${u.id}" data-active="${u.isActive ? '0' : '1'}">
                            ${u.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                          </button>` : '<span class="muted-note">—</span>'}
                      </td>
                    </tr>`;
                  }).join('') || '<tr><td colspan="5">ยังไม่มีผู้ใช้</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
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
      <div class="login-aurora a1"></div>
      <div class="login-aurora a2"></div>
      <div class="login-aurora a3"></div>
      <div class="login-grain"></div>
      <div class="login-grid-fx"></div>
      <div class="login-orb o1" data-parallax="0.028"></div>
      <div class="login-orb o2" data-parallax="-0.035"></div>
      <div class="login-orb o3" data-parallax="0.022"></div>
      <div class="login-orb o4" data-parallax="-0.018"></div>
      <span class="login-spark s1"></span>
      <span class="login-spark s2"></span>
      <span class="login-spark s3"></span>
      <span class="login-spark s4"></span>
      <span class="login-spark s5"></span>
      <div class="login-spotlight" id="loginSpot"></div>
    </div>
    <div class="login-frame" id="loginFrame">
      <div class="login-stage">
        <aside class="login-hero">
          <div class="login-hero-sheen" aria-hidden="true"></div>
          <div class="login-mark" aria-hidden="true">CS</div>
          <div class="login-hero-top">
            <div class="login-logo-ring">
              <span class="login-orbit" aria-hidden="true"></span>
              <img class="brand-logo login" src="/assets/thanvasu-logo.png" alt="THANVASU">
            </div>
          </div>
          <div class="login-hero-copy">
            <p class="login-kicker"><span>THANVASU</span><span class="login-dot">·</span><span>BCS</span></p>
            <h1><span class="login-title-line">CS System</span></h1>
            <div class="login-gold-line" aria-hidden="true"></div>
            <p class="login-tag">คอนโซลโปรไฟล์ลูกค้าภายใน — ดูร้าน ระบบที่ใช้งาน และสถานะซัพพอร์ตได้ในที่เดียว</p>
          </div>
          <div class="login-hero-meta">
            <span class="login-badge"><i aria-hidden="true"></i> Internal use only</span>
          </div>
        </aside>
        <div class="login-panel">
          <form class="login-card" id="loginForm">
            <div class="login-card-glow" aria-hidden="true"></div>
            <p class="login-card-kicker">Secure access</p>
            <h2 class="form-title">ยินดีต้อนรับกลับ</h2>
            <p class="sub">เข้าสู่ระบบด้วยบัญชีพนักงาน THANVASU</p>
            <div class="err" id="loginErr" style="${err ? 'display:block' : ''}">${esc(err || '')}</div>
            <div class="fields">
              <div class="login-field">
                <label for="usr">ชื่อผู้ใช้</label>
                <div class="login-input-shell">
                  <input id="usr" autocomplete="username" autofocus placeholder="username">
                </div>
              </div>
              <div class="login-field">
                <label for="pw">รหัสผ่าน</label>
                <div class="login-input-shell pw-wrap">
                  <input id="pw" type="password" autocomplete="current-password" placeholder="••••••••">
                  <button type="button" class="pw-toggle" id="btnTogglePw" aria-label="แสดงรหัสผ่าน">แสดง</button>
                </div>
              </div>
              <button class="btn-login" type="submit" id="btnLogin">
                <span class="btn-login-label">เข้าสู่ระบบ</span>
                <span class="btn-ico" aria-hidden="true">→</span>
              </button>
            </div>
          </form>
          <p class="login-foot">© ${year} <strong>THANVASU</strong> Business Consulting System · สำหรับเจ้าหน้าที่ภายใน</p>
        </div>
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

  bindLoginFx();

  $('#loginForm').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#btnLogin');
    const errEl = $('#loginErr');
    errEl.style.display = 'none';
    try {
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-login-label">กำลังเข้าสู่ระบบ…</span>';
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
      go('#overview'); // หน้าภาพรวมหลังล็อกอิน
    } catch (ex) {
      errEl.style.display = 'block';
      errEl.textContent = ex.message || 'เข้าสู่ระบบไม่สำเร็จ';
      btn.disabled = false;
      btn.innerHTML = '<span class="btn-login-label">เข้าสู่ระบบ</span><span class="btn-ico" aria-hidden="true">→</span>';
      const card = document.querySelector('.login-card');
      if (card) {
        card.classList.remove('login-card-shake');
        void card.offsetWidth;
        card.classList.add('login-card-shake');
      }
      $('#pw').focus();
    }
  };
}

function bindLoginFx() {
  const stage = $('#loginStage');
  if (!stage) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const frame = $('#loginFrame');
  const spot = $('#loginSpot');
  const card = document.querySelector('.login-card');

  $$('.login-input-shell input').forEach(inp => {
    const shell = inp.closest('.login-input-shell');
    const sync = () => shell && shell.classList.toggle('is-filled', !!inp.value);
    inp.addEventListener('focus', () => shell && shell.classList.add('is-focus'));
    inp.addEventListener('blur', () => shell && shell.classList.remove('is-focus'));
    inp.addEventListener('input', sync);
    sync();
  });

  if (reduce) return;

  stage.onpointermove = (e) => {
    const r = stage.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width;
    const ny = (e.clientY - r.top) / r.height;
    const x = nx - 0.5;
    const y = ny - 0.5;
    stage.style.setProperty('--lx', (nx * 100) + '%');
    stage.style.setProperty('--ly', (ny * 100) + '%');
    if (spot) {
      spot.style.left = (nx * 100) + '%';
      spot.style.top = (ny * 100) + '%';
    }
    $$('[data-parallax]', stage).forEach(el => {
      const f = Number(el.dataset.parallax || 0);
      el.style.setProperty('--tx', (x * f * 280) + 'px');
      el.style.setProperty('--ty', (y * f * 280) + 'px');
    });
    if (frame) {
      frame.style.setProperty('--rx', (-y * 4.5) + 'deg');
      frame.style.setProperty('--ry', (x * 6) + 'deg');
    }
    if (card) {
      card.style.setProperty('--gx', (nx * 100) + '%');
      card.style.setProperty('--gy', (ny * 100) + '%');
    }
  };
  stage.onpointerleave = () => {
    if (frame) {
      frame.style.setProperty('--rx', '0deg');
      frame.style.setProperty('--ry', '0deg');
    }
  };

  const loginBtn = $('#btnLogin');
  if (loginBtn) {
    loginBtn.onpointermove = (e) => {
      const r = loginBtn.getBoundingClientRect();
      loginBtn.style.setProperty('--mx', ((e.clientX - r.left) / r.width) * 100 + '%');
      loginBtn.style.setProperty('--my', ((e.clientY - r.top) / r.height) * 100 + '%');
    };
    loginBtn.onpointerleave = () => {
      loginBtn.style.removeProperty('--mx');
      loginBtn.style.removeProperty('--my');
    };
  }
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
    if (h === '' || h === '#' || h === '#overview') { await renderBrandOverview(); return; }
    if (h === '#shops') { await renderList(); return; }
    if (h === '#reports') { go('#overview'); return; }
    if (h === '#new') {
      state.current = null;
      state.draft = emptyDraft(state.meta.services, state.meta.hardware);
      await renderForm(false);
      return;
    }
    if (h === '#users') {
      if (!isAdminUser()) {
        toast('สำหรับผู้ดูแลระบบเท่านั้น', true);
        go('#overview');
        return;
      }
      await renderUsers();
      return;
    }
    if (h === '#logs') {
      if (!isAdminUser()) {
        toast('สำหรับผู้ดูแลระบบเท่านั้น', true);
        go('#overview');
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
    location.hash = '#overview';
  } catch (e) {
    if (seq !== routeSeq) return;
    toast(e.message, true);
    if (!state.user) renderLogin(e.message);
    else if (h.startsWith('#shop/') || h.startsWith('#edit/')) go('#shops');
  }
}

window.addEventListener('hashchange', async () => {
  if (hashGuardLock) return;
  const next = location.hash || '';
  // browser back/forward หรือลิงก์นอก go() — ถ้าฟอร์มยังสกปรก ให้ถามก่อน
  if (formGuardHash && next !== formGuardHash) {
    const intended = next;
    const stay = formGuardHash;
    hashGuardLock = true;
    location.hash = stay;
    try {
      const ok = await allowLeaveForm(intended);
      if (ok) {
        hashGuardLock = false;
        location.hash = intended;
        return;
      }
    } catch (e) {
      toast(e.message || 'เกิดข้อผิดพลาด', true);
    }
    hashGuardLock = false;
    return;
  }
  route().catch(e => toast(e.message, true));
});

window.addEventListener('beforeunload', (e) => {
  if (!formGuardHash || !isFormDirty()) return;
  e.preventDefault();
  e.returnValue = '';
});

route().catch(e => { renderLogin(e.message); });
