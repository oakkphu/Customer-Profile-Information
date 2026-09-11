'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SQL_NOW_TH =
  "CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time' AS DATETIME2)";

const HARDWARE_CATALOG = [
  { code: 'pos', name: 'POS', sortOrder: 1 },
  { code: 'kiosk', name: 'Kiosk', sortOrder: 2 },
  { code: 'printer', name: 'Printer', sortOrder: 3 },
  { code: 'kitchen_printer', name: 'Kitchen Printer', sortOrder: 4 },
  { code: 'customer_display', name: 'Customer Display', sortOrder: 5 },
  { code: 'kds_screen', name: 'KDS Screen', sortOrder: 6 },
  { code: 'cash_drawer', name: 'Cash Drawer', sortOrder: 7 },
  { code: 'barcode_scanner', name: 'Barcode Scanner', sortOrder: 8 },
  { code: 'handheld_scanner', name: 'Handheld Scanner', sortOrder: 9 },
];

const IMAGE_LIMITS = { logo: 2, store: 5 };
const UPLOAD_ROOT = path.join(__dirname, 'uploads');

const PROFILE_SHOP_COLUMNS = [
  ['brand_name', 'NVARCHAR(200) NULL'],
  ['company_name_th', 'NVARCHAR(200) NULL'],
  ['company_name_en', 'NVARCHAR(200) NULL'],
  ['branch_count', 'INT NULL'],
  ['branch_names', 'NVARCHAR(MAX) NULL'],
  ['website_social', 'NVARCHAR(1000) NULL'],
  ['facebook_url', 'NVARCHAR(500) NULL'],
  ['instagram_url', 'NVARCHAR(500) NULL'],
  ['owner_name', 'NVARCHAR(120) NULL'],
  ['owner_nickname', 'NVARCHAR(80) NULL'],
  ['owner_phone', 'NVARCHAR(40) NULL'],
  ['contact_name', 'NVARCHAR(120) NULL'],
  ['contact_nickname', 'NVARCHAR(80) NULL'],
  ['contact_phone', 'NVARCHAR(40) NULL'],
  ['contact_email', 'NVARCHAR(200) NULL'],
  ['contact_line', 'NVARCHAR(120) NULL'],
  ['contact_other', 'NVARCHAR(500) NULL'],
  ['system_flow', 'NVARCHAR(MAX) NULL'],
  ['hardware_other', 'NVARCHAR(500) NULL'],
];

function parseBranches(raw) {
  if (raw == null || raw === '') return [];
  const s = String(raw).trim();
  if (!s) return [];
  try {
    const j = JSON.parse(s);
    if (Array.isArray(j)) {
      return j.map(x => {
        if (x && typeof x === 'object') {
          return {
            name: String(x.name || x.branch || '').trim(),
            province: String(x.province || '').trim(),
            mapUrl: String(x.mapUrl || x.map || '').trim(),
          };
        }
        return { name: String(x || '').trim(), province: '', mapUrl: '' };
      }).filter(b => b.name);
    }
  } catch (_) {}
  return s.split(/\r?\n|;/).map(line => {
    const name = String(line || '').trim();
    return name ? { name, province: '', mapUrl: '' } : null;
  }).filter(Boolean);
}

function serializeBranches(list) {
  const arr = Array.isArray(list) ? list : parseBranches(list);
  const clean = arr.map(x => ({
    name: String((x && x.name) || '').trim(),
    province: String((x && x.province) || '').trim(),
    mapUrl: String((x && x.mapUrl) || '').trim(),
  })).filter(b => b.name);
  return clean.length ? JSON.stringify(clean) : null;
}

function normalizeBranches(data) {
  let branches = [];
  if (Array.isArray(data.branches)) branches = data.branches;
  else if (Array.isArray(data.branchNames) && data.branchNames.length && typeof data.branchNames[0] === 'object') {
    branches = data.branchNames;
  } else if (typeof data.branchNamesText === 'string') {
    branches = parseBranches(data.branchNamesText);
  } else if (data.branchNames != null) {
    branches = parseBranches(data.branchNames);
  }
  branches = branches.map(x => ({
    name: String((x && x.name) || '').trim(),
    province: String((x && x.province) || '').trim(),
    mapUrl: String((x && x.mapUrl) || '').trim(),
  })).filter(b => b.name);
  let count = data.branchCount != null && data.branchCount !== ''
    ? Number(data.branchCount)
    : (branches.length || null);
  if (count != null && (!Number.isFinite(count) || count < 0)) count = branches.length || null;
  if (count != null) count = Math.min(9999, Math.floor(count));
  return { branches, branchCount: count, branchNamesJson: serializeBranches(branches) };
}

