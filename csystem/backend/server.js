'use strict';
const http = require('http');
const crypto = require('crypto');
const store = require('./db');

const PORT = Number(process.env.APP_PORT || 3220) || 3220;
const SESSION_TTL = 12 * 60 * 60 * 1000;
const sessions = new Map();

function send(res, code, body, headers) {
  const h = Object.assign({ 'Cache-Control': 'no-store' }, headers || {});
  res.writeHead(code, h);
  res.end(body);
}
function json(res, code, obj) {
  send(res, code, JSON.stringify(obj, (_k, v) => typeof v === 'bigint' ? Number(v) : v), {
    'Content-Type': 'application/json; charset=utf-8',
  });
}
function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function readBody(req, maxBytes) {
  const limit = maxBytes || 2 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('BODY_TOO_LARGE')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
}
function sessionCookie(token, maxAge) {
  // เปิด Secure เมื่ออยู่หลัง HTTPS (Coolify) — ตั้ง COOKIE_SECURE=1
  const secure = process.env.COOKIE_SECURE === '1';
  return 'cs_session=' + encodeURIComponent(token)
    + '; Path=/; HttpOnly; SameSite=Lax'
    + (secure ? '; Secure' : '')
    + '; Max-Age=' + maxAge;
}
function createSession(user) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { userId: user.id, username: user.username, role: user.role, exp: Date.now() + SESSION_TTL });
  return token;
}
function getSession(req) {
  const token = parseCookies(req).cs_session;
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.exp) { sessions.delete(token); return null; }
  return Object.assign({ token }, s);
}
function requireAuth(req, res) {
  const s = getSession(req);
  if (!s) { json(res, 401, { error: 'กรุณาเข้าสู่ระบบ' }); return null; }
  return s;
}
function requireAdmin(req, res) {
  const s = requireAuth(req, res);
  if (!s) return null;
  if (s.role !== 'Admin') { json(res, 403, { error: 'สำหรับผู้ดูแลระบบเท่านั้น' }); return null; }
  return s;
}

setInterval(() => {
  const now = Date.now();
  for (const [t, s] of sessions) if (now > s.exp) sessions.delete(t);
}, 10 * 60 * 1000).unref();

