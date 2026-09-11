'use strict';
/* Data layer: ThanvasuInfo.Tbl_Rest (read, grouped by brand/branches) + local CustomerProfileDB overlays */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const odbc = require('odbc');

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnvFile();

function buildConn(opts) {
  if (opts.full) return opts.full;
  const host = opts.host || '127.0.0.1';
  const port = opts.port || '1433';
  const db = opts.database || 'CustomerProfileDB';
  const enc = ';Encrypt=' + (opts.encrypt || 'yes') + ';TrustServerCertificate=' + (opts.trustCert === false ? 'no' : 'yes');
  if (opts.user) {
    return 'Driver={ODBC Driver 17 for SQL Server};Server=' + host + ',' + port +
      ';Database=' + db + ';UID=' + opts.user + ';PWD=' + (opts.pass || '') + enc + ';';
  }
  return 'Driver={ODBC Driver 17 for SQL Server};Server=' + host + ',' + port +
    ';Database=' + db + ';Trusted_Connection=Yes' + enc + ';';
}

const REMOTE_CONN = process.env.DB_CONN_STRING || buildConn({
  host: process.env.DB_HOST || 'tvsdb2.thanvasupos.com',
  port: process.env.DB_PORT || '28914',
  database: process.env.DB_NAME || 'ThanvasuInfo',
  user: process.env.DB_USER || 'uinet',
  pass: process.env.DB_PASS || '',
  encrypt: process.env.DB_ENCRYPT || 'yes',
});

const LOCAL_CONN = process.env.LOCAL_DB_CONN_STRING || buildConn({
  host: process.env.LOCAL_DB_HOST || '127.0.0.1',
  port: process.env.LOCAL_DB_PORT || '1433',
  database: process.env.LOCAL_DB_NAME || 'CustomerProfileDB',
  user: process.env.LOCAL_DB_USER,
  pass: process.env.LOCAL_DB_PASS,
  encrypt: process.env.LOCAL_DB_ENCRYPT || 'no',
});

const SNAKE_TO_CAMEL = {
  id: 'id', code: 'code',
  shop_name_th: 'shopNameTh', shop_name_en: 'shopNameEn',
  company_name_th: 'companyNameTh', company_name_en: 'companyNameEn',
  business_type: 'businessType', business_type_other: 'businessTypeOther',
  branch_count: 'branchCount', branches: 'branches', website: 'website',
  owner_name: 'ownerName', owner_nickname: 'ownerNickname', owner_phone: 'ownerPhone',
  coordinator_name: 'coordinatorName', coordinator_nickname: 'coordinatorNickname',
  coordinator_phone: 'coordinatorPhone', contact_email: 'contactEmail', start_date: 'startDate',
  systems: 'systems', other_system_api: 'otherSystemApi', system_flow: 'systemFlow',
  hardware: 'hardware', other_hardware: 'otherHardware',
  logo: 'logo', storefront: 'storefront',
  created_at: 'createdAt', updated_at: 'updatedAt',
};
const CAMEL_TO_SNAKE = Object.fromEntries(Object.entries(SNAKE_TO_CAMEL).map(([s, c]) => [c, s]));
const JSON_CAMEL = ['branches', 'systems', 'hardware', 'logo', 'storefront'];
const DATE_CAMEL = ['createdAt', 'updatedAt'];
const LOCAL_COLS = Object.keys(SNAKE_TO_CAMEL);

async function withConn(connString, fn) {
  const cn = await odbc.connect({ connectionString: connString });
  try { return await fn(cn); }
  finally { try { await cn.close(); } catch (e) {} }
}

function emptyCustomer() {
  return {
    id: '', code: '', shopNameTh: '', shopNameEn: '', companyNameTh: '', companyNameEn: '',
    businessType: '', businessTypeOther: '', branchCount: '', branches: [], website: '',
    ownerName: '', ownerNickname: '', ownerPhone: '', coordinatorName: '', coordinatorNickname: '',
    coordinatorPhone: '', contactEmail: '', startDate: '', systems: [], otherSystemApi: '',
    systemFlow: '', hardware: {}, otherHardware: '', logo: [], storefront: [],
    logoUrl: null, createdAt: null, updatedAt: null, source: 'local', readOnly: false,
    hasOverlay: false, branchDetails: [],
  };
}

