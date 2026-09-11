'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const odbc = require('odbc');
const profile = require('./profile');

function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnv();

/** เวลาปัจจุบันประเทศไทย (ICT / UTC+7) — ใช้บันทึกลง DATETIME2 ให้ตรงนาฬิกาท้องถิ่น */
const SQL_NOW_TH =
  "CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time' AS DATETIME2)";

/** ค่า NVARCHAR ใน SQL — เลี่ยง bind ? ที่ ODBC ทำไทยเพี้ยนบนเซิร์ฟเวอร์ Thai collation */
function sqlN(str) {
  return "N'" + String(str == null ? '' : str).replace(/'/g, "''") + "'";
}

function sqlNOrNull(str) {
  if (str == null || str === '') return 'NULL';
  return sqlN(str);
}

/** ตรวจข้อความไทยที่เพี้ยนจาก ODBC (UTF-8 ถูกตีความเป็น Windows-874) */
function looksThaiMojibake(s) {
  const str = String(s || '');
  if (!str) return false;
  const hits = (str.match(/เธ|เน[€]/g) || []).length;
  if (hits >= 2) return true;
  if (/รฉ|โ€/.test(str)) return true;
  return false;
}

function looksBrokenText(s) {
  const str = String(s || '');
  if (!str) return true;
  if (str.includes('\uFFFD')) return true;
  const q = (str.match(/\?/g) || []).length;
  if (q >= 3 && q * 2 >= str.replace(/\s/g, '').length) return true;
  return looksThaiMojibake(str);
}

/** เลือกข้อความไทยที่อ่านได้ระหว่างค่า NVARCHAR กับ CONVERT(varchar) */
function pickThaiText(raw, asAnsi) {
  const a = raw == null ? '' : String(raw);
  const b = asAnsi == null ? '' : String(asAnsi);
  const aBad = looksBrokenText(a);
  const bBad = !b || looksBrokenText(b);
  if (aBad && !bBad) return b;
  if (!aBad) return a;
  return a || b;
}

const CONN = process.env.DB_CONN_STRING || (
  'Driver={' + (process.env.ODBC_DRIVER || 'ODBC Driver 17 for SQL Server') + '};Server=' + (process.env.DB_HOST || 'tvsdb2.thanvasupos.com') +
  ',' + (process.env.DB_PORT || '28914') +
  ';Database=' + (process.env.DB_NAME || 'BD_CSystem') +
  ';UID=' + (process.env.DB_USER || 'uinet') +
  ';PWD=' + (process.env.DB_PASS || '') +
  ';Encrypt=' + (process.env.DB_ENCRYPT || 'yes') +
  ';TrustServerCertificate=yes;'
);

const BUSINESS_TYPES = [
  { en: 'Restaurant', th: 'ร้านอาหาร' },
  { en: 'Cafe / Coffee Shop', th: 'คาเฟ่ / ร้านกาแฟ' },
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

/** รวมค่าประเภทธุรกิจที่เพี้ยนจาก encoding ให้ตรงรายการมาตรฐาน */
function normalizeBusinessType(raw) {
  const s = String(raw || '').trim();
  if (!s || s === '(ไม่ระบุ)') return s === '(ไม่ระบุ)' ? s : '';
  const exact = BUSINESS_TYPES.find(t => t.en === s);
  if (exact) return exact.en;
  // Café / Cafeฟฟ / Caf… ที่เพี้ยนจากตัว é
  if (/^caf/i.test(s) && /coffee\s*shop/i.test(s)) return 'Cafe / Coffee Shop';
  const byTh = BUSINESS_TYPES.find(t => t.th === s);
  if (byTh) return byTh.en;
  return s;
}

async function withConn(fn) {
  const cn = await odbc.connect({ connectionString: CONN });
  try { return await fn(cn); }
  finally { try { await cn.close(); } catch (e) {} }
}

function hashPassword(password) {
  const N = 16384, r = 8, p = 1;
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32, { N, r, p });
  return 'scrypt$' + N + '$' + r + '$' + p + '$' + salt.toString('base64') + '$' + hash.toString('base64');
}

function verifyPassword(password, stored) {
  if (!stored || !String(stored).startsWith('scrypt$')) return false;
  const parts = String(stored).split('$');
  if (parts.length !== 6) return false;
  const N = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'base64');
  const expect = Buffer.from(parts[5], 'base64');
  const hash = crypto.scryptSync(password, salt, expect.length, { N, r, p });
  return crypto.timingSafeEqual(hash, expect);
}

async function ensureAdmin() {
  await ensureUserAuthSchema();
  return withConn(async cn => {
    const rows = await cn.query("SELECT id, password_hash FROM Users WHERE username = ?", ['admin']);
    const pw = process.env.ADMIN_PASSWORD || 'admin123';
    if (!rows.length) {
      await cn.query(
        'INSERT INTO Users (username, password_hash, role, email) VALUES (?, ?, ?, ?)',
        ['admin', hashPassword(pw), 'Admin', process.env.ADMIN_EMAIL || null]
      );
      return { created: true };
    }
    if (!rows[0].password_hash || String(rows[0].password_hash).includes('PLACEHOLDER')) {
      await cn.query('UPDATE Users SET password_hash = ?, updated_at = '+SQL_NOW_TH+' WHERE id = ?',
        [hashPassword(pw), rows[0].id]);
    }
    if (process.env.ADMIN_EMAIL) {
      await cn.query('UPDATE Users SET email = ?, updated_at = '+SQL_NOW_TH+' WHERE id = ?',
        [normalizeEmail(process.env.ADMIN_EMAIL), rows[0].id]);
    }
    return { ok: true };
  });
}

let _authSchemaReady = false;
async function ensureUserAuthSchema() {
  if (_authSchemaReady) return;
  return withConn(async cn => {
    const cols = await cn.query(`
      SELECT COLUMN_NAME AS n FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='Users'
    `);
    const have = new Set(cols.map(c => String(c.n).toLowerCase()));
    if (!have.has('email')) {
      await cn.query(`ALTER TABLE dbo.Users ADD email NVARCHAR(200) NULL`);
    }
    const idx = await cn.query(`
      SELECT 1 AS x FROM sys.indexes
      WHERE name = N'UX_Users_email' AND object_id = OBJECT_ID(N'dbo.Users')
    `);
    if (!idx.length) {
      try {
        await cn.query(`CREATE UNIQUE INDEX UX_Users_email ON dbo.Users(email) WHERE email IS NOT NULL`);
      } catch (_) {}
    }
    const tbl = await cn.query(`SELECT OBJECT_ID(N'dbo.PasswordResetTokens', N'U') AS id`);
    if (!tbl.length || tbl[0].id == null) {
      await cn.query(`
        CREATE TABLE dbo.PasswordResetTokens (
          id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
          user_id INT NOT NULL,
          token_hash CHAR(64) NOT NULL,
          expires_at DATETIME2 NOT NULL,
          used_at DATETIME2 NULL,
          created_at DATETIME2 NOT NULL CONSTRAINT DF_PRT_created DEFAULT (${SQL_NOW_TH}),
          CONSTRAINT FK_PRT_User FOREIGN KEY (user_id) REFERENCES dbo.Users(id) ON DELETE CASCADE
        )
      `);
      try {
        await cn.query(`CREATE INDEX IX_PRT_token ON dbo.PasswordResetTokens(token_hash)`);
      } catch (_) {}
    }
    const settings = await cn.query(`SELECT OBJECT_ID(N'dbo.AppSettings', N'U') AS id`);
    if (!settings.length || settings[0].id == null) {
      await cn.query(`
        CREATE TABLE dbo.AppSettings (
          [key] NVARCHAR(80) NOT NULL PRIMARY KEY,
          [value] NVARCHAR(MAX) NULL,
          updated_at DATETIME2 NOT NULL CONSTRAINT DF_AppSettings_updated DEFAULT (${SQL_NOW_TH})
        )
      `);
    }
    await ensureThaiTimeDefaults(cn);
    _authSchemaReady = true;
  });
}

