'use strict';
/* Customer Profile Database — zero-dependency Node.js server
 * Password-protected CRUD + image uploads, data in data/db.json
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./db');   // SQL Server data layer (Windows Auth)

const envPort = Number(process.env.APP_PORT || process.env.PORT || 0);
const PORT = envPort > 0 ? envPort : 3210;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SESSION_TTL = 1000 * 60 * 60 * 12; // 12 hours
const MAX_BODY = 15 * 1024 * 1024; // 15 MB (covers image uploads)

const PASSWORD = process.env.APP_PASSWORD || 'thanvasu2026';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------------- DB helpers ---------------- */
// Data now lives in SQL Server (CustomerProfileDB.dbo.Customers) — see db.js
// Legacy JSON store (data/db.json) is only used by the one-time migration script.
async function loadCustomer(id) { return store.getCustomer(id); }

/* ---------------- sessions ---------------- */
const sessions = new Map(); // token -> expiresAt
function createToken() {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL);
  return token;
}
function checkToken(token) {
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (Date.now() > exp) { sessions.delete(token); return false; }
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [t, exp] of sessions) if (now > exp) sessions.delete(t);
}, 10 * 60 * 1000).unref();

/* ---------------- helpers ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};
function send(res, code, body, headers) {
  const h = Object.assign({ 'Cache-Control': 'no-store' }, headers || {});
  if (typeof body === 'string' && !h['Content-Type']) h['Content-Type'] = 'text/html; charset=utf-8';
  res.writeHead(code, h);
  res.end(body);
}
function json(res, code, obj) { send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' }); }

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('BODY_TOO_LARGE')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* Multipart parser (handles file parts named "files") */
function parseMultipart(buf, boundary) {
  const parts = [];
  const b = Buffer.from('--' + boundary);
  let idx = buf.indexOf(b);
  while (idx !== -1) {
    const start = idx + b.length;
    if (buf.slice(start, start + 2).toString() === '--') break; // final
    const headEnd = buf.indexOf('\r\n\r\n', start);
    if (headEnd === -1) break;
    const head = buf.slice(start + 2, headEnd).toString('utf8');
    const next = buf.indexOf(b, headEnd);
    if (next === -1) break;
    const body = buf.slice(headEnd + 4, next - 2); // strip trailing \r\n
    const disp = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(head);
    const nameM = /name="([^"]*)"/i.exec(disp ? disp[1] : '');
    const fileM = /filename="([^"]*)"/i.exec(disp ? disp[1] : '');
    const ct = /content-type:\s*([^\r\n;]+)/i.exec(head);
    parts.push({
      name: nameM ? nameM[1] : '',
      filename: fileM ? fileM[1] : undefined,
      contentType: ct ? ct[1].trim() : undefined,
      data: body,
    });
    idx = next;
  }
  return parts;
}

function sanitizeFiles(rawFiles, existing) {
  // rawFiles: [{filename, contentType, data(Buffer)}]
  const kept = Array.isArray(existing) ? existing.filter(f => f && f.id) : [];
  const saved = [];
  const IMG_RE = /^image\/(png|jpe?g|gif|webp)$/i;
  for (const f of rawFiles) {
    if (!f.filename || !f.data || !f.data.length) continue;
    if (!IMG_RE.test(f.contentType || '')) continue; // images only
    if (f.data.length > 8 * 1024 * 1024) continue;  // 8 MB per image
    const ext = (f.contentType.match(IMG_RE) || [])[1] || 'png';
    const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const name = id + '.' + ext.toLowerCase().replace('jpeg', 'jpg');
    fs.writeFileSync(path.join(UPLOAD_DIR, name), f.data);
    saved.push({ id, file: name, name: f.filename.slice(0, 120), size: f.data.length, mime: f.contentType, uploadedAt: new Date().toISOString() });
  }
  return { kept, saved };
}