/** Derive brand/shop group name from a branch RestName */
function groupKeyFromName(name) {
  let n = String(name || '').trim().replace(/\s+/g, ' ');
  if (!n) return '';
  n = n.replace(/\s*[-_]\s*S\d+\s*$/i, '');
  n = n.replace(/\s+S\d+\s*$/i, '');
  n = n.replace(/_S\d+\s*$/i, '');
  const loc = n.match(/^(.*)\s+[-–]\s+.+$/u);
  if (loc && loc[1].trim().length >= 3) n = loc[1].trim();
  return n.trim();
}

function groupIdFromKey(key) {
  return 'grp_' + crypto.createHash('sha1').update(String(key).toLowerCase()).digest('hex').slice(0, 12);
}

function restRowToBranch(r) {
  return {
    id: String(r.RestID),
    name: r.RestName || '',
    branchNo: r.RestBranchNo != null ? r.RestBranchNo : null,
    logoUrl: r.RestImgUrl_Logo || null,
  };
}

function buildGroupCustomer(restRows) {
  const rests = restRows.slice().sort((a, b) =>
    String(a.RestName || '').localeCompare(String(b.RestName || ''), 'th', { sensitivity: 'base' }));
  const primary = rests.find(r => r.RestImgUrl_Logo) || rests[0];
  const display = groupKeyFromName(primary.RestName) || primary.RestName || '(ไม่มีชื่อ)';
  const key = display.toLowerCase();
  const c = emptyCustomer();
  c.id = groupIdFromKey(key);
  c.code = rests.length === 1 ? String(primary.RestID) : ('BR-' + rests.length);
  c.shopNameTh = display;
  c.branchCount = String(rests.length);
  c.branches = rests.map(r => r.RestName).filter(Boolean);
  c.branchDetails = rests.map(restRowToBranch);
  c.website = primary.WebOrderingFrontendUrl || primary.Redirect_url || '';
  c.logoUrl = primary.RestImgUrl_Logo || null;
  if (primary.RestImgUrl_Logo) {
    c.logo = [{ id: 'logo-ext', url: primary.RestImgUrl_Logo, file: null, name: 'logo' }];
  }
  const banners = [primary.RestImgUrl_Banner1, primary.RestImgUrl_Banner2, primary.RestImgUrl_Banner3]
    .filter(Boolean)
    .map((url, i) => ({ id: 'ban-' + i, url, file: null, name: 'banner' + (i + 1) }));
  c.storefront = banners;
  c.createdAt = primary.CreateDate
    ? (primary.CreateDate instanceof Date ? primary.CreateDate.toISOString() : String(primary.CreateDate))
    : null;
  c.updatedAt = c.createdAt;
  c.systemFlow = rests.length > 1
    ? ('รวม ' + rests.length + ' สาขาในระบบ THANVASU')
    : '';
  c.otherSystemApi = primary.TRC_EndPoint || '';
  c.source = 'thanvasu';
  c.readOnly = false;
  c.hasOverlay = false;
  c.groupKey = key;
  return c;
}