async function ensureThaiTimeDefaults(cn) {
  // ปรับ DEFAULT ของตารางหลักให้เป็นเวลาไทย + ย้าย log เก่าจาก UTC → ICT ครั้งเดียว
  const targets = [
    { table: 'LoginLog', column: 'created_at', df: 'DF_Login_created' },
    { table: 'AuditLog', column: 'created_at', df: 'DF_Audit_created' },
    { table: 'Users', column: 'created_at', df: 'DF_Users_created' },
    { table: 'Users', column: 'updated_at', df: 'DF_Users_updated' },
    { table: 'Shops', column: 'created_at', df: 'DF_Shops_created' },
    { table: 'Shops', column: 'updated_at', df: 'DF_Shops_updated' },
    { table: 'ShopServices', column: 'updated_at', df: 'DF_SS_updated' },
  ];
  for (const t of targets) {
    try {
      const have = await cn.query(`
        SELECT d.name AS n
        FROM sys.default_constraints d
        INNER JOIN sys.columns c ON c.default_object_id = d.object_id
        WHERE d.parent_object_id = OBJECT_ID(N'dbo.${t.table}') AND c.name = N'${t.column}'
      `);
      if (have.length) {
        await cn.query(`ALTER TABLE dbo.${t.table} DROP CONSTRAINT [${have[0].n}]`);
      }
      await cn.query(`
        ALTER TABLE dbo.${t.table}
        ADD CONSTRAINT [${t.df}]
        DEFAULT (${SQL_NOW_TH}) FOR [${t.column}]
      `);
    } catch (e) {
      // ignore if table missing / no permission
    }
  }

  const flag = await cn.query(`SELECT [value] FROM AppSettings WHERE [key] = N'time.utc_to_th_migrated'`);
  if (!flag.length) {
    try {
      await cn.query(`UPDATE LoginLog SET created_at = DATEADD(HOUR, 7, created_at)`);
      await cn.query(`UPDATE AuditLog SET created_at = DATEADD(HOUR, 7, created_at)`);
      await cn.query(`
        MERGE AppSettings AS t
        USING (SELECT N'time.utc_to_th_migrated' AS [key], N'1' AS [value]) AS s
        ON t.[key] = s.[key]
        WHEN MATCHED THEN UPDATE SET [value]=s.[value], updated_at=${SQL_NOW_TH}
        WHEN NOT MATCHED THEN INSERT ([key],[value]) VALUES (s.[key], s.[value]);
      `);
      console.log('Migrated LoginLog/AuditLog timestamps UTC → Thailand (+7h)');
    } catch (e) {
      console.warn('time migration skipped:', e.message || e);
    }
  }
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

async function findUserByUsername(username) {
  await ensureUserAuthSchema();
  return withConn(async cn => {
    const rows = await cn.query(
      'SELECT id, username, password_hash, role, is_active, email FROM Users WHERE username = ?',
      [username]
    );
    return rows[0] || null;
  });
}

async function findUserById(id) {
  await ensureUserAuthSchema();
  return withConn(async cn => {
    const rows = await cn.query(
      'SELECT id, username, role, is_active, email FROM Users WHERE id = ?',
      [id]
    );
    return rows[0] || null;
  });
}

async function findUserByEmail(email) {
  await ensureUserAuthSchema();
  const em = normalizeEmail(email);
  if (!em) return null;
  return withConn(async cn => {
    const rows = await cn.query(
      `SELECT id, username, password_hash, role, is_active, email
       FROM Users WHERE LOWER(LTRIM(RTRIM(email))) = ?`,
      [em]
    );
    return rows[0] || null;
  });
}

async function listUsers() {
  await ensureUserAuthSchema();
  return withConn(async cn => {
    const rows = await cn.query(`
      SELECT id, username, email, role, is_active AS isActive,
             CONVERT(varchar(30), created_at, 126) AS createdAt
      FROM Users
      ORDER BY username
    `);
    return rows.map(r => ({
      id: Number(r.id),
      username: r.username,
      email: r.email || '',
      role: r.role,
      isActive: !!(r.isActive === true || r.isActive === 1 || r.isActive === '1'),
      createdAt: r.createdAt,
    }));
  });
}

async function createUser({ username, password, role, email }, actorId) {
  await ensureUserAuthSchema();
  const u = String(username || '').trim();
  const pw = String(password || '');
  const r = role === 'Admin' ? 'Admin' : 'User';
  const em = normalizeEmail(email);
  if (!u) throw new Error('กรุณากรอกชื่อผู้ใช้');
  if (u.length < 3) throw new Error('ชื่อผู้ใช้อย่างน้อย 3 ตัวอักษร');
  if (pw.length < 6) throw new Error('รหัสผ่านอย่างน้อย 6 ตัวอักษร');
  if (em && !isValidEmail(em)) throw new Error('รูปแบบอีเมลไม่ถูกต้อง');
  return withConn(async cn => {
    const exists = await cn.query('SELECT id FROM Users WHERE username = ?', [u]);
    if (exists.length) throw new Error('มีชื่อผู้ใช้นี้แล้ว');
    if (em) {
      const emExists = await cn.query(
        `SELECT id FROM Users WHERE LOWER(LTRIM(RTRIM(email))) = ?`,
        [em]
      );
      if (emExists.length) throw new Error('มีอีเมลนี้ในระบบแล้ว');
    }
    const ins = await cn.query(
      `INSERT INTO Users (username, password_hash, role, is_active, email)
       OUTPUT INSERTED.id AS id, INSERTED.username AS username, INSERTED.role AS role, INSERTED.email AS email
       VALUES (?, ?, ?, 1, ?)`,
      [u, hashPassword(pw), r, em || null]
    );
    const user = {
      id: Number(ins[0].id),
      username: ins[0].username,
      email: ins[0].email || '',
      role: ins[0].role,
      isActive: true,
    };
    await writeAudit({
      userId: actorId,
      entityType: 'User',
      entityId: user.id,
      action: 'create',
      summary: 'สร้างผู้ใช้ ' + u + ' (' + (r === 'Admin' ? 'ผู้ดูแลระบบ' : 'ผู้ใช้งาน') + ')',
      after: { id: user.id, username: u, role: r, email: em || null },
    });
    return user;
  });
}

async function setUserEmail(id, email, actorId) {
  await ensureUserAuthSchema();
  const em = normalizeEmail(email);
  if (em && !isValidEmail(em)) throw new Error('รูปแบบอีเมลไม่ถูกต้อง');
  return withConn(async cn => {
    const rows = await cn.query('SELECT id, username, email FROM Users WHERE id = ?', [id]);
    if (!rows.length) return null;
    if (em) {
      const emExists = await cn.query(
        `SELECT id FROM Users WHERE LOWER(LTRIM(RTRIM(email))) = ? AND id <> ?`,
        [em, id]
      );
      if (emExists.length) throw new Error('มีอีเมลนี้ในระบบแล้ว');
    }
    await cn.query(
      'UPDATE Users SET email = ?, updated_at = '+SQL_NOW_TH+' WHERE id = ?',
      [em || null, id]
    );
    await writeAudit({
      userId: actorId,
      entityType: 'User',
      entityId: id,
      action: 'update',
      summary: 'อัปเดตอีเมลผู้ใช้ ' + rows[0].username,
      before: { email: rows[0].email || null },
      after: { email: em || null },
    });
    return { id: Number(id), username: rows[0].username, email: em || '' };
  });
}

async function createPasswordResetToken(account) {
  await ensureUserAuthSchema();
  const q = String(account || '').trim();
  if (!q) return null;
  let user = null;
  if (q.includes('@')) user = await findUserByEmail(q);
  else user = await findUserByUsername(q);
  if (!user) return null;
  const active = user.is_active === true || user.is_active === 1 || user.is_active === '1';
  if (!active) return null;
  const email = normalizeEmail(user.email);
  if (!email) return null;
  const raw = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(raw);
  await withConn(async cn => {
    await cn.query(
      `UPDATE PasswordResetTokens SET used_at = ${SQL_NOW_TH}
       WHERE user_id = ? AND used_at IS NULL`,
      [user.id]
    );
    await cn.query(
      `INSERT INTO PasswordResetTokens (user_id, token_hash, expires_at)
       VALUES (?, ?, DATEADD(HOUR, 1, ${SQL_NOW_TH}))`,
      [user.id, tokenHash]
    );
  });
  return {
    rawToken: raw,
    user: {
      id: Number(user.id),
      username: user.username,
      email,
    },
  };
}

async function getPasswordResetToken(rawToken) {
  await ensureUserAuthSchema();
  const tokenHash = hashToken(rawToken);
  return withConn(async cn => {
    const rows = await cn.query(
      `SELECT t.id, t.user_id, t.expires_at, t.used_at, u.username, u.email, u.is_active,
              CASE WHEN t.used_at IS NOT NULL THEN 1 ELSE 0 END AS is_used,
              CASE WHEN t.expires_at <= '+SQL_NOW_TH+' THEN 1 ELSE 0 END AS is_expired
       FROM PasswordResetTokens t
       JOIN Users u ON u.id = t.user_id
       WHERE t.token_hash = ?`,
      [tokenHash]
    );
    if (!rows.length) return null;
    const row = rows[0];
    if (Number(row.is_used) === 1) return { valid: false, reason: 'used' };
    if (Number(row.is_expired) === 1) return { valid: false, reason: 'expired' };
    const active = row.is_active === true || row.is_active === 1 || row.is_active === '1';
    if (!active) return { valid: false, reason: 'inactive' };
    return {
      valid: true,
      id: Number(row.id),
      userId: Number(row.user_id),
      username: row.username,
      email: row.email || '',
    };
  });
}

async function resetPasswordWithToken(rawToken, newPassword) {
  await ensureUserAuthSchema();
  const pw = String(newPassword || '');
  if (pw.length < 6) throw new Error('รหัสผ่านอย่างน้อย 6 ตัวอักษร');
  const info = await getPasswordResetToken(rawToken);
  if (!info || !info.valid) {
    throw new Error(
      info && info.reason === 'expired' ? 'ลิงก์หมดอายุแล้ว กรุณาขอลิงก์ใหม่'
        : info && info.reason === 'used' ? 'ลิงก์นี้ถูกใช้ไปแล้ว'
          : 'ลิงก์ไม่ถูกต้องหรือหมดอายุ'
    );
  }
  const hashed = hashPassword(pw);
  await withConn(async cn => {
    await cn.query(
      'UPDATE Users SET password_hash = ?, updated_at = '+SQL_NOW_TH+' WHERE id = ?',
      [hashed, info.userId]
    );
    await cn.query(
      'UPDATE PasswordResetTokens SET used_at = '+SQL_NOW_TH+' WHERE id = ?',
      [info.id]
    );
    await cn.query(
      `UPDATE PasswordResetTokens SET used_at = ${SQL_NOW_TH}
       WHERE user_id = ? AND used_at IS NULL`,
      [info.userId]
    );
  });
  await writeAudit({
    userId: info.userId,
    entityType: 'User',
    entityId: info.userId,
    action: 'update',
    summary: 'รีเซ็ตรหัสผ่านผ่านอีเมล (' + info.username + ')',
    after: { passwordReset: true },
  });
  return { ok: true, username: info.username };
}

async function changePassword(userId, currentPassword, newPassword) {
  await ensureUserAuthSchema();
  const cur = String(currentPassword || '');
  const next = String(newPassword || '');
  if (next.length < 6) throw new Error('รหัสผ่านใหม่อย่างน้อย 6 ตัวอักษร');
  return withConn(async cn => {
    const rows = await cn.query(
      'SELECT id, username, password_hash FROM Users WHERE id = ?',
      [userId]
    );
    if (!rows.length) throw new Error('ไม่พบผู้ใช้');
    if (!verifyPassword(cur, rows[0].password_hash)) {
      throw new Error('รหัสผ่านปัจจุบันไม่ถูกต้อง');
    }
    await cn.query(
      'UPDATE Users SET password_hash = ?, updated_at = '+SQL_NOW_TH+' WHERE id = ?',
      [hashPassword(next), userId]
    );
    await writeAudit({
      userId,
      entityType: 'User',
      entityId: userId,
      action: 'update',
      summary: 'เปลี่ยนรหัสผ่านเอง (' + rows[0].username + ')',
      after: { passwordChanged: true },
    });
    return { ok: true };
  });
}

async function getSettingMap(prefix) {
  await ensureUserAuthSchema();
  return withConn(async cn => {
    const rows = await cn.query(
      prefix
        ? `SELECT [key], [value] FROM AppSettings WHERE [key] LIKE ?`
        : `SELECT [key], [value] FROM AppSettings`,
      prefix ? [prefix + '%'] : []
    );
    const out = {};
    rows.forEach(r => { out[r.key] = r.value == null ? '' : String(r.value); });
    return out;
  });
}

async function setSettings(entries) {
  await ensureUserAuthSchema();
  return withConn(async cn => {
    for (const [key, value] of Object.entries(entries)) {
      if (!key) continue;
      await cn.query(`
        MERGE AppSettings AS t
        USING (SELECT ? AS [key], ? AS [value]) AS s
        ON t.[key] = s.[key]
        WHEN MATCHED THEN UPDATE SET [value] = s.[value], updated_at = '+SQL_NOW_TH+'
        WHEN NOT MATCHED THEN INSERT ([key], [value]) VALUES (s.[key], s.[value]);
      `, [key, value == null ? null : String(value)]);
    }
  });
}

function mailConfigFromSources(map) {
  map = map || {};
  const host = map['mail.smtp_host'] || process.env.SMTP_HOST || '';
  const user = map['mail.smtp_user'] || process.env.SMTP_USER || '';
  const pass = map['mail.smtp_pass'] || process.env.SMTP_PASS || '';
  const port = Number(map['mail.smtp_port'] || process.env.SMTP_PORT || 587) || 587;
  const secureRaw = map['mail.smtp_secure'] != null && map['mail.smtp_secure'] !== ''
    ? map['mail.smtp_secure']
    : (process.env.SMTP_SECURE || '');
  const secure = String(secureRaw).toLowerCase() === 'true' || String(secureRaw) === '1' || port === 465;
  const from = map['mail.mail_from'] || process.env.MAIL_FROM || user || '';
  const publicAppUrl = (map['mail.public_app_url'] || process.env.PUBLIC_APP_URL || 'http://localhost:3230').replace(/\/$/, '');
  const provider = map['mail.provider'] || (host.includes('gmail') ? 'gmail' : host.includes('office365') || host.includes('outlook') ? 'outlook' : 'custom');
  const configured = !!(host && user && pass);
  return {
    provider,
    host,
    port,
    secure,
    user,
    pass,
    from,
    publicAppUrl,
    configured,
    hasPassword: !!pass,
  };
}

async function getMailSettingsPublic() {
  const map = await getSettingMap('mail.');
  const cfg = mailConfigFromSources(map);
  return {
    provider: cfg.provider,
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user,
    from: cfg.from,
    publicAppUrl: cfg.publicAppUrl,
    configured: cfg.configured,
    hasPassword: cfg.hasPassword,
  };
}

async function getMailConfig() {
  const map = await getSettingMap('mail.');
  return mailConfigFromSources(map);
}

async function saveMailSettings(input, actorId) {
  const provider = String(input.provider || 'custom');
  let host = String(input.host || '').trim();
  let port = Number(input.port || 587) || 587;
  let secure = !!input.secure;
  if (provider === 'gmail') {
    host = host || 'smtp.gmail.com';
    port = port || 587;
    secure = false;
  } else if (provider === 'outlook') {
    host = host || 'smtp.office365.com';
    port = port || 587;
    secure = false;
  }
  const user = String(input.user || '').trim();
  const from = String(input.from || '').trim() || user;
  const publicAppUrl = String(input.publicAppUrl || 'http://localhost:3230').trim().replace(/\/$/, '');
  const current = await getMailConfig();
  let pass = input.password;
  if (pass == null || String(pass).trim() === '') pass = current.pass;
  else pass = String(pass).trim();

  if (!host) throw new Error('กรุณาระบุเซิร์ฟเวอร์เมล');
  if (!user) throw new Error('กรุณาระบุอีเมลผู้ส่ง');
  if (!pass) throw new Error('กรุณาระบุรหัสผ่านอีเมล / App Password');

  await setSettings({
    'mail.provider': provider,
    'mail.smtp_host': host,
    'mail.smtp_port': String(port),
    'mail.smtp_secure': secure ? '1' : '0',
    'mail.smtp_user': user,
    'mail.smtp_pass': pass,
    'mail.mail_from': from,
    'mail.public_app_url': publicAppUrl,
  });
  await writeAudit({
    userId: actorId,
    entityType: 'Settings',
    entityId: 'mail',
    action: 'update',
    summary: 'อัปเดตการตั้งค่าอีเมล (' + provider + ' / ' + user + ')',
  });
  return getMailSettingsPublic();
}

async function setUserActive(id, isActive, actorId) {
  return withConn(async cn => {
    const rows = await cn.query('SELECT id, username, role, is_active FROM Users WHERE id = ?', [id]);
    if (!rows.length) return null;
    if (Number(rows[0].id) === Number(actorId) && !isActive) {
      throw new Error('ไม่สามารถปิดบัญชีตัวเองได้');
    }
    await cn.query(
      'UPDATE Users SET is_active = ?, updated_at = '+SQL_NOW_TH+' WHERE id = ?',
      [isActive ? 1 : 0, id]
    );
    await writeAudit({
      userId: actorId,
      entityType: 'User',
      entityId: id,
      action: 'update',
      summary: (isActive ? 'เปิด' : 'ปิด') + 'ผู้ใช้ ' + rows[0].username,
      before: { isActive: !!rows[0].is_active },
      after: { isActive: !!isActive },
    });
    return findUserById(id);
  });
}

async function logLogin({ userId, username, success, ip }) {
  return withConn(async cn => {
    await cn.query(
      'INSERT INTO LoginLog (user_id, username_attempted, success, ip, created_at) VALUES (?, ?, ?, ?, '+SQL_NOW_TH+')',
      [userId || null, username, success ? 1 : 0, ip || null]
    );
  });
}

async function writeAudit({ userId, entityType, entityId, action, summary, before, after }) {
  return withConn(async cn => {
    const beforeJson = before ? JSON.stringify(before) : null;
    const afterJson = after ? JSON.stringify(after) : null;
    await cn.query(
      `INSERT INTO AuditLog (user_id, entity_type, entity_id, action, summary, before_json, after_json, created_at)
       VALUES (?, ${sqlN(entityType)}, ${sqlN(String(entityId))}, ${sqlN(action)}, ${sqlNOrNull(summary)},
               ${sqlNOrNull(beforeJson)}, ${sqlNOrNull(afterJson)}, ${SQL_NOW_TH})`,
      [userId || null]
    );
  });
}

async function repairAuditSummaries(cn) {
  const rows = await cn.query(`
    SELECT id, summary AS rawNvarchar,
           CONVERT(varchar(500), summary) AS asAnsi
    FROM AuditLog
    WHERE summary IS NOT NULL AND summary <> N''
  `);
  let fixed = 0;
  for (const r of rows) {
    const good = pickThaiText(r.rawNvarchar, r.asAnsi);
    if (good && good !== String(r.rawNvarchar || '') && !looksThaiMojibake(good)) {
      await cn.query(`UPDATE AuditLog SET summary = ${sqlN(good)} WHERE id = ?`, [r.id]);
      fixed += 1;
    }
  }
  return fixed;
}

async function repairShopNames(cn) {
  // ไม่ใช้ CONVERT(varchar) ทับชื่อ Unicode ที่ถูกต้อง — ซ่อมจาก ThanvasuInfo แทน
  return 0;
}

/** ดึงชื่อร้านจาก ThanvasuInfo ทับลง CSystem (แก้ชื่อไทยเพี้ยน / ) */
async function syncShopNamesFromThanvasuInfo() {
  const user = process.env.DB_USER || 'uinet';
  const pass = process.env.DB_PASS || '';
  if (!pass) return { updated: 0, skipped: true };

  const thanvasuConn =
    'Driver={ODBC Driver 17 for SQL Server};Server=' + (process.env.DB_HOST || 'tvsdb2.thanvasupos.com') +
    ',' + (process.env.DB_PORT || '28914') +
    ';Database=ThanvasuInfo;UID=' + user +
    ';PWD=' + pass +
    ';Encrypt=' + (process.env.DB_ENCRYPT || 'yes') +
    ';TrustServerCertificate=yes;Login Timeout=15;';

  let rests = [];
  const src = await odbc.connect({ connectionString: thanvasuConn });
  try {
    rests = await src.query(`
      SELECT RestID, RestName, RestBranchNo, RestDBName
      FROM dbo.Tbl_Rest
    `);
  } finally {
    try { await src.close(); } catch (e) {}
  }

  return withConn(async cn => {
    let updated = 0;
    let notesFixed = 0;
    for (const r of rests) {
      const restId = String(r.RestID);
      if (!restId || restId.startsWith('host:')) continue;
      const name = cleanShopName(r.RestName);
      if (!name) continue;

      const noteParts = [];
      if (r.RestBranchNo != null && String(r.RestBranchNo).trim() !== '') {
        noteParts.push('สาขา: ' + String(r.RestBranchNo).trim());
      }
      const dbName = String(r.RestDBName || '').trim();
      if (dbName) noteParts.push('DB: ' + dbName);
      const notes = noteParts.join(' · ') || null;

      const rows = await cn.query(
        `SELECT id, name, CAST(notes AS nvarchar(4000)) AS notes FROM Shops WHERE rest_id = ?`,
        [restId]
      );
      if (!rows.length) continue;

      const curName = String(rows[0].name || '');
      const curNotes = String(rows[0].notes || '');
      const nameNeeds = curName !== name || looksBrokenText(curName);
      const notesNeeds =
        (notes || '') !== curNotes ||
        looksBrokenText(curNotes) ||
        looksThaiMojibake(curNotes) ||
        /เธ|เน[€]/.test(curNotes);

      if (!nameNeeds && !notesNeeds) continue;

      await cn.query(
        `UPDATE Shops SET name = ${sqlN(name)}, notes = ${sqlNOrNull(notes)}, updated_at = ${SQL_NOW_TH}
         WHERE id = ?`,
        [rows[0].id]
      );
      updated += 1;
      if (notesNeeds) notesFixed += 1;
    }
    return { updated, notesFixed, total: rests.length };
  });
}

let thaiRepairDone = false;
async function ensureThaiTextRepaired(cn) {
  if (thaiRepairDone) return;
  thaiRepairDone = true;
  // ไม่ดึง/ซิงก์จาก Database อื่นอัตโนมัติแล้ว — เก็บเฉพาะข้อมูลที่กรอกใน BD_CSystem
}

async function listCatalog() {
  return withConn(async cn => {
    return cn.query('SELECT id, code, name, sort_order, allows_free_text FROM ServiceCatalog ORDER BY sort_order, id');
  });
}

const SHOP_COLS = `id,
  name AS name_raw,
  CONVERT(varchar(400), name) AS name_ansi,
  CONVERT(varchar(10), start_date, 23) AS start_date,
  business_type, business_type_other, data_source,
  CAST(notes AS nvarchar(4000)) AS notes,
  CONVERT(varchar(400), CAST(notes AS nvarchar(4000))) AS notes_ansi,
  rest_id, rest_db,
  CONVERT(varchar(30), created_at, 126) AS created_at,
  CONVERT(varchar(30), updated_at, 126) AS updated_at,
  created_by, updated_by`;

const SHOP_PROFILE_COLS = `
  id,
  brand_name, company_name_th, company_name_en,
  branch_count,
  CONVERT(nvarchar(4000), branch_names) AS branch_names,
  website_social, facebook_url, instagram_url,
  owner_name, owner_nickname, owner_phone,
  contact_name, contact_nickname, contact_phone, contact_email,
  contact_line, contact_other,
  CONVERT(nvarchar(4000), system_flow) AS system_flow,
  hardware_other`;

function mapShop(r) {
  return Object.assign({
    id: r.id,
    name: cleanShopName(pickThaiText(
      r.name_raw != null ? r.name_raw : r.name,
      r.name_ansi
    )),
    startDate: r.start_date ? String(r.start_date).slice(0, 10) : null,
    businessType: normalizeBusinessType(r.business_type || ''),
    businessTypeOther: r.business_type_other || '',
    dataSource: r.data_source || '',
    notes: (() => {
      const n = r.notes == null ? '' : String(r.notes);
      const ansi = r.notes_ansi != null ? String(r.notes_ansi) : '';
      return pickThaiText(n, ansi) || n;
    })(),
    restId: r.rest_id != null ? String(r.rest_id) : '',
    restDb: r.rest_db || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    createdBy: r.created_by,
    updatedBy: r.updated_by,
    serviceSummary: {
      Y: Number(r.cnt_y || 0),
      E: Number(r.cnt_e || 0),
      N: Number(r.cnt_n || 0),
    },
  }, profile.mapProfileFields(r));
}

async function listShops({ q, businessType, dataSource, hasE, serviceCode, serviceStatus } = {}) {
  return withConn(async cn => {
    await ensureShopExtraColumns(cn);
    await ensureThaiTextRepaired(cn);
    let sql = `
      SELECT s.id,
        s.name AS name_raw,
        MAX(CONVERT(varchar(400), s.name)) AS name_ansi,
        CONVERT(varchar(10), s.start_date, 23) AS start_date,
        s.business_type, s.business_type_other, s.data_source,
        CAST(s.notes AS nvarchar(4000)) AS notes,
        CONVERT(varchar(400), MAX(CAST(s.notes AS nvarchar(4000)))) AS notes_ansi,
        s.rest_id, s.rest_db,
        CONVERT(varchar(30), s.created_at, 126) AS created_at,
        CONVERT(varchar(30), s.updated_at, 126) AS updated_at,
        s.created_by, s.updated_by,
        ISNULL(SUM(CASE WHEN ss.status='Y' THEN 1 ELSE 0 END), 0) AS cnt_y,
        ISNULL(SUM(CASE WHEN ss.status='E' THEN 1 ELSE 0 END), 0) AS cnt_e,
        ISNULL(SUM(CASE WHEN ss.status='N' THEN 1 ELSE 0 END), 0) AS cnt_n
      FROM Shops s
      LEFT JOIN ShopServices ss ON ss.shop_id = s.id
      WHERE 1=1`;
    const params = [];
    if (q) {
      sql += ` AND (
        s.name LIKE ? OR s.data_source LIKE ? OR ISNULL(s.rest_db,'') LIKE ?
        OR ISNULL(CAST(s.notes AS nvarchar(4000)),'') LIKE ?
        OR ISNULL(s.brand_name,'') LIKE ? OR ISNULL(s.company_name_th,'') LIKE ?
        OR ISNULL(s.company_name_en,'') LIKE ? OR ISNULL(s.contact_email,'') LIKE ?
        OR ISNULL(s.owner_name,'') LIKE ? OR ISNULL(s.contact_name,'') LIKE ?
      )`;
      const like = '%' + q + '%';
      params.push(like, like, like, like, like, like, like, like, like, like);
    }
    if (businessType) { sql += ' AND s.business_type = ?'; params.push(businessType); }
    if (dataSource) {
      sql += ' AND s.data_source = ?';
      params.push(dataSource);
    }
    if (hasE) {
      sql += ` AND EXISTS (
        SELECT 1 FROM ShopServices e WHERE e.shop_id = s.id AND e.status = 'E'
      )`;
    }
    if (serviceCode && serviceStatus) {
      sql += ` AND EXISTS (
        SELECT 1 FROM ShopServices x
        JOIN ServiceCatalog c ON c.id = x.service_id
        WHERE x.shop_id = s.id AND c.code = ? AND x.status = ?
      )`;
      params.push(serviceCode, serviceStatus);
    }
    sql += ' GROUP BY s.id, s.name, s.start_date, s.business_type, s.business_type_other, s.data_source, CAST(s.notes AS nvarchar(4000)), s.rest_id, s.rest_db, s.created_at, s.updated_at, s.created_by, s.updated_by';
    sql += ' ORDER BY s.data_source, s.name';
    const rows = params.length ? await cn.query(sql, params) : await cn.query(sql);
    return rows.map(mapShop);
  });
}

async function getShop(id) {
  return withConn(async cn => {
    await ensureShopExtraColumns(cn);
    const rows = await cn.query('SELECT ' + SHOP_COLS + ' FROM Shops WHERE id = ?', [id]);
    if (!rows.length) return null;
    let profileRow = {};
    try {
      const prows = await cn.query('SELECT ' + SHOP_PROFILE_COLS + ' FROM Shops WHERE id = ?', [id]);
      profileRow = prows[0] || {};
    } catch (e) {
      console.warn('getShop profile cols', e.message || e);
    }
    const shop = mapShop(Object.assign({ cnt_y: 0, cnt_e: 0, cnt_n: 0 }, rows[0], profileRow));
    const services = await cn.query(
      `SELECT c.id AS serviceId, c.code, c.name, c.allows_free_text AS allowsFreeText, c.sort_order AS sortOrder,
              ISNULL(ss.status,'N') AS status, ss.status_note AS statusNote, ss.other_text AS otherText
       FROM ServiceCatalog c
       LEFT JOIN ShopServices ss ON ss.service_id = c.id AND ss.shop_id = ?
       ORDER BY c.sort_order, c.id`,
      [id]
    );
    shop.services = services.map(s => ({
      serviceId: Number(s.serviceId),
      code: s.code,
      name: s.name,
      allowsFreeText: !!(s.allowsFreeText && (s.allowsFreeText === true || s.allowsFreeText === 1 || s.allowsFreeText === '1')),
      sortOrder: Number(s.sortOrder || 0),
      status: (s.status || 'N').toString().trim().toUpperCase(),
      statusNote: s.statusNote || '',
      otherText: s.otherText || '',
    }));
    const y = shop.services.filter(x => x.status === 'Y').length;
    const e = shop.services.filter(x => x.status === 'E').length;
    const n = shop.services.filter(x => x.status === 'N').length;
    shop.serviceSummary = { Y: y, E: e, N: n };
    await profile.seedShopHardware(cn, id);
    shop.hardware = await profile.listShopHardware(cn, id);
    shop.images = await profile.listShopImages(cn, id);
    return shop;
  });
}

async function seedShopServices(cn, shopId, userId) {
  await cn.query(
    `INSERT INTO ShopServices (shop_id, service_id, status, updated_by)
     SELECT ?, c.id, 'N', ?
     FROM ServiceCatalog c
     WHERE NOT EXISTS (
       SELECT 1 FROM ShopServices ss WHERE ss.shop_id = ? AND ss.service_id = c.id
     )`,
    [shopId, userId || null, shopId]
  );
}

async function createShop(data, userId) {
  return withConn(async cn => {
    await ensureShopExtraColumns(cn);
    const name = cleanShopName(data.name) || data.name;
    const notes = data.notes || null;
    const p = profile.profilePayloadFromData(data);
    const rows = await cn.query(
      `INSERT INTO Shops (
         name, start_date, business_type, business_type_other, data_source, notes,
         brand_name, company_name_th, company_name_en, branch_count, branch_names, website_social,
         facebook_url, instagram_url,
         owner_name, owner_nickname, owner_phone,
         contact_name, contact_nickname, contact_phone, contact_email,
         contact_line, contact_other,
         system_flow, hardware_other, created_by, updated_by
       )
       OUTPUT INSERTED.id AS id
       VALUES (
         ${sqlN(name)}, ?, ?, ?, ?, ${sqlNOrNull(notes)},
         ${sqlNOrNull(p.brandName)}, ${sqlNOrNull(p.companyNameTh)}, ${sqlNOrNull(p.companyNameEn)},
         ?, ${sqlNOrNull(p.branchNamesJson)}, ${sqlNOrNull(p.websiteSocial)},
         ${sqlNOrNull(p.facebookUrl)}, ${sqlNOrNull(p.instagramUrl)},
         ${sqlNOrNull(p.ownerName)}, ${sqlNOrNull(p.ownerNickname)}, ${sqlNOrNull(p.ownerPhone)},
         ${sqlNOrNull(p.contactName)}, ${sqlNOrNull(p.contactNickname)}, ${sqlNOrNull(p.contactPhone)},
         ${sqlNOrNull(p.contactEmail)}, ${sqlNOrNull(p.contactLine)}, ${sqlNOrNull(p.contactOther)},
         ${sqlNOrNull(p.systemFlow)}, ${sqlNOrNull(p.hardwareOther)},
         ?, ?
       )`,
      [
        data.startDate || null,
        normalizeBusinessType(data.businessType) || null,
        data.businessTypeOther || null,
        normalizeServerName(data.dataSource) || null,
        p.branchCount,
        userId || null,
        userId || null,
      ]
    );
    const id = rows[0].id;
    await seedShopServices(cn, id, userId);
    await profile.seedShopHardware(cn, id);
    if (Array.isArray(data.services) && data.services.length) {
      for (const s of data.services) {
        await cn.query(
          `UPDATE ShopServices SET status=?, status_note=?, other_text=?, updated_at=${SQL_NOW_TH}, updated_by=?
           WHERE shop_id=? AND service_id=?`,
          [s.status || 'N', s.statusNote || null, s.otherText || null, userId || null, id, s.serviceId]
        );
      }
    }
    if (p.hardware.length) await profile.saveShopHardware(cn, id, p.hardware);
    const shop = await getShop(id);
    await writeAudit({
      userId, entityType: 'Shop', entityId: id, action: 'create',
      summary: 'สร้างร้าน ' + data.name, after: { id: id, name: data.name },
    });
    return shop;
  });
}

async function updateShop(id, data, userId) {
  return withConn(async cn => {
    await ensureShopExtraColumns(cn);
    const before = await getShop(id);
    if (!before) return null;
    const p = profile.profilePayloadFromData(data);
    await cn.query(
      `UPDATE Shops SET name=${sqlN(cleanShopName(data.name) || data.name)}, start_date=?, business_type=?, business_type_other=?,
        data_source=?, notes=${sqlNOrNull(data.notes || null)},
        brand_name=${sqlNOrNull(p.brandName)},
        company_name_th=${sqlNOrNull(p.companyNameTh)},
        company_name_en=${sqlNOrNull(p.companyNameEn)},
        branch_count=?,
        branch_names=${sqlNOrNull(p.branchNamesJson)},
        website_social=${sqlNOrNull(p.websiteSocial)},
        facebook_url=${sqlNOrNull(p.facebookUrl)},
        instagram_url=${sqlNOrNull(p.instagramUrl)},
        owner_name=${sqlNOrNull(p.ownerName)},
        owner_nickname=${sqlNOrNull(p.ownerNickname)},
        owner_phone=${sqlNOrNull(p.ownerPhone)},
        contact_name=${sqlNOrNull(p.contactName)},
        contact_nickname=${sqlNOrNull(p.contactNickname)},
        contact_phone=${sqlNOrNull(p.contactPhone)},
        contact_email=${sqlNOrNull(p.contactEmail)},
        contact_line=${sqlNOrNull(p.contactLine)},
        contact_other=${sqlNOrNull(p.contactOther)},
        system_flow=${sqlNOrNull(p.systemFlow)},
        hardware_other=${sqlNOrNull(p.hardwareOther)},
        updated_at=${SQL_NOW_TH}, updated_by=? WHERE id=?`,
      [
        data.startDate || null, normalizeBusinessType(data.businessType) || null, data.businessTypeOther || null,
        normalizeServerName(data.dataSource) || null,
        p.branchCount,
        userId || null, id,
      ]
    );
    if (Array.isArray(data.services)) {
      for (const s of data.services) {
        const exists = await cn.query('SELECT 1 AS x FROM ShopServices WHERE shop_id=? AND service_id=?', [id, s.serviceId]);
        if (exists.length) {
          await cn.query(
            `UPDATE ShopServices SET status=?, status_note=?, other_text=?, updated_at=${SQL_NOW_TH}, updated_by=?
             WHERE shop_id=? AND service_id=?`,
            [s.status || 'N', s.statusNote || null, s.otherText || null, userId || null, id, s.serviceId]
          );
        } else {
          await cn.query(
            `INSERT INTO ShopServices (shop_id, service_id, status, status_note, other_text, updated_by)
             VALUES (?,?,?,?,?,?)`,
            [id, s.serviceId, s.status || 'N', s.statusNote || null, s.otherText || null, userId || null]
          );
        }
      }
    }
    if (Array.isArray(data.hardware)) {
      await profile.saveShopHardware(cn, id, data.hardware);
    }
    const after = await getShop(id);
    await writeAudit({
      userId, entityType: 'Shop', entityId: id, action: 'update',
      summary: 'แก้ไขร้าน ' + (after && after.name), before, after,
    });
    return after;
  });
}

async function deleteShop(id, userId) {
  return withConn(async cn => {
    const before = await getShop(id);
    if (!before) return false;
    await cn.query('DELETE FROM Shops WHERE id = ?', [id]);
    profile.deleteShopUploadDir(id);
    await writeAudit({
      userId, entityType: 'Shop', entityId: id, action: 'delete',
      summary: 'ลบร้าน ' + before.name, before,
    });
    return true;
  });
}

async function listHardwareMeta() {
  return withConn(async cn => {
    await ensureShopExtraColumns(cn);
    return profile.listHardwareCatalog(cn);
  });
}

async function addShopImage(shopId, payload, userId) {
  return withConn(async cn => {
    await ensureShopExtraColumns(cn);
    const exists = await cn.query('SELECT id FROM Shops WHERE id = ?', [shopId]);
    if (!exists.length) return null;
    const imageId = await profile.addShopImage(cn, shopId, payload);
    await writeAudit({
      userId, entityType: 'ShopImage', entityId: imageId, action: 'create',
      summary: 'อัปโหลดรูปร้าน #' + shopId + ' (' + (payload.kind || 'store') + ')',
    });
    return (await profile.listShopImages(cn, shopId)).find(x => x.id === imageId) || null;
  });
}

async function deleteShopImage(imageId, userId) {
  return withConn(async cn => {
    await ensureShopExtraColumns(cn);
    const rec = await profile.getImageRecord(cn, imageId);
    if (!rec) return false;
    await profile.deleteShopImage(cn, imageId);
    await writeAudit({
      userId, entityType: 'ShopImage', entityId: imageId, action: 'delete',
      summary: 'ลบรูปร้าน #' + rec.shopId,
    });
    return true;
  });
}

async function getMediaFile(imageId) {
  return withConn(async cn => {
    await ensureShopExtraColumns(cn);
    const rec = await profile.getImageRecord(cn, imageId);
    if (!rec) return null;
    const fp = profile.absoluteImagePath(rec);
    if (!fs.existsSync(fp)) return null;
    return {
      path: fp,
      mime: rec.mime || 'application/octet-stream',
      originalName: rec.originalName || rec.storedName,
      sizeBytes: rec.sizeBytes,
    };
  });
}

async function reportSummary() {
  return withConn(async cn => {
    await ensureThaiTextRepaired(cn);
    await cn.query(`
      UPDATE Shops
      SET business_type = N'Cafe / Coffee Shop'
      WHERE business_type IS NOT NULL
        AND business_type LIKE N'Caf%'
        AND business_type LIKE N'%Coffee Shop%'
        AND business_type <> N'Cafe / Coffee Shop'
    `);
    const byTypeRaw = await cn.query(
      `SELECT ISNULL(business_type, N'(ไม่ระบุ)') AS businessType, COUNT(*) AS cnt FROM Shops GROUP BY business_type ORDER BY cnt DESC`
    );
    const byTypeMap = new Map();
    for (const r of byTypeRaw) {
      const key = r.businessType === '(ไม่ระบุ)'
        ? '(ไม่ระบุ)'
        : (normalizeBusinessType(r.businessType) || '(ไม่ระบุ)');
      byTypeMap.set(key, (byTypeMap.get(key) || 0) + Number(r.cnt || 0));
    }
    const byType = [...byTypeMap.entries()]
      .map(([businessType, cnt]) => ({ businessType, cnt }))
      .sort((a, b) => b.cnt - a.cnt);
    const byStatus = await cn.query(
      `SELECT c.name AS serviceName, c.code,
         SUM(CASE WHEN ss.status='Y' THEN 1 ELSE 0 END) AS y,
         SUM(CASE WHEN ss.status='E' THEN 1 ELSE 0 END) AS e,
         SUM(CASE WHEN ss.status='N' THEN 1 ELSE 0 END) AS n
       FROM ServiceCatalog c
       LEFT JOIN ShopServices ss ON ss.service_id = c.id
       GROUP BY c.id, c.name, c.code, c.sort_order
       ORDER BY c.sort_order`
    );
    const issues = await cn.query(
      `SELECT DISTINCT s.id,
              s.name AS name_raw,
              CONVERT(varchar(400), s.name) AS name_ansi,
              s.business_type AS businessType
       FROM Shops s
       JOIN ShopServices ss ON ss.shop_id = s.id
       WHERE ss.status = 'E'
       ORDER BY s.name`
    );
    return {
      byType,
      byStatus: byStatus.map(r => ({
        serviceName: r.serviceName,
        code: r.code,
        y: Number(r.y || 0),
        e: Number(r.e || 0),
        n: Number(r.n || 0),
      })),
      issues: issues.map(r => ({
        id: r.id,
        name: cleanShopName(pickThaiText(r.name_raw, r.name_ansi)),
        businessType: normalizeBusinessType(r.businessType || ''),
      })),
    };
  });
}

/** ดึงข้อมูลทั้งหมดสำหรับส่งออก Excel (ทีละชุด ไม่ยิง getShop ทีละร้าน) */
async function getExportBundle() {
  return withConn(async cn => {
    await ensureShopExtraColumns(cn);
    const catalog = await cn.query(
      'SELECT id, code, name, sort_order, allows_free_text FROM ServiceCatalog ORDER BY sort_order, id'
    );
    const hardware = await profile.listHardwareCatalog(cn);
    const baseRows = await cn.query(`
      SELECT s.id,
        s.name AS name_raw,
        CONVERT(varchar(400), s.name) AS name_ansi,
        CONVERT(varchar(10), s.start_date, 23) AS start_date,
        s.business_type, s.business_type_other, s.data_source,
        CAST(s.notes AS nvarchar(4000)) AS notes,
        CONVERT(varchar(400), CAST(s.notes AS nvarchar(4000))) AS notes_ansi,
        s.rest_id, s.rest_db,
        CONVERT(varchar(30), s.created_at, 126) AS created_at,
        CONVERT(varchar(30), s.updated_at, 126) AS updated_at,
        s.created_by, s.updated_by,
        0 AS cnt_y, 0 AS cnt_e, 0 AS cnt_n
      FROM Shops s
      ORDER BY s.name
    `);
    let profileRows = [];
    try {
      profileRows = await cn.query('SELECT ' + SHOP_PROFILE_COLS + ' FROM Shops');
    } catch (e) {
      console.warn('export profile cols', e.message || e);
    }
    const profileById = new Map(profileRows.map(r => [Number(r.id), r]));

    const svcRows = await cn.query(`
      SELECT s.id AS shopId, c.id AS serviceId, c.code, c.name,
             ISNULL(ss.status,'N') AS status, ss.status_note AS statusNote, ss.other_text AS otherText
      FROM Shops s
      CROSS JOIN ServiceCatalog c
      LEFT JOIN ShopServices ss ON ss.service_id = c.id AND ss.shop_id = s.id
      ORDER BY s.id, c.sort_order, c.id
    `);
    const servicesByShop = new Map();
    for (const r of svcRows) {
      const sid = Number(r.shopId);
      if (!servicesByShop.has(sid)) servicesByShop.set(sid, []);
      servicesByShop.get(sid).push({
        serviceId: Number(r.serviceId),
        code: r.code,
        name: r.name,
        status: String(r.status || 'N').trim().toUpperCase(),
        statusNote: r.statusNote || '',
        otherText: r.otherText || '',
      });
    }

    const hwRows = await cn.query(`
      SELECT sh.shop_id AS shopId, sh.hardware_id AS hardwareId, ISNULL(sh.qty, 0) AS qty
      FROM ShopHardware sh
    `).catch(() => []);
    const hardwareByShop = new Map();
    for (const r of hwRows) {
      const sid = Number(r.shopId);
      if (!hardwareByShop.has(sid)) hardwareByShop.set(sid, []);
      hardwareByShop.get(sid).push({
        hardwareId: Number(r.hardwareId),
        qty: Number(r.qty || 0),
      });
    }

    const shops = baseRows.map(r => {
      const id = Number(r.id);
      const shop = mapShop(Object.assign({}, r, profileById.get(id) || {}));
      shop.services = servicesByShop.get(id) || [];
      shop.hardware = hardwareByShop.get(id) || [];
      const y = shop.services.filter(x => x.status === 'Y').length;
      const e = shop.services.filter(x => x.status === 'E').length;
      const n = shop.services.filter(x => x.status === 'N').length;
      shop.serviceSummary = { Y: y, E: e, N: n };
      return shop;
    });

    // สรุป (reuse query pieces without nested withConn)
    const byTypeRaw = await cn.query(
      `SELECT ISNULL(business_type, N'(ไม่ระบุ)') AS businessType, COUNT(*) AS cnt FROM Shops GROUP BY business_type ORDER BY cnt DESC`
    );
    const byTypeMap = new Map();
    for (const r of byTypeRaw) {
      const key = r.businessType === '(ไม่ระบุ)'
        ? '(ไม่ระบุ)'
        : (normalizeBusinessType(r.businessType) || '(ไม่ระบุ)');
      byTypeMap.set(key, (byTypeMap.get(key) || 0) + Number(r.cnt || 0));
    }
    const byType = [...byTypeMap.entries()]
      .map(([businessType, cnt]) => ({ businessType, cnt }))
      .sort((a, b) => b.cnt - a.cnt);
    const byStatus = await cn.query(
      `SELECT c.name AS serviceName, c.code,
         SUM(CASE WHEN ss.status='Y' THEN 1 ELSE 0 END) AS y,
         SUM(CASE WHEN ss.status='E' THEN 1 ELSE 0 END) AS e,
         SUM(CASE WHEN ss.status='N' THEN 1 ELSE 0 END) AS n
       FROM ServiceCatalog c
       LEFT JOIN ShopServices ss ON ss.service_id = c.id
       GROUP BY c.id, c.name, c.code, c.sort_order
       ORDER BY c.sort_order`
    );
    const issues = await cn.query(
      `SELECT DISTINCT s.id,
              s.name AS name_raw,
              CONVERT(varchar(400), s.name) AS name_ansi,
              s.business_type AS businessType
       FROM Shops s
       JOIN ShopServices ss ON ss.shop_id = s.id
       WHERE ss.status = 'E'
       ORDER BY s.name`
    );

    return {
      shops,
      services: catalog.map(c => ({
        id: Number(c.id),
        code: c.code,
        name: c.name,
        sortOrder: Number(c.sort_order || 0),
      })),
      hardware,
      summary: {
        byType,
        byStatus: byStatus.map(r => ({
          serviceName: r.serviceName,
          code: r.code,
          y: Number(r.y || 0),
          e: Number(r.e || 0),
          n: Number(r.n || 0),
        })),
        issues: issues.map(r => ({
          id: r.id,
          name: cleanShopName(pickThaiText(r.name_raw, r.name_ansi)),
          businessType: normalizeBusinessType(r.businessType || ''),
        })),
      },
    };
  });
}

async function listLoginLogs(limit) {
  return withConn(async cn => {
    const rows = await cn.query(
      `SELECT TOP (${Number(limit) || 100}) id, user_id AS userId, username_attempted AS username, success, ip,
              CONVERT(varchar(30), created_at, 126) AS createdAt
       FROM LoginLog ORDER BY id DESC`
    );
    return rows.map(r => ({
      id: Number(r.id),
      userId: r.userId != null ? Number(r.userId) : null,
      username: r.username,
      success: !!r.success,
      ip: r.ip || '',
      createdAt: r.createdAt,
    }));
  });
}

async function listAuditLogs(limit) {
  return withConn(async cn => {
    await ensureThaiTextRepaired(cn);
    const rows = await cn.query(
      `SELECT TOP (${Number(limit) || 100}) a.id, a.user_id AS userId, u.username, a.entity_type AS entityType,
              a.entity_id AS entityId, a.action,
              a.summary AS summaryRaw,
              CONVERT(varchar(500), a.summary) AS summaryAnsi,
              CONVERT(varchar(30), a.created_at, 126) AS createdAt
       FROM AuditLog a
       LEFT JOIN Users u ON u.id = a.user_id
       ORDER BY a.id DESC`
    );
    return rows.map(r => ({
      id: Number(r.id),
      userId: r.userId != null ? Number(r.userId) : null,
      username: r.username || '',
      entityType: r.entityType,
      entityId: String(r.entityId),
      action: r.action,
      summary: pickThaiText(r.summaryRaw, r.summaryAnsi),
      createdAt: r.createdAt,
    }));
  });
}

async function ensureShopExtraColumns(cn) {
  const cols = await cn.query(`
    SELECT COLUMN_NAME AS n FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='Shops'
  `);
  const have = new Set(cols.map(c => String(c.n).toLowerCase()));
  if (!have.has('rest_id')) {
    await cn.query(`ALTER TABLE dbo.Shops ADD rest_id NVARCHAR(40) NULL`);
  }
  if (!have.has('rest_db')) {
    await cn.query(`ALTER TABLE dbo.Shops ADD rest_db NVARCHAR(200) NULL`);
  }
  await profile.ensureProfileSchema(cn);
}

function remoteConn(server, database) {
  return (
    'Driver={ODBC Driver 17 for SQL Server};Server=' + server +
    ';Database=' + (database || 'master') +
    ';UID=' + (process.env.DB_USER || 'uinet') +
    ';PWD=' + (process.env.DB_PASS || '') +
    ';Encrypt=' + (process.env.DB_ENCRYPT || 'yes') +
    ';TrustServerCertificate=yes;Login Timeout=8;'
  );
}

function sortServerKey(name) {
  const s = String(name || '').trim().toLowerCase();
  if (!s || s === '(ไม่ระบุ)') return '9_zzz_' + s;
  if (s.startsWith('tvsdb2')) return '0_' + s;
  if (s.startsWith('tvsdb1')) return '1_' + s;
  if (s.includes('thanvasupos.com')) return '2_' + s;
  if (/^\d{1,3}(\.\d{1,3}){3}/.test(s)) return '4_' + s;
  return '3_' + s;
}

function compareServers(a, b) {
  const ka = sortServerKey(a);
  const kb = sortServerKey(b);
  const pa = ka.slice(0, 1);
  const pb = kb.slice(0, 1);
  if (pa !== pb) return pa < pb ? -1 : 1;
  return String(a || '').localeCompare(String(b || ''), 'en', { numeric: true, sensitivity: 'base' });
}

/** เซิร์ฟเวอร์ที่ต้องโชว์ในดรอปดาวน์เสมอ (แม้ยังไม่มีร้าน) */
function alwaysShowServers() {
  const host = normalizeServerName(process.env.DB_HOST || 'tvsdb2.thanvasupos.com');
  const port = String(process.env.DB_PORT || '28914').trim();
  const primary = host.includes(',') ? host : (port ? host + ',' + port : host);
  return [primary].filter(s => isValidServerName(s));
}

/** จัดรูปชื่อเซิร์ฟเวอร์ให้สม่ำเสมอ (trim) */
function normalizeServerName(raw) {
  return String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
}

/** ชื่อร้านที่อ่านง่าย — ตัด NBSP / ตัวอักษรเพี้ยน / ช่องว่างเกิน */
function cleanShopName(raw) {
  let s = String(raw == null ? '' : raw);
  s = s.replace(/\u00A0/g, ' ');
  s = s.replace(/[\u200B\uFEFF]/g, '');
  // ย คั่นกลางที่เพี้ยนจาก NBSP ระหว่างคำอังกฤษ / รหัสสาขา
  s = s.replace(/([A-Za-z0-9])\s*ย\s+([A-Za-z0-9])/g, '$1 $2');
  s = s.replace(/\s*ย\s+(?=S\d)/gi, ' ');
  s = s.replace(/[ \t\f\v]+/g, ' ').trim();
  return s;
}

/** ชื่อที่ควรโชว์ในดรอปดาวน์เซิร์ฟเวอร์ (ตัดค่าขยะ/ทดสอบ) */
function isValidServerName(raw) {
  const s = normalizeServerName(raw);
  if (!s) return false;
  if (s === '.' || s === '(unknown)' || s === '(ไม่ระบุ)') return false;
  if (/^bd_/i.test(s)) return false;
  if (/^manual$/i.test(s)) return false;
  if (/fortest|not\s*del/i.test(s)) return false;
  if (/^thanvasuinfo$/i.test(s)) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}/.test(s)) return true;
  if (/[.\\]/.test(s)) return true;
  return false;
}