/* ---------------- normalization ---------------- */
const BUSINESS_TYPES = [
  { en: 'Restaurant', th: 'ร้านอาหาร' },
  { en: 'Café / Coffee Shop', th: 'คาเฟ่ / ร้านกาแฟ' },
  { en: 'Bar / Pub', th: 'บาร์ / ผับ' },
  { en: 'Bakery / Dessert Shop', th: 'ร้านเบเกอรี่ / ร้านขนม' },
  { en: 'Fast Food / Quick Service Restaurant (QSR)', th: 'ร้านอาหารจานด่วน' },
  { en: 'Food Court / Food Stall', th: 'ศูนย์อาหาร / ร้านอาหารแบบคีออส' },
  { en: 'Retail Store', th: 'ร้านค้าปลีก' },
  { en: 'Convenience Store', th: 'ร้านสะดวกซื้อ' },
  { en: 'Supermarket / Grocery Store', th: 'ซูเปอร์มาร์เก็ต / ร้านขายของชำ' },
  { en: 'Fashion / Apparel Store', th: 'ร้านเสื้อผ้า / แฟชั่น' },
  { en: 'Beauty / Cosmetics Store', th: 'ร้านเครื่องสำอาง' },
  { en: 'Salon / Spa', th: 'ร้านเสริมสวย / สปา' },
  { en: 'Pharmacy', th: 'ร้านขายยา' },
  { en: 'Hotel / Resort', th: 'โรงแรม / รีสอร์ต' },
  { en: 'Franchise', th: 'ธุรกิจแฟรนไชส์' },
  { en: 'Wholesale', th: 'ธุรกิจค้าส่ง' },
  { en: 'Service Business', th: 'ธุรกิจบริการ' },
  { en: 'Other', th: 'อื่น ๆ' },
];

const SYSTEM_OPTIONS = [
  'App POS', 'App KDS', 'App Kiosk', 'Web CRM',
  'App Cashier Ordering', 'App Staff Ordering',
  'Web Self Ordering (Order Only)', 'Web Self Ordering (Pay First)',
  'Web Self Ordering (Pay Later)', 'Web Self Ordering (Pick Up)',
  'Web Booking', 'Web QTV', 'Web BI Dashboard', 'Web Report',
  'ERP (KNAP / Others)', 'Payment API (KBank / BBL / Others)',
];

const HARDWARE_ITEMS = [
  'POS', 'Kiosk', 'Printer', 'Kitchen Printer', 'Customer Display',
  'KDS Screen', 'Cash Drawer', 'Barcode Scanner', 'Handheld Scanner',
];

function str(v) { return typeof v === 'string' ? v.trim() : ''; }
function normalizeBody(b) {
  const out = {};
  out.shopNameTh = str(b.shopNameTh);
  out.shopNameEn = str(b.shopNameEn);
  out.companyNameTh = str(b.companyNameTh);
  out.companyNameEn = str(b.companyNameEn);
  out.businessType = str(b.businessType);
  out.businessTypeOther = str(b.businessTypeOther);
  out.branchCount = str(b.branchCount);
  out.branches = Array.isArray(b.branches) ? b.branches.map(str).filter(Boolean).slice(0, 50) : [];
  out.website = str(b.website);
  out.ownerName = str(b.ownerName);
  out.ownerNickname = str(b.ownerNickname);
  out.ownerPhone = str(b.ownerPhone);
  out.coordinatorName = str(b.coordinatorName);
  out.coordinatorNickname = str(b.coordinatorNickname);
  out.coordinatorPhone = str(b.coordinatorPhone);
  out.contactEmail = str(b.contactEmail);
  out.startDate = str(b.startDate);
  out.systems = Array.isArray(b.systems) ? b.systems.filter(s => SYSTEM_OPTIONS.includes(s)) : [];
  out.otherSystemApi = str(b.otherSystemApi);
  out.systemFlow = str(b.systemFlow);
  out.hardware = {};
  for (const h of HARDWARE_ITEMS) {
    const v = b.hardware && b.hardware[h];
    out.hardware[h] = Number.isFinite(Number(v)) && v !== '' && v !== null ? Math.max(0, Math.floor(Number(v))) : null;
  }
  out.otherHardware = str(b.otherHardware);
  out.logo = Array.isArray(b.logo) ? b.logo.filter(f => f && f.id) : [];
  out.storefront = Array.isArray(b.storefront) ? b.storefront.filter(f => f && f.id) : [];
  out.updatedAt = new Date().toISOString();
  return out;
}