function shopBodyFromJson(body) {
  return {
    name: String(body.name || '').trim(),
    startDate: body.startDate || null,
    businessType: body.businessType || '',
    businessTypeOther: body.businessTypeOther || '',
    dataSource: body.dataSource || '',
    notes: body.notes || '',
    brandName: body.brandName || '',
    companyNameTh: body.companyNameTh || '',
    companyNameEn: body.companyNameEn || '',
    branchCount: body.branchCount,
    branches: body.branches,
    branchNames: body.branchNames,
    branchNamesText: body.branchNamesText,
    websiteSocial: body.websiteSocial || '',
    facebookUrl: body.facebookUrl || '',
    instagramUrl: body.instagramUrl || '',
    ownerName: body.ownerName || '',
    ownerNickname: body.ownerNickname || '',
    ownerPhone: body.ownerPhone || '',
    contactName: body.contactName || '',
    contactNickname: body.contactNickname || '',
    contactPhone: body.contactPhone || '',
    contactEmail: body.contactEmail || '',
    contactLine: body.contactLine || '',
    contactOther: body.contactOther || '',
    systemFlow: body.systemFlow || '',
    hardwareOther: body.hardwareOther || '',
    hardware: body.hardware || [],
    services: body.services || [],
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (p === '/api/health' && req.method === 'GET') {
      json(res, 200, { ok: true, service: 'csystem-backend' });
      return;
    }

    if (p === '/api/change-password' && req.method === 'POST') {
      const s = requireAuth(req, res); if (!s) return;
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const currentPassword = String(body.currentPassword || '');
      const password = String(body.password || '');
      const password2 = String(body.password2 || '');
      if (password.length < 6) { json(res, 400, { error: 'รหัสผ่านใหม่อย่างน้อย 6 ตัวอักษร' }); return; }
      if (password !== password2) { json(res, 400, { error: 'รหัสผ่านยืนยันไม่ตรงกัน' }); return; }
      try {
        await store.changePassword(s.userId, currentPassword, password);
        json(res, 200, { ok: true, message: 'เปลี่ยนรหัสผ่านแล้ว' });
      } catch (e) {
        json(res, 400, { error: e.message || 'เปลี่ยนรหัสผ่านไม่สำเร็จ' });
      }
      return;
    }

    if (p === '/api/login' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const user = await store.findUserByUsername(username);
      const ok = user && user.is_active && store.verifyPassword(password, user.password_hash);
      await store.logLogin({ userId: user && user.id, username, success: !!ok, ip: clientIp(req) });
      if (!ok) { json(res, 401, { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }); return; }
      const token = createSession(user);
      res.setHeader('Set-Cookie', sessionCookie(token, 43200));
      json(res, 200, { ok: true, user: { id: user.id, username: user.username, role: user.role } });
      return;
    }

    if (p === '/api/logout' && req.method === 'POST') {
      const s = getSession(req);
      if (s) sessions.delete(s.token);
      res.setHeader('Set-Cookie', sessionCookie('', 0));
      json(res, 200, { ok: true });
      return;
    }

    if (p === '/api/me' && req.method === 'GET') {
      const s = getSession(req);
      if (!s) { json(res, 401, { authed: false }); return; }
      json(res, 200, { authed: true, user: { id: s.userId, username: s.username, role: s.role } });
      return;
    }

    if (p === '/api/meta' && req.method === 'GET') {
      if (!requireAuth(req, res)) return;
      const catalog = await store.listCatalog();
      const hardware = await store.listHardwareMeta();
      json(res, 200, {
        businessTypes: store.BUSINESS_TYPES,
        services: catalog.map(c => ({
          id: Number(c.id), code: c.code, name: c.name, sortOrder: Number(c.sort_order || 0),
          allowsFreeText: !!(c.allows_free_text === true || c.allows_free_text === 1 || c.allows_free_text === '1'),
        })),
        hardware,
        imageLimits: { logo: 2, store: 5 },
        dataSources: [],
      });
      return;
    }

    if (p === '/api/shops' && req.method === 'GET') {
      if (!requireAuth(req, res)) return;
      const shops = await store.listShops({
        q: url.searchParams.get('q') || '',
        businessType: url.searchParams.get('businessType') || '',
        dataSource: url.searchParams.get('dataSource') || '',
        hasE: url.searchParams.get('hasE') === '1',
        serviceCode: url.searchParams.get('serviceCode') || '',
        serviceStatus: url.searchParams.get('serviceStatus') || '',
      });
      json(res, 200, { shops });
      return;
    }

    if (p === '/api/shops' && req.method === 'POST') {
      const s = requireAuth(req, res); if (!s) return;
      const body = JSON.parse((await readBody(req, 20 * 1024 * 1024)).toString('utf8') || '{}');
      if (!String(body.name || '').trim()) { json(res, 400, { error: 'กรุณากรอกชื่อร้าน' }); return; }
      const shop = await store.createShop(shopBodyFromJson(body), s.userId);
      json(res, 201, { shop });
      return;
    }

    let m;
    if ((m = p.match(/^\/api\/media\/(\d+)$/)) && req.method === 'GET') {
      if (!requireAuth(req, res)) return;
      const file = await store.getMediaFile(Number(m[1]));
      if (!file) { json(res, 404, { error: 'ไม่พบรูป' }); return; }
      const fs = require('fs');
      const buf = fs.readFileSync(file.path);
      send(res, 200, buf, {
        'Content-Type': file.mime || 'application/octet-stream',
        'Content-Length': String(buf.length),
        'Cache-Control': 'private, max-age=3600',
      });
      return;
    }

    if ((m = p.match(/^\/api\/shops\/(\d+)\/images$/)) && req.method === 'POST') {
      const s = requireAuth(req, res); if (!s) return;
      const shopId = Number(m[1]);
      const body = JSON.parse((await readBody(req, 12 * 1024 * 1024)).toString('utf8') || '{}');
      try {
        const image = await store.addShopImage(shopId, {
          kind: body.kind,
          originalName: body.originalName || body.filename || '',
          mime: body.mime || body.contentType || '',
          dataBase64: body.dataBase64 || body.data || '',
        }, s.userId);
        if (!image) { json(res, 404, { error: 'ไม่พบร้าน' }); return; }
        json(res, 201, { image });
      } catch (e) {
        json(res, 400, { error: e.message || 'อัปโหลดไม่สำเร็จ' });
      }
      return;
    }

    if ((m = p.match(/^\/api\/shops\/(\d+)\/images\/(\d+)$/)) && req.method === 'DELETE') {
      const s = requireAuth(req, res); if (!s) return;
      const ok = await store.deleteShopImage(Number(m[2]), s.userId);
      if (!ok) { json(res, 404, { error: 'ไม่พบรูป' }); return; }
      json(res, 200, { ok: true });
      return;
    }

    if ((m = p.match(/^\/api\/images\/(\d+)$/)) && req.method === 'DELETE') {
      const s = requireAuth(req, res); if (!s) return;
      const ok = await store.deleteShopImage(Number(m[1]), s.userId);
      if (!ok) { json(res, 404, { error: 'ไม่พบรูป' }); return; }
      json(res, 200, { ok: true });
      return;
    }

    if ((m = p.match(/^\/api\/shops\/(\d+)$/))) {
      const id = Number(m[1]);
      if (req.method === 'GET') {
        if (!requireAuth(req, res)) return;
        const shop = await store.getShop(id);
        if (!shop) { json(res, 404, { error: 'ไม่พบร้าน' }); return; }
        json(res, 200, { shop });
        return;
      }
      if (req.method === 'PUT') {
        const s = requireAuth(req, res); if (!s) return;
        const body = JSON.parse((await readBody(req, 20 * 1024 * 1024)).toString('utf8') || '{}');
        if (!String(body.name || '').trim()) { json(res, 400, { error: 'กรุณากรอกชื่อร้าน' }); return; }
        const shop = await store.updateShop(id, shopBodyFromJson(body), s.userId);
        if (!shop) { json(res, 404, { error: 'ไม่พบร้าน' }); return; }
        json(res, 200, { shop });
        return;
      }
      if (req.method === 'DELETE') {
        const s = requireAdmin(req, res); if (!s) return;
        const ok = await store.deleteShop(id, s.userId);
        if (!ok) { json(res, 404, { error: 'ไม่พบร้าน' }); return; }
        json(res, 200, { ok: true });
        return;
      }
    }

    if (p === '/api/reports/summary' && req.method === 'GET') {
      if (!requireAuth(req, res)) return;
      json(res, 200, await store.reportSummary());
      return;
    }

    if (p === '/api/login-logs' && req.method === 'GET') {
      if (!requireAdmin(req, res)) return;
      json(res, 200, { logs: await store.listLoginLogs(200) });
      return;
    }

    if (p === '/api/audit' && req.method === 'GET') {
      if (!requireAdmin(req, res)) return;
      json(res, 200, { logs: await store.listAuditLogs(200) });
      return;
    }

    if ((p === '/api/export/shops.xlsx' || p === '/api/export/shops.xls') && req.method === 'GET') {
      if (!requireAuth(req, res)) return;
      try {
        const exp = require('./export-excel');
        const buf = await exp.exportShopsExcelBuffer();
        const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const ext = exp.FILE_EXT || 'xlsx';
        const filename = 'CS-System-Report-' + stamp + '.' + ext;
        // บังคับนามสกุลไฟล์ให้ Windows/Chrome รู้จักว่าเป็น Excel
        send(res, 200, buf, {
          'Content-Type': exp.CONTENT_TYPE || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="' + filename + '"',
          'Content-Length': String(buf.length),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'X-Export-Source': 'BD_CSystem',
        });
      } catch (e) {
        console.error(e);
        json(res, 500, { error: e.message || 'สร้างไฟล์ Excel ไม่สำเร็จ' });
      }
      return;
    }

    if (p === '/api/users' && req.method === 'GET') {
      if (!requireAdmin(req, res)) return;
      json(res, 200, { users: await store.listUsers() });
      return;
    }

    if (p === '/api/users' && req.method === 'POST') {
      const s = requireAdmin(req, res); if (!s) return;
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      try {
        const user = await store.createUser({
          username: body.username,
          password: body.password,
          role: body.role,
        }, s.userId);
        json(res, 201, { user });
      } catch (e) {
        json(res, 400, { error: e.message || 'สร้างผู้ใช้ไม่สำเร็จ' });
      }
      return;
    }

    if ((m = p.match(/^\/api\/users\/(\d+)\/active$/)) && req.method === 'PUT') {
      const s = requireAdmin(req, res); if (!s) return;
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      try {
        const user = await store.setUserActive(Number(m[1]), !!body.isActive, s.userId);
        if (!user) { json(res, 404, { error: 'ไม่พบผู้ใช้' }); return; }
        json(res, 200, { user: {
          id: Number(user.id),
          username: user.username,
          role: user.role,
          isActive: !!(user.is_active === true || user.is_active === 1 || user.is_active === '1'),
        }});
      } catch (e) {
        json(res, 400, { error: e.message || 'อัปเดตไม่สำเร็จ' });
      }
      return;
    }

    json(res, 404, { error: 'ไม่พบ API ที่ต้องการ' });
  } catch (e) {
    console.error(e);
    json(res, 500, { error: e.message || 'เกิดข้อผิดพลาดในระบบ' });
  }
});

(async () => {
  try {
    await store.ensureAdmin();
    console.log('Admin user ready (default password from ADMIN_PASSWORD / admin123)');
  } catch (e) {
    console.error('ensureAdmin failed — run sql/setup.sql and check .env', e.message || e);
  }
  server.listen(PORT, () => {
    console.log('CSystem backend (API) at http://localhost:' + PORT);
    console.log('DB:', process.env.DB_NAME || 'BD_CSystem', '@', process.env.DB_HOST || 'tvsdb2');
  });
})();