/**
 * รวมโฮสต์ *.thanvasupos.com ที่ไม่มีพอร์ต → เวอร์ชันที่มี ,28914
 * เฉพาะเมื่อในระบบมีทั้งสองแบบอยู่แล้ว
 */
async function normalizeShopServers(cn) {
  await cn.query(`
    UPDATE Shops SET data_source = LTRIM(RTRIM(data_source))
    WHERE data_source IS NOT NULL AND data_source <> LTRIM(RTRIM(data_source))
  `);
  await cn.query(`
    UPDATE s
    SET s.data_source = s.data_source + N',28914'
    FROM Shops s
    WHERE s.data_source LIKE N'%.thanvasupos.com'
      AND s.data_source NOT LIKE N'%,%'
      AND EXISTS (
        SELECT 1 FROM Shops x
        WHERE x.data_source = s.data_source + N',28914'
      )
  `);
  await cn.query(`
    UPDATE Shops
    SET data_source = N''
    WHERE data_source IN (N'.', N'ForTest Not Del')
       OR data_source LIKE N'ForTest%'
  `);

  // ทำความสะอาดชื่อร้านใน SQL (ไม่ดึงชื่อยาวผ่าน ODBC — กัน truncation)
  await cn.query(`
    UPDATE Shops SET name = REPLACE(name, NCHAR(160), N' ')
    WHERE name LIKE N'%' + NCHAR(160) + N'%'
  `);
  await cn.query(`
    UPDATE Shops SET name = REPLACE(name, N' ย ', N' ')
    WHERE name LIKE N'% ย S[0-9]%'
  `);
  await cn.query(`
    UPDATE Shops SET name = REPLACE(name, N'ย ', N' ')
    WHERE name LIKE N'%ย S[0-9]%'
  `);
  // ย คั่นกลางที่เพี้ยนจาก NBSP (เช่น La Meow ย Voucher)
  await cn.query(`
    UPDATE Shops SET name = REPLACE(name, N' ย ', N' ')
    WHERE name LIKE N'% ย %' AND name LIKE N'%[A-Za-z]%'
  `);
  for (let i = 0; i < 5; i += 1) {
    await cn.query(`
      UPDATE Shops SET name = REPLACE(name, N'  ', N' ')
      WHERE name LIKE N'%  %'
    `);
    const left = await cn.query(`SELECT COUNT(*) AS n FROM Shops WHERE name LIKE N'%  %'`);
    if (!Number(left[0] && left[0].n)) break;
  }
  await cn.query(`
    UPDATE Shops SET name = LTRIM(RTRIM(name))
    WHERE name IS NOT NULL AND name <> LTRIM(RTRIM(name))
  `);
}

