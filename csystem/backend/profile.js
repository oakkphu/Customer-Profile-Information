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
/** โฟลเดอร์ไฟล์รูป — ตอน Docker/Coolify ต้อง mount volume มาที่ path นี้ */
const UPLOAD_ROOT = process.env.UPLOAD_ROOT
  ? path.resolve(process.env.UPLOAD_ROOT)
  : path.join(__dirname, 'uploads');

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

function newBranchId() {
  return crypto.randomBytes(8).toString('hex');
}

function normalizeBranchHardwareList(list) {
  const arr = Array.isArray(list) ? list : [];
  return arr.map(h => ({
    hardwareId: Number(h && (h.hardwareId != null ? h.hardwareId : h.id)) || 0,
    code: String((h && h.code) || '').trim(),
    name: String((h && h.name) || '').trim(),
    qty: Math.max(0, Math.min(9999, Number(h && h.qty) || 0)),
  })).filter(h => h.hardwareId > 0 || h.code);
}

function parseBranches(raw) {
  if (raw == null || raw === '') return [];
  const s = String(raw).trim();
  if (!s) return [];
  const fix = (t) => repairThaiTextLocal(String(t || '').trim());
  try {
    const j = JSON.parse(s);
    if (Array.isArray(j)) {
      return j.map(x => {
        if (x && typeof x === 'object') {
          return {
            id: String(x.id || '').trim(),
            name: fix(x.name || x.branch || ''),
            province: fix(x.province || ''),
            mapUrl: String(x.mapUrl || x.map || '').trim(),
          };
        }
        return { id: '', name: fix(x || ''), province: '', mapUrl: '' };
      }).filter(b => b.name);
    }
  } catch (_) {}
  return s.split(/\r?\n|;/).map(line => {
    const name = fix(line || '');
    return name ? { id: '', name, province: '', mapUrl: '' } : null;
  }).filter(Boolean);
}