function ensureUploadRoot() {
  if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
}

function shopUploadDir(shopId) {
  const dir = path.join(UPLOAD_ROOT, 'shop-' + Number(shopId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** @deprecated use parseBranches */
function parseBranchNames(raw) {
  return parseBranches(raw).map(b => b.name);
}

/** @deprecated use serializeBranches */
function serializeBranchNames(list) {
  if (Array.isArray(list) && list.length && typeof list[0] === 'object') return serializeBranches(list);
  return serializeBranches((list || []).map(name => ({ name, province: '', mapUrl: '' })));
}

async function ensureProfileSchema(cn) {
  const cols = await cn.query(`
    SELECT COLUMN_NAME AS n FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='Shops'
  `);
  const have = new Set(cols.map(c => String(c.n).toLowerCase()));
  for (const [name, def] of PROFILE_SHOP_COLUMNS) {
    if (!have.has(name.toLowerCase())) {
      await cn.query(`ALTER TABLE dbo.Shops ADD ${name} ${def}`);
    }
  }

  const hwCat = await cn.query(`SELECT OBJECT_ID(N'dbo.HardwareCatalog', N'U') AS id`);
  if (!hwCat.length || hwCat[0].id == null) {
    await cn.query(`
      CREATE TABLE dbo.HardwareCatalog (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        code NVARCHAR(80) NOT NULL UNIQUE,
        name NVARCHAR(200) NOT NULL,
        sort_order INT NOT NULL CONSTRAINT DF_Hw_sort DEFAULT 0
      )
    `);
  }
  const shopHw = await cn.query(`SELECT OBJECT_ID(N'dbo.ShopHardware', N'U') AS id`);
  if (!shopHw.length || shopHw[0].id == null) {
    await cn.query(`
      CREATE TABLE dbo.ShopHardware (
        shop_id INT NOT NULL,
        hardware_id INT NOT NULL,
        qty INT NOT NULL CONSTRAINT DF_SH_qty DEFAULT 0,
        CONSTRAINT PK_ShopHardware PRIMARY KEY (shop_id, hardware_id),
        CONSTRAINT FK_SH_Shop FOREIGN KEY (shop_id) REFERENCES dbo.Shops(id) ON DELETE CASCADE,
        CONSTRAINT FK_SH_Hw FOREIGN KEY (hardware_id) REFERENCES dbo.HardwareCatalog(id)
      )
    `);
  }
  const imgs = await cn.query(`SELECT OBJECT_ID(N'dbo.ShopImages', N'U') AS id`);
  if (!imgs.length || imgs[0].id == null) {
    await cn.query(`
      CREATE TABLE dbo.ShopImages (
        id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        shop_id INT NOT NULL,
        kind NVARCHAR(20) NOT NULL,
        stored_name NVARCHAR(200) NOT NULL,
        original_name NVARCHAR(260) NULL,
        mime NVARCHAR(80) NULL,
        size_bytes INT NULL,
        sort_order INT NOT NULL CONSTRAINT DF_SI_sort DEFAULT 0,
        created_at DATETIME2 NOT NULL CONSTRAINT DF_SI_created DEFAULT (${SQL_NOW_TH}),
        CONSTRAINT FK_SI_Shop FOREIGN KEY (shop_id) REFERENCES dbo.Shops(id) ON DELETE CASCADE,
        CONSTRAINT CK_SI_kind CHECK (kind IN (N'logo', N'store'))
      )
    `);
  }

  for (const h of HARDWARE_CATALOG) {
    const exists = await cn.query('SELECT id FROM HardwareCatalog WHERE code = ?', [h.code]);
    if (!exists.length) {
      await cn.query(
        `INSERT INTO HardwareCatalog (code, name, sort_order) VALUES (?, ?, ?)`,
        [h.code, h.name, h.sortOrder]
      );
    }
  }
  ensureUploadRoot();
}

function profileSelectFragment(alias) {
  const a = alias || 's';
  return `
    ${a}.brand_name, ${a}.company_name_th, ${a}.company_name_en,
    ${a}.branch_count, CAST(${a}.branch_names AS nvarchar(max)) AS branch_names,
    ${a}.website_social,
    ${a}.owner_name, ${a}.owner_nickname, ${a}.owner_phone,
    ${a}.contact_name, ${a}.contact_nickname, ${a}.contact_phone, ${a}.contact_email,
    ${a}.contact_line, ${a}.contact_other,
    CAST(${a}.system_flow AS nvarchar(max)) AS system_flow,
    ${a}.hardware_other`;
}

function mapProfileFields(r) {
  const branches = parseBranches(r.branch_names);
  return {
    brandName: r.brand_name || '',
    companyNameTh: r.company_name_th || '',
    companyNameEn: r.company_name_en || '',
    branchCount: r.branch_count != null ? Number(r.branch_count) : (branches.length || null),
    branches,
    branchNames: branches.map(b => b.name),
    websiteSocial: r.website_social || '',
    facebookUrl: r.facebook_url || '',
    instagramUrl: r.instagram_url || '',
    ownerName: r.owner_name || '',
    ownerNickname: r.owner_nickname || '',
    ownerPhone: r.owner_phone || '',
    contactName: r.contact_name || '',
    contactNickname: r.contact_nickname || '',
    contactPhone: r.contact_phone || '',
    contactEmail: r.contact_email || '',
    contactLine: r.contact_line || '',
    contactOther: r.contact_other || '',
    systemFlow: r.system_flow || '',
    hardwareOther: r.hardware_other || '',
  };
}

function profilePayloadFromData(data) {
  const b = normalizeBranches(data || {});
  const facebookUrl = String(data.facebookUrl || '').trim();
  const instagramUrl = String(data.instagramUrl || '').trim();
  const websiteSocial = String(data.websiteSocial || '').trim()
    || [facebookUrl, instagramUrl].filter(Boolean).join(' · ');
  return {
    brandName: String(data.brandName || '').trim(),
    companyNameTh: String(data.companyNameTh || '').trim(),
    companyNameEn: String(data.companyNameEn || '').trim(),
    branchCount: b.branchCount,
    branchNamesJson: b.branchNamesJson,
    websiteSocial,
    facebookUrl,
    instagramUrl,
    ownerName: String(data.ownerName || '').trim(),
    ownerNickname: String(data.ownerNickname || '').trim(),
    ownerPhone: String(data.ownerPhone || '').trim(),
    contactName: String(data.contactName || '').trim(),
    contactNickname: String(data.contactNickname || '').trim(),
    contactPhone: String(data.contactPhone || '').trim(),
    contactEmail: String(data.contactEmail || '').trim(),
    contactLine: String(data.contactLine || '').trim(),
    contactOther: String(data.contactOther || '').trim(),
    systemFlow: String(data.systemFlow || '').trim(),
    hardwareOther: String(data.hardwareOther || '').trim(),
    hardware: Array.isArray(data.hardware) ? data.hardware : [],
  };
}

async function listHardwareCatalog(cn) {
  const rows = await cn.query(
    'SELECT id, code, name, sort_order AS sortOrder FROM HardwareCatalog ORDER BY sort_order, id'
  );
  return rows.map(r => ({
    id: Number(r.id),
    code: r.code,
    name: r.name,
    sortOrder: Number(r.sortOrder || 0),
  }));
}

async function listShopHardware(cn, shopId) {
  const rows = await cn.query(
    `SELECT c.id AS hardwareId, c.code, c.name, c.sort_order AS sortOrder,
            ISNULL(h.qty, 0) AS qty
     FROM HardwareCatalog c
     LEFT JOIN ShopHardware h ON h.hardware_id = c.id AND h.shop_id = ?
     ORDER BY c.sort_order, c.id`,
    [shopId]
  );
  return rows.map(r => ({
    hardwareId: Number(r.hardwareId),
    code: r.code,
    name: r.name,
    sortOrder: Number(r.sortOrder || 0),
    qty: Number(r.qty || 0),
  }));
}

async function saveShopHardware(cn, shopId, hardwareList) {
  const catalog = await listHardwareCatalog(cn);
  const byId = new Map(catalog.map(c => [c.id, c]));
  const byCode = new Map(catalog.map(c => [c.code, c]));
  const items = Array.isArray(hardwareList) ? hardwareList : [];
  for (const c of catalog) {
    const hit = items.find(x =>
      Number(x.hardwareId) === c.id || String(x.code || '') === c.code
    );
    const qty = hit ? Math.max(0, Math.min(9999, Number(hit.qty) || 0)) : 0;
    const exists = await cn.query(
      'SELECT 1 AS x FROM ShopHardware WHERE shop_id=? AND hardware_id=?',
      [shopId, c.id]
    );
    if (exists.length) {
      await cn.query('UPDATE ShopHardware SET qty=? WHERE shop_id=? AND hardware_id=?', [qty, shopId, c.id]);
    } else {
      await cn.query('INSERT INTO ShopHardware (shop_id, hardware_id, qty) VALUES (?,?,?)', [shopId, c.id, qty]);
    }
  }
  // silence unused
  void byId; void byCode;
}

async function seedShopHardware(cn, shopId) {
  await cn.query(
    `INSERT INTO ShopHardware (shop_id, hardware_id, qty)
     SELECT ?, c.id, 0 FROM HardwareCatalog c
     WHERE NOT EXISTS (
       SELECT 1 FROM ShopHardware h WHERE h.shop_id = ? AND h.hardware_id = c.id
     )`,
    [shopId, shopId]
  );
}

async function listShopImages(cn, shopId) {
  const rows = await cn.query(
    `SELECT id, shop_id AS shopId, kind, stored_name AS storedName, original_name AS originalName,
            mime, size_bytes AS sizeBytes, sort_order AS sortOrder,
            CONVERT(varchar(30), created_at, 126) AS createdAt
     FROM ShopImages WHERE shop_id = ? ORDER BY kind, sort_order, id`,
    [shopId]
  );
  return rows.map(r => ({
    id: Number(r.id),
    shopId: Number(r.shopId),
    kind: r.kind,
    originalName: repairThaiFilename(r.originalName || ''),
    mime: r.mime || '',
    sizeBytes: Number(r.sizeBytes || 0),
    sortOrder: Number(r.sortOrder || 0),
    createdAt: r.createdAt,
    url: '/api/media/' + Number(r.id),
  }));
}

/** NVARCHAR literal — ODBC bind ? มักทำให้ชื่อไฟล์ไทยเพี้ยน */
function sqlN(str) {
  return "N'" + String(str == null ? '' : str).replace(/'/g, "''") + "'";
}

/** แก้ชื่อไฟล์ไทยที่ ODBC/SQL เก็บผิด (UTF-8 ถูกตีเป็น Windows-874) */
function repairThaiFilename(name) {
  const s = String(name || '');
  if (!s) return '';
  const hits = (s.match(/เธ/g) || []).length;
  const hasLow = /[\x80-\xff]/.test(s);
  if (hits < 2 && !hasLow && !/เน[€]/.test(s)) return s.slice(0, 260);
  try {
    const iconv = require('iconv-lite');
    const bytes = [];
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      if (cp <= 0xff) bytes.push(cp);
      else {
        const enc = iconv.encode(ch, 'win874');
        for (const b of enc) bytes.push(b);
      }
    }
    const fixed = Buffer.from(bytes).toString('utf8');
    if (
      fixed &&
      !fixed.includes('\uFFFD') &&
      (/[\u0E00-\u0E7F]/.test(fixed) || (fixed.match(/เธ/g) || []).length < hits)
    ) {
      return fixed.slice(0, 260);
    }
  } catch (_) {}
  try {
    const fixed = Buffer.from(s, 'latin1').toString('utf8');
    if (fixed && !fixed.includes('\uFFFD') && /[\u0E00-\u0E7F]/.test(fixed)) return fixed.slice(0, 260);
  } catch (_) {}
  return s.slice(0, 260);
}

function extFromMime(mime, originalName) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return '.png';
  if (m.includes('jpeg') || m.includes('jpg')) return '.jpg';
  if (m.includes('webp')) return '.webp';
  if (m.includes('gif')) return '.gif';
  const ext = path.extname(String(originalName || '')).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  return '.bin';
}

async function addShopImage(cn, shopId, { kind, originalName, mime, dataBase64 }) {
  const k = String(kind || '').toLowerCase() === 'logo' ? 'logo' : 'store';
  const limit = IMAGE_LIMITS[k];
  const existing = await cn.query(
    'SELECT COUNT(*) AS cnt FROM ShopImages WHERE shop_id = ? AND kind = ?',
    [shopId, k]
  );
  if (Number(existing[0].cnt || 0) >= limit) {
    throw new Error(k === 'logo' ? 'อัปโหลดโลโก้ได้สูงสุด 2 รูป' : 'อัปโหลดรูปหน้าร้านได้สูงสุด 5 รูป');
  }
  let b64 = String(dataBase64 || '');
  const dataUrl = b64.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataUrl) {
    mime = mime || dataUrl[1];
    b64 = dataUrl[2];
  }
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) throw new Error('ไฟล์ว่าง');
  if (buf.length > 8 * 1024 * 1024) throw new Error('ไฟล์ใหญ่เกิน 8MB');
  const safeMime = String(mime || 'application/octet-stream').slice(0, 80);
  const safeOriginal = repairThaiFilename(String(originalName || '').trim() || 'image');
  if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(safeMime) && !/\.(png|jpe?g|webp|gif)$/i.test(safeOriginal)) {
    throw new Error('รองรับเฉพาะไฟล์รูป PNG / JPG / WEBP / GIF');
  }
  ensureUploadRoot();
  const stored = crypto.randomBytes(16).toString('hex') + extFromMime(safeMime, safeOriginal);
  const dir = shopUploadDir(shopId);
  fs.writeFileSync(path.join(dir, stored), buf);
  const sortRows = await cn.query(
    'SELECT ISNULL(MAX(sort_order),0)+1 AS n FROM ShopImages WHERE shop_id=? AND kind=?',
    [shopId, k]
  );
  const sortOrder = Number(sortRows[0].n || 1);
  const displayName = (safeOriginal || stored).slice(0, 260);
  const ins = await cn.query(
    `INSERT INTO ShopImages (shop_id, kind, stored_name, original_name, mime, size_bytes, sort_order)
     OUTPUT INSERTED.id AS id
     VALUES (?, ?, ${sqlN(stored)}, ${sqlN(displayName)}, ${sqlN(safeMime)}, ?, ?)`,
    [shopId, k, buf.length, sortOrder]
  );
  return Number(ins[0].id);
}