async function listDataSources() {
  // ไม่ซิงก์ฐานข้อมูลจากเซิร์ฟเวอร์อัตโนมัติ — ใช้เฉพาะค่าที่มีใน BD_CSystem
  return withConn(async cn => {
    await ensureShopExtraColumns(cn);
    await normalizeShopServers(cn);
    const rows = await cn.query(`
      SELECT LTRIM(RTRIM(ISNULL(NULLIF(data_source, N''), N'(ไม่ระบุ)'))) AS dataSource, COUNT(*) AS cnt
      FROM Shops
      GROUP BY LTRIM(RTRIM(ISNULL(NULLIF(data_source, N''), N'(ไม่ระบุ)')))
    `);
    const map = new Map(rows.map(r => [String(r.dataSource), Number(r.cnt)]));

    return [...map.entries()]
      .map(([dataSource, count]) => ({
        dataSource,
        count,
        central: false,
        hostInventory: false,
        valid: isValidServerName(dataSource),
        label: dataSource,
      }))
      .filter(x => x.valid && x.dataSource !== '(ไม่ระบุ)')
      .sort((a, b) => compareServers(a.dataSource, b.dataSource));
  });
}

/** เซิร์ฟเวอร์โฮสต์ของระบบ (เช่น tvsdb2) — ซิงก์รายการฐานข้อมูลเป็นร้านที่แก้สถานะได้ */
function isHostInventoryServer(dataSource) {
  const s = normalizeServerName(dataSource);
  return alwaysShowServers().some(x => x === s);
}