/** ซ่อมข้อความไทยเพี้ยนแบบเบา ๆ (ไม่ดึง db กัน circular require) */
function repairThaiTextLocal(raw) {
  let s = String(raw == null ? '' : raw);
  if (!s) return s;
  // น + ํ + ็ + า → น้ำ (ลำดับสระผิด)
  s = s.replace(/\u0E19\u0E4D\u0E47\u0E32/g, 'น้ำ');
  if (!/à¸|à¹|Ã.|Â.|เธ/.test(s) && !/[\u0080-\u00ff]{2,}/.test(s)) return s;
  try {
    const bytes = Buffer.alloc(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
    const fixed = bytes.toString('utf8');
    if (fixed && !fixed.includes('\uFFFD') && /[\u0E00-\u0E7F]/.test(fixed)) return fixed;
  } catch (_) {}
  return s;
}

function serializeBranches(list) {
  const arr = Array.isArray(list) ? list : parseBranches(list);
  const clean = arr.map(x => ({
    id: String((x && x.id) || '').trim() || newBranchId(),
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
  const seen = new Set();
  branches = branches.map(x => {
    let id = String((x && x.id) || '').trim();
    if (!id || seen.has(id)) id = newBranchId();
    seen.add(id);
    return {
      id,
      name: String((x && x.name) || '').trim(),
      province: String((x && x.province) || '').trim(),
      mapUrl: String((x && x.mapUrl) || '').trim(),
      hardware: normalizeBranchHardwareList(x && x.hardware),
    };
  }).filter(b => b.name);
  let count = data.branchCount != null && data.branchCount !== ''
    ? Number(data.branchCount)
    : (branches.length || null);
  if (count != null && (!Number.isFinite(count) || count < 0)) count = branches.length || null;
  if (count != null) count = Math.min(9999, Math.floor(count));
  if (count != null && count !== branches.length) {
    const err = new Error(
      `จำนวนสาขาที่กรอกเป็น ${count} ต้องเพิ่มชื่อสาขาให้ครบ ${count} รายการ (ตอนนี้มี ${branches.length})`
    );
    err.code = 'BRANCH_COUNT_MISMATCH';
    throw err;
  }
  return { branches, branchCount: count, branchNamesJson: serializeBranches(branches) };
}

function aggregateHardwareFromBranches(branches) {
  const totals = new Map();
  for (const b of branches || []) {
    for (const h of b.hardware || []) {
      const key = Number(h.hardwareId) || String(h.code || '');
      if (!key) continue;
      const prev = totals.get(key) || {
        hardwareId: Number(h.hardwareId) || 0,
        code: h.code || '',
        name: h.name || '',
        qty: 0,
      };
      prev.qty += Number(h.qty) || 0;
      totals.set(key, prev);
    }
  }
  return [...totals.values()];
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
  const shopBranchHw = await cn.query(`SELECT OBJECT_ID(N'dbo.ShopBranchHardware', N'U') AS id`);
  if (!shopBranchHw.length || shopBranchHw[0].id == null) {
    await cn.query(`
      CREATE TABLE dbo.ShopBranchHardware (
        shop_id INT NOT NULL,
        branch_id NVARCHAR(40) NOT NULL,
        hardware_id INT NOT NULL,
        qty INT NOT NULL CONSTRAINT DF_SBH_qty DEFAULT 0,
        CONSTRAINT PK_ShopBranchHardware PRIMARY KEY (shop_id, branch_id, hardware_id),
        CONSTRAINT FK_SBH_Shop FOREIGN KEY (shop_id) REFERENCES dbo.Shops(id) ON DELETE CASCADE,
        CONSTRAINT FK_SBH_Hw FOREIGN KEY (hardware_id) REFERENCES dbo.HardwareCatalog(id)
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
        file_data VARBINARY(MAX) NULL,
        created_at DATETIME2 NOT NULL CONSTRAINT DF_SI_created DEFAULT (${SQL_NOW_TH}),
        CONSTRAINT FK_SI_Shop FOREIGN KEY (shop_id) REFERENCES dbo.Shops(id) ON DELETE CASCADE,
        CONSTRAINT CK_SI_kind CHECK (kind IN (N'logo', N'store'))
      )
    `);
  } else {
    const cols = await cn.query(`
      SELECT COLUMN_NAME AS n FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'ShopImages'
    `);
    const have = new Set(cols.map(c => String(c.n).toLowerCase()));
    if (!have.has('file_data')) {
      await cn.query(`ALTER TABLE dbo.ShopImages ADD file_data VARBINARY(MAX) NULL`);
    }
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
  const fix = (v) => {
    const s = String(v == null ? '' : v);
    if (!s) return '';
    return repairThaiFilename(s);
  };
  const branches = parseBranches(r.branch_names).map(b => ({
    id: String(b.id || '').trim(),
    name: fix(b.name),
    province: fix(b.province),
    mapUrl: String(b.mapUrl || '').trim(),
  }));
  // ensure stable ids in memory (persisted on next save)
  const seen = new Set();
  for (const b of branches) {
    if (!b.id || seen.has(b.id)) b.id = newBranchId();
    seen.add(b.id);
  }
  return {
    brandName: fix(r.brand_name),
    companyNameTh: fix(r.company_name_th),
    companyNameEn: fix(r.company_name_en),
    branchCount: r.branch_count != null ? Number(r.branch_count) : (branches.length || null),
    branches,
    branchNames: branches.map(b => b.name),
    websiteSocial: fix(r.website_social),
    facebookUrl: String(r.facebook_url || '').trim(),
    instagramUrl: String(r.instagram_url || '').trim(),
    ownerName: fix(r.owner_name),
    ownerNickname: fix(r.owner_nickname),
    ownerPhone: String(r.owner_phone || ''),
    contactName: fix(r.contact_name),
    contactNickname: fix(r.contact_nickname),
    contactPhone: String(r.contact_phone || ''),
    contactEmail: String(r.contact_email || ''),
    contactLine: String(r.contact_line || ''),
    contactOther: fix(r.contact_other),
    systemFlow: fix(r.system_flow),
    hardwareOther: fix(r.hardware_other),
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
    branches: b.branches,
    hardware: (() => {
      const fromBranches = aggregateHardwareFromBranches(b.branches);
      if (fromBranches.length) return fromBranches;
      return Array.isArray(data.hardware) ? data.hardware : [];
    })(),
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

async function listShopBranchHardware(cn, shopId) {
  const exists = await cn.query(`SELECT OBJECT_ID(N'dbo.ShopBranchHardware', N'U') AS id`);
  if (!exists.length || exists[0].id == null) return [];
  const rows = await cn.query(
    `SELECT branch_id AS branchId, hardware_id AS hardwareId, ISNULL(qty, 0) AS qty
     FROM ShopBranchHardware WHERE shop_id = ?`,
    [shopId]
  );
  return rows.map(r => ({
    branchId: String(r.branchId || r.branch_id || '').trim(),
    hardwareId: Number(r.hardwareId != null ? r.hardwareId : r.hardware_id),
    qty: Number(r.qty || 0),
  }));
}

function emptyHardwareFromCatalog(catalog) {
  return (catalog || []).map(c => ({
    hardwareId: Number(c.id != null ? c.id : c.hardwareId),
    code: c.code,
    name: c.name,
    sortOrder: Number(c.sortOrder || 0),
    qty: 0,
  }));
}

async function attachHardwareToBranches(cn, shopId, branches, shopHardware) {
  const catalog = await listHardwareCatalog(cn);
  const list = Array.isArray(branches) ? branches : [];
  const rows = await listShopBranchHardware(cn, shopId);
  const byBranch = new Map();
  for (const r of rows) {
    if (!r.branchId) continue;
    if (!byBranch.has(r.branchId)) byBranch.set(r.branchId, new Map());
    byBranch.get(r.branchId).set(Number(r.hardwareId), Number(r.qty || 0));
  }
  const hasBranchData = byBranch.size > 0;
  const legacyHasQty = (shopHardware || []).some(h => Number(h.qty) > 0);
  let legacyAssigned = false;

  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    const qtyMap = byBranch.get(b.id) || new Map();
    let hardware = emptyHardwareFromCatalog(catalog).map(h => ({
      ...h,
      qty: qtyMap.has(h.hardwareId) ? qtyMap.get(h.hardwareId) : 0,
    }));
    if (!hasBranchData && legacyHasQty && !legacyAssigned && i === 0) {
      const legacy = new Map((shopHardware || []).map(h => [Number(h.hardwareId), Number(h.qty || 0)]));
      hardware = hardware.map(h => ({ ...h, qty: legacy.get(h.hardwareId) || 0 }));
      b.hardwareLegacy = true;
      legacyAssigned = true;
    }
    b.hardware = hardware;
  }
  return list;
}

async function saveShopHardware(cn, shopId, hardwareList) {
  const catalog = await listHardwareCatalog(cn);
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
}

async function saveShopBranchHardware(cn, shopId, branches) {
  const exists = await cn.query(`SELECT OBJECT_ID(N'dbo.ShopBranchHardware', N'U') AS id`);
  if (!exists.length || exists[0].id == null) {
    await cn.query(`
      CREATE TABLE dbo.ShopBranchHardware (
        shop_id INT NOT NULL,
        branch_id NVARCHAR(40) NOT NULL,
        hardware_id INT NOT NULL,
        qty INT NOT NULL CONSTRAINT DF_SBH_qty DEFAULT 0,
        CONSTRAINT PK_ShopBranchHardware PRIMARY KEY (shop_id, branch_id, hardware_id),
        CONSTRAINT FK_SBH_Shop FOREIGN KEY (shop_id) REFERENCES dbo.Shops(id) ON DELETE CASCADE,
        CONSTRAINT FK_SBH_Hw FOREIGN KEY (hardware_id) REFERENCES dbo.HardwareCatalog(id)
      )
    `);
  }
  const catalog = await listHardwareCatalog(cn);
  const list = Array.isArray(branches) ? branches.filter(b => b && b.id && b.name) : [];
  const keepIds = list.map(b => String(b.id));

  if (keepIds.length) {
    const ph = keepIds.map(() => '?').join(',');
    await cn.query(
      `DELETE FROM ShopBranchHardware WHERE shop_id = ? AND branch_id NOT IN (${ph})`,
      [shopId, ...keepIds]
    );
  } else {
    await cn.query('DELETE FROM ShopBranchHardware WHERE shop_id = ?', [shopId]);
  }

  for (const b of list) {
    const items = Array.isArray(b.hardware) ? b.hardware : [];
    for (const c of catalog) {
      const hit = items.find(x =>
        Number(x.hardwareId) === c.id || String(x.code || '') === c.code
      );
      const qty = hit ? Math.max(0, Math.min(9999, Number(hit.qty) || 0)) : 0;
      const row = await cn.query(
        'SELECT 1 AS x FROM ShopBranchHardware WHERE shop_id=? AND branch_id=? AND hardware_id=?',
        [shopId, b.id, c.id]
      );
      if (row.length) {
        await cn.query(
          'UPDATE ShopBranchHardware SET qty=? WHERE shop_id=? AND branch_id=? AND hardware_id=?',
          [qty, shopId, b.id, c.id]
        );
      } else {
        await cn.query(
          'INSERT INTO ShopBranchHardware (shop_id, branch_id, hardware_id, qty) VALUES (?,?,?,?)',
          [shopId, b.id, c.id, qty]
        );
      }
    }
  }

  const totals = aggregateHardwareFromBranches(list);
  await saveShopHardware(cn, shopId, totals);
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
            CONVERT(varchar(30), created_at, 126) AS createdAt,
            CASE WHEN file_data IS NULL THEN 0 ELSE 1 END AS hasData
     FROM ShopImages WHERE shop_id = ? ORDER BY kind, sort_order, id`,
    [shopId]
  );
  const out = [];
  for (const r of rows) {
    const rec = {
      id: Number(r.id),
      shopId: Number(r.shopId != null ? r.shopId : r.shop_id),
      kind: r.kind,
      storedName: r.storedName || r.stored_name,
      originalName: repairThaiFilename(r.originalName || r.original_name || ''),
      mime: r.mime || '',
      sizeBytes: Number(r.sizeBytes != null ? r.sizeBytes : r.size_bytes || 0),
      sortOrder: Number(r.sortOrder != null ? r.sortOrder : r.sort_order || 0),
      createdAt: r.createdAt || r.created_at,
      url: '/api/media/' + Number(r.id),
      hasData: Number(r.hasData || r.has_data || 0) === 1,
    };
    const onDisk = fs.existsSync(absoluteImagePath(rec));
    if (!rec.hasData && !onDisk) {
      try {
        await cn.query('DELETE FROM ShopImages WHERE id = ?', [rec.id]);
      } catch (_) {}
      continue;
    }
    // มีไฟล์บนดิสก์แต่ยังไม่เข้า DB — ย้ายเข้า DB ให้ถาวร
    if (!rec.hasData && onDisk) {
      try {
        await saveImageBlob(cn, rec.id, fs.readFileSync(absoluteImagePath(rec)));
        rec.hasData = true;
      } catch (e) {
        console.warn('[uploads] migrate disk→db fail id=' + rec.id, e.message || e);
      }
    }
    // มีใน DB แต่ยังไม่มีแคชดิสก์ — เขียนแคชเงียบ ๆ ให้รอบถัดไปเร็ว
    if (rec.hasData && !onDisk) {
      try {
        const blob = await readImageBlob(cn, rec.id);
        if (blob && blob.length) {
          const dir = path.join(UPLOAD_ROOT, 'shop-' + rec.shopId);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(absoluteImagePath(rec), blob);
        }
      } catch (_) {}
    }
    out.push(rec);
  }
  return out;
}

/** NVARCHAR literal — ODBC bind ? มักทำให้ชื่อไฟล์ไทยเพี้ยน */
function sqlN(str) {
  return "N'" + String(str == null ? '' : str).replace(/'/g, "''") + "'";
}

/** แก้ชื่อไฟล์/ข้อความไทยที่ ODBC/SQL เก็บผิด (UTF-8 ถูกตีเป็น Windows-874 หรือ Latin-1) */
function repairThaiFilename(name) {
  const s = String(name || '');
  if (!s) return '';

  const looksBytes = (() => {
    for (let i = 0; i < s.length - 2; i++) {
      const a = s.charCodeAt(i);
      const b = s.charCodeAt(i + 1);
      const c = s.charCodeAt(i + 2);
      if (a === 0xe0 && (b === 0xb8 || b === 0xb9) && c >= 0x80 && c <= 0xbf) return true;
    }
    return false;
  })();
  const hits = (s.match(/เธ/g) || []).length;
  const latinHits = (s.match(/à¸|à¹|Ã.|Â./g) || []).length;
  const hasLow = /[\u0080-\u00ff]/.test(s);
  if (!looksBytes && hits < 2 && latinHits < 1 && !hasLow && !/เน[€]/.test(s)) {
    return s.slice(0, 260);
  }

  try {
    const bytes = Buffer.alloc(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
    const fixed = bytes.toString('utf8');
    if (fixed && !fixed.includes('\uFFFD') && /[\u0E00-\u0E7F]/.test(fixed)) return fixed.slice(0, 260);
  } catch (_) {}

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

async function saveImageBlob(cn, imageId, buf) {
  const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  if (!data.length) throw new Error('ไฟล์ว่าง');
  try {
    await cn.query('UPDATE ShopImages SET file_data = ? WHERE id = ?', [data, Number(imageId)]);
    return;
  } catch (e1) {
    // ODBC บางตัว bind Buffer ไม่ได้ — ส่งเป็น hex literal
    const hex = data.toString('hex').toUpperCase();
    await cn.query(
      `UPDATE ShopImages SET file_data = CONVERT(varbinary(max), 0x${hex}) WHERE id = ?`,
      [Number(imageId)]
    );
  }
}

async function readImageBlob(cn, imageId) {
  const rows = await cn.query(
    `SELECT file_data AS fileData FROM ShopImages WHERE id = ?`,
    [Number(imageId)]
  );
  if (!rows.length || rows[0].fileData == null && rows[0].file_data == null) return null;
  const raw = rows[0].fileData != null ? rows[0].fileData : rows[0].file_data;
  if (Buffer.isBuffer(raw)) return raw;
  if (raw && raw.buffer) return Buffer.from(raw.buffer || raw);
  if (typeof raw === 'string') {
    // บาง driver ส่ง binary เป็น latin1 string
    return Buffer.from(raw, 'binary');
  }
  try {
    return Buffer.from(raw);
  } catch (_) {
    return null;
  }
}

async function migrateDiskImagesIntoDb(cn) {
  let migrated = 0;
  let skipped = 0;
  try {
    const rows = await cn.query(`
      SELECT id, shop_id AS shopId, stored_name AS storedName
      FROM ShopImages
      WHERE file_data IS NULL
    `);
    for (const r of rows) {
      const rec = {
        id: Number(r.id),
        shopId: Number(r.shopId != null ? r.shopId : r.shop_id),
        storedName: r.storedName || r.stored_name,
      };
      const fp = absoluteImagePath(rec);
      if (!fs.existsSync(fp)) {
        skipped += 1;
        continue;
      }
      try {
        await saveImageBlob(cn, rec.id, fs.readFileSync(fp));
        migrated += 1;
      } catch (e) {
        console.warn('[uploads] migrate id=' + rec.id, e.message || e);
      }
    }
  } catch (e) {
    console.warn('[uploads] migrateDiskImagesIntoDb', e.message || e);
  }
  if (migrated || skipped) {
    console.log('[uploads] disk→DB migrated=' + migrated + ' missing-on-disk=' + skipped);
  }
  return { migrated, skipped };
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
  const stored = crypto.randomBytes(16).toString('hex') + extFromMime(safeMime, safeOriginal);
  // เขียนลงดิสก์เป็นแคช (best-effort) — แหล่งจริงคือ DB
  try {
    ensureUploadRoot();
    fs.writeFileSync(path.join(shopUploadDir(shopId), stored), buf);
  } catch (e) {
    console.warn('[uploads] disk cache write failed (DB still stores image)', e.message || e);
  }
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
  const imageId = Number(ins[0].id);
  await saveImageBlob(cn, imageId, buf);
  return imageId;
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
    [Number(imageId)]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    shopId: Number(r.shopId != null ? r.shopId : r.shop_id),
    kind: r.kind,
    storedName: r.storedName || r.stored_name,
    originalName: r.originalName || r.original_name,
    mime: r.mime,
    sizeBytes: Number(r.sizeBytes != null ? r.sizeBytes : r.size_bytes || 0),
  };
}

function absoluteImagePath(rec) {
  const shopId = Number(rec.shopId != null ? rec.shopId : rec.shop_id);
  const stored = String(rec.storedName || rec.stored_name || '');
  return path.join(UPLOAD_ROOT, 'shop-' + shopId, stored);
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
  listShopBranchHardware,
  attachHardwareToBranches,
  saveShopHardware,
  saveShopBranchHardware,
  seedShopHardware,
  aggregateHardwareFromBranches,
  newBranchId,
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
  parseBranches,
  serializeBranches,
  saveImageBlob,
  readImageBlob,
  migrateDiskImagesIntoDb,
};