/** ซ่อมชื่อไฟล์ไทยที่เพี้ยนใน ShopImages */
async function repairShopImageNames(cn) {
  const rows = await cn.query('SELECT id, original_name AS originalName FROM ShopImages');
  let fixed = 0;
  for (const r of rows) {
    const before = String(r.originalName || '');
    const after = repairThaiFilename(before);
    if (after && after !== before) {
      await cn.query(
        `UPDATE ShopImages SET original_name = ${sqlN(after)} WHERE id = ?`,
        [Number(r.id)]
      );
      fixed += 1;
    }
  }
  return fixed;
}

async function getImageRecord(cn, imageId) {
  const rows = await cn.query(
    `SELECT id, shop_id AS shopId, kind, stored_name AS storedName, original_name AS originalName,
            mime, size_bytes AS sizeBytes
     FROM ShopImages WHERE id = ?`,
    [imageId]
  );
  return rows[0] || null;
}

function absoluteImagePath(rec) {
  return path.join(UPLOAD_ROOT, 'shop-' + Number(rec.shopId), rec.storedName);
}

async function deleteShopImage(cn, imageId) {
  const rec = await getImageRecord(cn, imageId);
  if (!rec) return false;
  const fp = absoluteImagePath(rec);
  await cn.query('DELETE FROM ShopImages WHERE id = ?', [imageId]);
  try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (_) {}
  return true;
}

function deleteShopUploadDir(shopId) {
  const dir = path.join(UPLOAD_ROOT, 'shop-' + Number(shopId));
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

module.exports = {
  HARDWARE_CATALOG,
  IMAGE_LIMITS,
  UPLOAD_ROOT,
  ensureProfileSchema,
  profileSelectFragment,
  mapProfileFields,
  profilePayloadFromData,
  listHardwareCatalog,
  listShopHardware,
  saveShopHardware,
  seedShopHardware,
  listShopImages,
  addShopImage,
  repairShopImageNames,
  repairThaiFilename,
  getImageRecord,
  absoluteImagePath,
  deleteShopImage,
  deleteShopUploadDir,
  parseBranchNames,
  serializeBranchNames,
};