function customerPublic(c) {
  const img = (list, i) => (list && list[i] ? '/files/' + list[i].file : null);
  return {
    id: c.id, code: c.code, createdAt: c.createdAt, updatedAt: c.updatedAt,
    shopNameTh: c.shopNameTh, shopNameEn: c.shopNameEn,
    companyNameTh: c.companyNameTh, companyNameEn: c.companyNameEn,
    businessType: c.businessType, businessTypeOther: c.businessTypeOther,
    branchCount: c.branchCount, branches: c.branches, website: c.website,
    ownerName: c.ownerName, ownerNickname: c.ownerNickname, ownerPhone: c.ownerPhone,
    coordinatorName: c.coordinatorName, coordinatorNickname: c.coordinatorNickname,
    coordinatorPhone: c.coordinatorPhone, contactEmail: c.contactEmail, startDate: c.startDate,
    systems: c.systems || [], otherSystemApi: c.otherSystemApi || '', systemFlow: c.systemFlow || '',
    hardware: c.hardware || {}, otherHardware: c.otherHardware || '',
    logo: c.logo || [], storefront: c.storefront || [],
    logoUrl: img(c.logo, 0),
    storefrontUrls: (c.storefront || []).map(f => '/files/' + f.file),
  };
}

/* ---------------- router ---------------- */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    const cookies = parseCookies(req);
    const token = cookies.cpb_session || '';

    // static files (public)
    if (req.method === 'GET' && (p === '/' || p === '/login' || p.startsWith('/assets/'))) {
      if (p === '/' || p === '/login') { send(res, 200, fs.readFileSync(path.join(ROOT, 'public', 'index.html')), { 'Content-Type': MIME['.html'] }); return; }
      const file = path.normalize(path.join(ROOT, 'public', p));
      if (!file.startsWith(path.join(ROOT, 'public'))) { send(res, 403, 'Forbidden'); return; }
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        return;
      }
      send(res, 404, 'Not found'); return;
    }

    // uploaded files (protected)
    if (req.method === 'GET' && p.startsWith('/files/')) {
      if (!checkToken(token)) { json(res, 401, { error: 'unauthorized' }); return; }
      const name = path.basename(p.slice('/files/'.length));
      const file = path.join(UPLOAD_DIR, name);
      if (fs.existsSync(file)) {
        send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'private, max-age=3600' });
      } else json(res, 404, { error: 'not found' });
      return;
    }

    // API
    if (p === '/api/login' && req.method === 'POST') {
      const body = await readBody(req);
      let pw = '';
      try { pw = (JSON.parse(body.toString('utf8')) || {}).password || ''; } catch (e) {}
      if (pw && pw === PASSWORD) {
        const t = createToken();
        res.setHeader('Set-Cookie', 'cpb_session=' + t + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200');
        json(res, 200, { ok: true });
      } else {
        setTimeout(() => json(res, 401, { error: 'รหัสผ่านไม่ถูกต้อง' }), 400);
      }
      return;
    }

    if (p === '/api/logout' && req.method === 'POST') {
      sessions.delete(token);
      res.setHeader('Set-Cookie', 'cpb_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
      json(res, 200, { ok: true });
      return;
    }

    if (p === '/api/me' && req.method === 'GET') {
      json(res, checkToken(token) ? 200 : 401, { authed: checkToken(token) });
      return;
    }

    // everything below requires auth
    if (!checkToken(token)) { json(res, 401, { error: 'unauthorized' }); return; }

    if (p === '/api/meta' && req.method === 'GET') {
      json(res, 200, { businessTypes: BUSINESS_TYPES, systems: SYSTEM_OPTIONS, hardware: HARDWARE_ITEMS });
      return;
    }

    if (p === '/api/customers' && req.method === 'GET') {
      const all = await store.listCustomers();
      json(res, 200, { customers: all.map(customerPublic) });
      return;
    }

    if (p === '/api/customers' && req.method === 'POST') {
      const raw = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const c = normalizeBody(raw);
      if (!c.shopNameTh && !c.shopNameEn) { json(res, 400, { error: 'กรุณากรอกชื่อร้านอย่างน้อยหนึ่งภาษา' }); return; }
      c.id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      c.code = await store.nextCode();
      c.createdAt = new Date().toISOString();
      c.updatedAt = c.createdAt;
      await store.insertCustomer(c);
      json(res, 201, { customer: customerPublic(c) });
      return;
    }

    let m;
    if ((m = p.match(/^\/api\/customers\/([^/]+)$/))) {
      const id = m[1];
      const cur = await store.getCustomer(id);
      if (!cur) { json(res, 404, { error: 'not found' }); return; }
      if (req.method === 'GET') { json(res, 200, { customer: customerPublic(cur) }); return; }
      if (req.method === 'PUT') {
        const raw = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        const upd = normalizeBody(raw);
        if (!upd.shopNameTh && !upd.shopNameEn) { json(res, 400, { error: 'กรุณากรอกชื่อร้านอย่างน้อยหนึ่งภาษา' }); return; }
        // merge: keep existing images unless client explicitly sends file lists
        if (Array.isArray(raw.logo)) cur.logo = upd.logo;
        if (Array.isArray(raw.storefront)) cur.storefront = upd.storefront;
        const keep = ['id', 'code', 'createdAt'];
        for (const k of Object.keys(upd)) if (!keep.includes(k)) cur[k] = upd[k];
        await store.updateCustomer(id, cur);
        json(res, 200, { customer: customerPublic(cur) });
        return;
      }
      if (req.method === 'DELETE') {
        for (const f of [].concat(cur.logo || [], cur.storefront || [])) {
          try { fs.unlinkSync(path.join(UPLOAD_DIR, f.file)); } catch (e) {}
        }
        await store.deleteCustomer(id);
        json(res, 200, { ok: true });
        return;
      }
    }

    if (p === '/api/upload' && req.method === 'POST') {
      const ctype = req.headers['content-type'] || '';
      const bm = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype);
      if (!bm) { json(res, 400, { error: 'multipart required' }); return; }
      const boundary = (bm[1] || bm[2]).trim();
      const buf = await readBody(req);
      const parts = parseMultipart(buf, boundary);
      const kind = String((parts.find(x => x.name === 'kind') || {}).data || '').trim();
      const field = kind === 'storefront' ? 'storefront' : 'logo';
      const files = parts.filter(x => x.name === 'files' && x.filename);
      if (!files.length) { json(res, 400, { error: 'no files' }); return; }
      // find target customer (client passes id) — text parts arrive as Buffers
      const cid = String((parts.find(x => x.name === 'customerId') || {}).data || '').trim();
      const cur = await store.getCustomer(cid);
      const { kept, saved } = sanitizeFiles(files, cur ? cur[field] : []);
      if (cur) {
        cur[field] = kept.concat(saved).slice(0, field === 'logo' ? 2 : 5);
        await store.updateCustomer(cid, cur);
      }
      json(res, 200, { saved, kept });
      return;
    }

    json(res, 404, { error: 'not found' });
  } catch (e) {
    if (e && e.message === 'BODY_TOO_LARGE') { json(res, 413, { error: 'ไฟล์ใหญ่เกิน 15MB' }); return; }
    if (e instanceof SyntaxError) { json(res, 400, { error: 'invalid json' }); return; }
    console.error(e);
    json(res, 500, { error: 'server error' });
  }
});

server.listen(PORT, () => {
  console.log('Customer Profile Database running at http://localhost:' + PORT);
  console.log('Password: ' + (process.env.APP_PASSWORD ? '(from APP_PASSWORD env)' : 'thanvasu2026 (default)'));
});