/**
 * รายชื่อฐานข้อมูลบนเซิร์ฟเวอร์ (user databases เหมือน Object Explorer)
 */
async function listHostDatabases(dataSource) {
  const server = normalizeServerName(dataSource);
  if (!isHostInventoryServer(server)) {
    throw new Error('เซิร์ฟเวอร์นี้ไม่ได้แสดงรายการฐานข้อมูลโฮสต์');
  }
  return withConn(async cn => {
    const rows = await cn.query(`
      SELECT
        d.name AS name,
        d.state_desc AS stateDesc,
        d.compatibility_level AS compatibilityLevel,
        CONVERT(varchar(19), d.create_date, 120) AS createDate
      FROM sys.databases d
      WHERE d.name NOT IN (N'master', N'tempdb', N'model', N'msdb')
      ORDER BY d.name
    `);
    return rows.map(r => ({
      name: String(r.name),
      stateDesc: String(r.stateDesc || ''),
      compatibilityLevel: Number(r.compatibilityLevel || 0),
      createDate: r.createDate ? String(r.createDate) : '',
    }));
  });
}

/** ซิงก์ฐานข้อมูลบนโฮสต์ → Shops ให้กดเปิด/แก้ไขสถานะได้เหมือนเซิร์ฟเวอร์อื่น */
async function syncHostDatabaseShops(dataSource) {
  const server = normalizeServerName(dataSource);
  if (!isHostInventoryServer(server)) return { created: 0, updated: 0, removed: 0 };
  const dbs = await listHostDatabases(server);
  const names = new Set(dbs.map(d => d.name));

  return withConn(async cn => {
    await ensureShopExtraColumns(cn);
    let created = 0;
    let updated = 0;
    let removed = 0;

    for (const d of dbs) {
      const restId = 'host:' + d.name;
      const startDate = d.createDate ? String(d.createDate).slice(0, 10) : null;
      const notes = 'ฐานข้อมูลบน ' + server;
      const existing = await cn.query('SELECT id FROM Shops WHERE rest_id = ?', [restId]);
      if (existing.length) {
        await cn.query(
          `UPDATE Shops SET name=${sqlN(d.name)}, start_date=ISNULL(?, start_date), data_source=?, rest_db=?, notes=${sqlN(notes)},
             updated_at=${SQL_NOW_TH}, updated_by=1 WHERE id=?`,
          [startDate, server, d.name, existing[0].id]
        );
        updated += 1;
      } else {
        const ins = await cn.query(
          `INSERT INTO Shops (name, start_date, business_type, data_source, notes, rest_id, rest_db, created_by, updated_by)
           OUTPUT INSERTED.id AS id
           VALUES (${sqlN(d.name)}, ?, NULL, ?, ${sqlN(notes)}, ?, ?, 1, 1)`,
          [startDate, server, restId, d.name]
        );
        await seedShopServices(cn, ins[0].id, 1);
        created += 1;
      }
    }

    const stale = await cn.query(
      `SELECT id, rest_id FROM Shops WHERE data_source = ? AND rest_id LIKE N'host:%'`,
      [server]
    );
    for (const row of stale) {
      const dbName = String(row.rest_id || '').replace(/^host:/, '');
      if (!names.has(dbName)) {
        await cn.query('DELETE FROM Shops WHERE id = ?', [row.id]);
        removed += 1;
      }
    }

    return { created, updated, removed };
  });
}