function groupRestRows(rows) {
  const map = new Map();
  for (const r of rows) {
    const display = groupKeyFromName(r.RestName) || r.RestName || String(r.RestID);
    const key = display.toLowerCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return [...map.values()]
    .map(buildGroupCustomer)
    .sort((a, b) => a.shopNameTh.localeCompare(b.shopNameTh, 'th', { sensitivity: 'base' }));
}

function localRowToCustomer(r) {
  const c = emptyCustomer();
  for (const [snake, camel] of Object.entries(SNAKE_TO_CAMEL)) {
    if (r[snake] === undefined && r[camel] === undefined) continue;
    const raw = r[snake] !== undefined ? r[snake] : r[camel];
    if (JSON_CAMEL.includes(camel)) {
      try { c[camel] = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : (camel === 'hardware' ? {} : []); }
      catch (e) { c[camel] = camel === 'hardware' ? {} : []; }
    } else if (DATE_CAMEL.includes(camel)) {
      c[camel] = raw ? (raw instanceof Date ? raw.toISOString() : String(raw)) : null;
    } else {
      c[camel] = raw;
    }
  }
  c.source = 'local';
  c.readOnly = false;
  if ((!c.logoUrl) && c.logo && c.logo[0]) {
    c.logoUrl = c.logo[0].url || (c.logo[0].file ? '/files/' + c.logo[0].file : null);
  }
  return c;
}

function customerToLocalRow(c) {
  const row = {};
  for (const [camel, snake] of Object.entries(CAMEL_TO_SNAKE)) {
    if (c[camel] === undefined) continue;
    if (JSON_CAMEL.includes(camel)) {
      row[snake] = JSON.stringify(c[camel] == null ? (camel === 'hardware' ? {} : []) : c[camel]);
    } else if (DATE_CAMEL.includes(camel)) {
      row[snake] = c[camel] ? new Date(c[camel]) : null;
    } else {
      row[snake] = c[camel];
    }
  }
  return row;
}

const REST_SELECT = `
  SELECT RestID, RestName, RestBranchNo, RestImgUrl_Logo,
         RestImgUrl_Banner1, RestImgUrl_Banner2, RestImgUrl_Banner3,
         CreateDate, WebOrderingFrontendUrl, WebOrderingBackendUrl,
         Redirect_url, GroupRestID, RestServerName, RestDBName, TRC_EndPoint
  FROM dbo.Tbl_Rest
`;

async function fetchAllRestRows() {
  return withConn(REMOTE_CONN, async cn => cn.query(REST_SELECT + ' ORDER BY RestName'));
}

async function listRemote() {
  const rows = await fetchAllRestRows();
  return groupRestRows(rows);
}

async function getRemote(id) {
  const sid = String(id);
  const rows = await fetchAllRestRows();
  const groups = groupRestRows(rows);
  if (sid.startsWith('grp_')) {
    return groups.find(g => g.id === sid) || null;
  }
  if (/^\d+$/.test(sid)) {
    return groups.find(g => (g.branchDetails || []).some(b => b.id === sid)) || null;
  }
  return null;
}

async function listLocal() {
  try {
    return await withConn(LOCAL_CONN, async cn => {
      const rows = await cn.query('SELECT * FROM Customers ORDER BY created_at');
      return rows.map(localRowToCustomer);
    });
  } catch (e) {
    console.warn('[db] local CustomerProfileDB unavailable:', e.message || e);
    return [];
  }
}

async function getLocal(id) {
  try {
    return await withConn(LOCAL_CONN, async cn => {
      const rows = await cn.query('SELECT * FROM Customers WHERE id = ?', [id]);
      return rows.length ? localRowToCustomer(rows[0]) : null;
    });
  } catch (e) {
    return null;
  }
}

function isRemoteId(id) {
  return /^\d+$/.test(String(id));
}
function isGroupId(id) {
  return String(id).startsWith('grp_');
}
function isThanvasuId(id) {
  return isRemoteId(id) || isGroupId(id);
}

function mergeCustomer(base, overlay) {
  if (!overlay) return base;
  const out = Object.assign({}, base);
  const overlayKeys = [
    'shopNameEn', 'companyNameTh', 'companyNameEn', 'businessType', 'businessTypeOther',
    'website', 'ownerName', 'ownerNickname', 'ownerPhone',
    'coordinatorName', 'coordinatorNickname', 'coordinatorPhone', 'contactEmail', 'startDate',
    'systems', 'otherSystemApi', 'systemFlow', 'hardware', 'otherHardware',
    'logo', 'storefront', 'updatedAt',
  ];
  for (const k of overlayKeys) {
    const v = overlay[k];
    if (v == null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (k === 'hardware' && v && typeof v === 'object' && !Object.keys(v).length) continue;
    if (typeof v === 'string' && !v.trim()) continue;
    out[k] = v;
  }
  if (!out.shopNameTh && overlay.shopNameTh) out.shopNameTh = overlay.shopNameTh;
  if (Array.isArray(overlay.branches) && overlay.branches.length) out.branches = overlay.branches;
  if (overlay.branchCount) out.branchCount = overlay.branchCount;
  if (overlay.logo && overlay.logo.length) {
    out.logo = overlay.logo;
    out.logoUrl = overlay.logoUrl || (overlay.logo[0].url || (overlay.logo[0].file ? '/files/' + overlay.logo[0].file : base.logoUrl));
  }
  if (overlay.storefront && overlay.storefront.length) out.storefront = overlay.storefront;
  out.branchDetails = base.branchDetails || [];
  out.groupKey = base.groupKey;
  out.source = base.source || overlay.source || 'local';
  out.readOnly = false;
  out.hasOverlay = true;
  return out;
}

async function listCustomers() {
  const [remote, local] = await Promise.all([listRemote(), listLocal()]);
  const localById = new Map(local.map(c => [String(c.id), c]));
  const remoteIds = new Set(remote.map(c => c.id));
  const merged = remote.map(r => {
    const o = localById.get(String(r.id));
    return o ? mergeCustomer(r, o) : Object.assign({}, r, { readOnly: false, hasOverlay: false });
  });
  const extras = local.filter(c => !remoteIds.has(String(c.id)) && !isThanvasuId(c.id));
  return merged.concat(extras);
}

async function getCustomer(id) {
  if (isThanvasuId(id)) {
    const remote = await getRemote(id);
    if (remote) {
      const overlay = await getLocal(String(remote.id));
      return overlay ? mergeCustomer(remote, overlay) : Object.assign({}, remote, { readOnly: false, hasOverlay: false });
    }
  }
  return getLocal(id);
}

async function upsertLocal(c) {
  return withConn(LOCAL_CONN, async cn => {
    const row = customerToLocalRow(c);
    const existing = await cn.query('SELECT id FROM Customers WHERE id = ?', [c.id]);
    if (existing.length) {
      const cols = LOCAL_COLS.filter(k => row[k] !== undefined && k !== 'id' && k !== 'code' && k !== 'created_at');
      const set = cols.map(k => k + ' = ?').join(', ');
      await cn.execute('UPDATE Customers SET ' + set + ' WHERE id = ?', cols.map(k => row[k]).concat([c.id]));
    } else {
      if (!row.created_at) row.created_at = new Date();
      if (!row.code) row.code = c.code || String(c.id);
      const cols = LOCAL_COLS.filter(k => row[k] !== undefined);
      const sqlText = 'INSERT INTO Customers (' + cols.join(',') + ') VALUES (' + cols.map(() => '?').join(',') + ')';
      await cn.execute(sqlText, cols.map(k => row[k]));
    }
    return c;
  });
}

async function insertCustomer(c) {
  return withConn(LOCAL_CONN, async cn => {
    const row = customerToLocalRow(c);
    const cols = LOCAL_COLS.filter(k => row[k] !== undefined);
    const sqlText = 'INSERT INTO Customers (' + cols.join(',') + ') VALUES (' + cols.map(() => '?').join(',') + ')';
    await cn.execute(sqlText, cols.map(k => row[k]));
    return localRowToCustomer(row);
  });
}

async function updateCustomer(id, c) {
  c.id = id;
  if (isThanvasuId(id)) {
    const remote = await getRemote(id);
    if (!remote) {
      const err = new Error('not found');
      err.code = 'NOT_FOUND';
      throw err;
    }
    c.id = remote.id;
    c.code = remote.code || remote.id;
    if (!c.shopNameTh) c.shopNameTh = remote.shopNameTh;
    if (!c.branches || !c.branches.length) c.branches = remote.branches;
    if (!c.branchCount) c.branchCount = remote.branchCount;
    if (!c.createdAt) c.createdAt = remote.createdAt || new Date().toISOString();
    c.updatedAt = new Date().toISOString();
    await upsertLocal(c);
    return mergeCustomer(remote, c);
  }
  return withConn(LOCAL_CONN, async cn => {
    const row = customerToLocalRow(c);
    const cols = LOCAL_COLS.filter(k => row[k] !== undefined && k !== 'id' && k !== 'code' && k !== 'created_at');
    const set = cols.map(k => k + ' = ?').join(', ');
    await cn.execute('UPDATE Customers SET ' + set + ' WHERE id = ?', cols.map(k => row[k]).concat([id]));
    return c;
  });
}

async function deleteCustomer(id) {
  if (isThanvasuId(id)) {
    try {
      await withConn(LOCAL_CONN, async cn => {
        await cn.execute('DELETE FROM Customers WHERE id = ?', [String(id)]);
      });
    } catch (e) { /* local optional */ }
    const err = new Error('ไม่สามารถลบร้านจากระบบ THANVASU ได้');
    err.code = 'READ_ONLY';
    throw err;
  }
  return withConn(LOCAL_CONN, async cn => {
    await cn.execute('DELETE FROM Customers WHERE id = ?', [id]);
  });
}

async function nextCode() {
  try {
    return await withConn(LOCAL_CONN, async cn => {
      const rows = await cn.query("SELECT ISNULL(MAX(CAST(SUBSTRING(code, 4, 10) AS INT)), 0) + 1 AS n FROM Customers WHERE code LIKE 'CU-%'");
      return 'CU-' + String(rows[0].n).padStart(4, '0');
    });
  } catch (e) {
    return 'CU-' + String(Date.now()).slice(-4);
  }
}

module.exports = {
  listCustomers, getCustomer, insertCustomer, updateCustomer, deleteCustomer, nextCode,
  REMOTE_CONN, LOCAL_CONN, isRemoteId, isGroupId, isThanvasuId, groupKeyFromName,
};