/**
 * Import every Tbl_Rest row with data_source = RestServerName (SSMS-style server list),
 * then scan reachable servers for CFS_* DBs not already mapped.
 */
async function importFromThanvasuInfo() {
  const user = process.env.DB_USER || 'uinet';
  const pass = process.env.DB_PASS || '';
  if (!pass) throw new Error('ตั้ง DB_PASS ใน .env ก่อน (รหัสเชื่อมเซิร์ฟเวอร์)');

  const thanvasuConn =
    'Driver={ODBC Driver 17 for SQL Server};Server=' + (process.env.DB_HOST || 'tvsdb2.thanvasupos.com') +
    ',' + (process.env.DB_PORT || '28914') +
    ';Database=ThanvasuInfo;UID=' + user +
    ';PWD=' + pass +
    ';Encrypt=' + (process.env.DB_ENCRYPT || 'yes') +
    ';TrustServerCertificate=yes;';

  const src = await odbc.connect({ connectionString: thanvasuConn });
  let rests;
  try {
    rests = await src.query(`
      SELECT RestID, RestName, RestBranchNo, RestServerName, RestDBName,
             CONVERT(varchar(10), CreateDate, 23) AS CreateDate
      FROM dbo.Tbl_Rest
    `);
  } finally {
    try { await src.close(); } catch (e) {}
  }

  const allServerNames = new Set(
    rests.map(r => String(r.RestServerName || '').trim()).filter(Boolean)
  );

  function resolveImportServer(raw) {
    const base = normalizeServerName(raw);
    if (!isValidServerName(base)) return '';
    if (/^[\w.-]+\.thanvasupos\.com$/i.test(base) && allServerNames.has(base + ',28914')) {
      return base + ',28914';
    }
    return base;
  }

  let created = 0, updated = 0, deletedLegacy = 0;
  const servers = new Set();
  const mappedDbs = new Map(); // server -> Set(db lower)

  await withConn(async cn => {
    await ensureShopExtraColumns(cn);

    // remove old brand-grouped import that used data_source='ThanvasuInfo'
    const legacy = await cn.query(`
      SELECT id FROM Shops
      WHERE data_source = N'ThanvasuInfo' AND (rest_id IS NULL OR rest_id = N'')
    `);
    for (const row of legacy) {
      await cn.query('DELETE FROM Shops WHERE id = ?', [row.id]);
      deletedLegacy += 1;
    }

    const existing = await cn.query(`SELECT id, rest_id FROM Shops WHERE rest_id IS NOT NULL AND rest_id <> N''`);
    const byRestId = new Map(existing.map(r => [String(r.rest_id), r.id]));

    for (const r of rests) {
      const restId = String(r.RestID);
      const name = cleanShopName(r.RestName) || ('Rest ' + restId);
      const server = resolveImportServer(r.RestServerName);
      const dbName = String(r.RestDBName || '').trim() || null;
      const startDate = r.CreateDate ? String(r.CreateDate).slice(0, 10) : null;
      const noteParts = [];
      if (r.RestBranchNo != null && String(r.RestBranchNo).trim() !== '') {
        noteParts.push('สาขา: ' + String(r.RestBranchNo).trim());
      }
      if (dbName) noteParts.push('DB: ' + dbName);
      const notes = noteParts.join(' · ') || null;

      if (server) {
        servers.add(server);
        if (!mappedDbs.has(server)) mappedDbs.set(server, new Set());
        if (dbName) mappedDbs.get(server).add(dbName.toLowerCase());
      }

      const existId = byRestId.get(restId);
      if (existId) {
        await cn.query(
          `UPDATE Shops SET name=${sqlN(name)}, start_date=ISNULL(?, start_date), data_source=?, rest_db=?, notes=${sqlNOrNull(notes)},
             updated_at=${SQL_NOW_TH}, updated_by=1
           WHERE id=?`,
          [startDate, server, dbName, existId]
        );
        updated += 1;
      } else {
        const ins = await cn.query(
          `INSERT INTO Shops (name, start_date, business_type, data_source, notes, rest_id, rest_db, created_by, updated_by)
           OUTPUT INSERTED.id AS id
           VALUES (${sqlN(name)}, ?, NULL, ?, ${sqlNOrNull(notes)}, ?, ?, 1, 1)`,
          [startDate, server, restId, dbName]
        );
        const id = ins[0].id;
        await seedShopServices(cn, id, 1);
        byRestId.set(restId, id);
        created += 1;
      }
      if ((created + updated) % 100 === 0) {
        console.log('  rests', created + updated, '/', rests.length);
      }
    }
  });

  // Optional: scan reachable servers for CFS_* not in Tbl_Rest (noisy on shared hosts)
  let discovered = 0, serverOk = 0, serverFail = 0;
  const serverResults = [];
  const doDiscover = process.env.DISCOVER_EXTRA_DBS === '1';

  for (const server of [...servers].sort()) {
    if (!server || server === '.' || server === '(unknown)' || /fortest/i.test(server)) {
      serverResults.push({ server, ok: false, error: 'skipped' });
      continue;
    }
    let cn;
    try {
      cn = await odbc.connect({ connectionString: remoteConn(server, 'master') });
      serverOk += 1;
      let dbs = [];
      try {
        dbs = await cn.query(`
          SELECT name FROM sys.databases
          WHERE name LIKE 'CFS_%'
          ORDER BY name
        `);
      } catch (e) {
        serverResults.push({
          server, ok: true, dbs: 0,
          error: String(e.message || e).slice(0, 120),
        });
        continue;
      }

      if (!doDiscover) {
        serverResults.push({ server, ok: true, dbs: dbs.length, extras: 0, discover: false });
        continue;
      }

      const known = mappedDbs.get(server) || new Set();
      const extras = dbs.filter(d => !known.has(String(d.name).toLowerCase()));
      serverResults.push({ server, ok: true, dbs: dbs.length, extras: extras.length, discover: true });

      for (const d of extras) {
        try {
          await withConn(async csys => {
            await ensureShopExtraColumns(csys);
            const dbName = String(d.name);
            const exist = await csys.query(
              `SELECT id FROM Shops WHERE data_source = ? AND rest_db = ? AND (rest_id IS NULL OR rest_id LIKE N'disc:%')`,
              [server, dbName]
            );
            if (exist.length) return;
            const ins = await csys.query(
              `INSERT INTO Shops (name, data_source, notes, rest_id, rest_db, created_by, updated_by)
               OUTPUT INSERTED.id AS id
               VALUES (?, ?, ?, ?, ?, 1, 1)`,
              [
                dbName,
                server,
                'พบบนเซิร์ฟเวอร์ (ยังไม่อยู่ใน ThanvasuInfo.Tbl_Rest)',
                'disc:' + server.slice(0, 80) + ':' + dbName.slice(0, 80),
                dbName,
              ]
            );
            await seedShopServices(csys, ins[0].id, 1);
            discovered += 1;
          });
        } catch (e) {
          console.log('  discover skip', server, d.name, String(e.message || e).slice(0, 80));
        }
      }
    } catch (e) {
      serverFail += 1;
      serverResults.push({ server, ok: false, error: String(e.message || e).slice(0, 160) });
    } finally {
      if (cn) try { await cn.close(); } catch (e) {}
    }
  }

  return {
    rests: rests.length,
    created,
    updated,
    deletedLegacy,
    discovered,
    servers: servers.size,
    serverOk,
    serverFail,
    serverResults,
  };
}

module.exports = {
  CONN, BUSINESS_TYPES,
  hashPassword, verifyPassword, ensureAdmin, ensureUserAuthSchema,
  findUserByUsername, findUserById, findUserByEmail, listUsers, createUser, setUserActive, setUserEmail,
  createPasswordResetToken, getPasswordResetToken, resetPasswordWithToken, changePassword,
  getMailSettingsPublic, getMailConfig, saveMailSettings,
  logLogin, writeAudit,
  listCatalog, listShops, listDataSources, getShop, createShop, updateShop, deleteShop,
  listHardwareMeta, addShopImage, deleteShopImage, getMediaFile,
  reportSummary, getExportBundle, listLoginLogs, listAuditLogs, importFromThanvasuInfo, ensureShopExtraColumns,
  normalizeServerName, isValidServerName, normalizeShopServers, cleanShopName, compareServers,
  alwaysShowServers, isHostInventoryServer, listHostDatabases, syncHostDatabaseShops,
  syncShopNamesFromThanvasuInfo, normalizeBusinessType, pickThaiText, sqlN,
};
