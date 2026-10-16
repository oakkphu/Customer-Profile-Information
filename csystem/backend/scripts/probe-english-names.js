// probe: หาว่าชื่อภาษาอังกฤษของร้านเก็บอยู่คอลัมน์ไหน (ThanvasuInfo / BD_CSystem)
const odbc = require('odbc');
const store = require('../db');

const cs = (db) => store.CONN.replace(/Database=[^;]+/i, 'Database=' + db);

const TARGETS = ['กะทิครัวไทย', 'ข้าวต้มกุ๊ก', 'ข้าวต้มโฟนลิงค์', 'ชาบูอู๊ดเป็นต่อ', 'กัมบัตเตะ', 'ครบอรรถรส'];

(async () => {
  const src = await odbc.connect({ connectionString: cs('ThanvasuInfo') });
  try {
    const tables = await src.query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`);
    console.log('=== ตารางใน ThanvasuInfo ===');
    console.log(tables.map(t => t.TABLE_NAME).join(', '));

    for (const t of ['Tbl_Rest']) {
      const cols = await src.query(`
        SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = ? ORDER BY ORDINAL_POSITION`, [t]);
      console.log(`\n=== คอลัมน์ ${t} ===`);
      cols.forEach(c => console.log('   ', c.COLUMN_NAME, '(', c.DATA_TYPE, ')'));
    }

    // ค้นชื่อร้านเป้าหมายใน Tbl_Rest
    for (const name of TARGETS) {
      const rows = await src.query(`
        SELECT * FROM dbo.Tbl_Rest WHERE RestName LIKE ?`, ['%' + name + '%']);
      if (!rows.length) { console.log(`\n[Tbl_Rest] ไม่พบ: ${name}`); continue; }
      rows.slice(0, 3).forEach(r => {
        const pick = {};
        Object.keys(r).forEach(k => {
          const v = r[k];
          if (typeof v === 'string' && /[A-Za-z]/.test(v)) pick[k] = v;
        });
        console.log(`\n[Tbl_Rest] ${name} ->`, JSON.stringify(pick));
      });
    }
  } finally {
    try { await src.close(); } catch (e) {}
  }

  // ดูคอลัมน์ Shops ใน BD_CSystem ทั้งหมด เผื่อมีช่องชื่ออังกฤษที่ไม่ได้ใช้
  const all = await store.listShops({});
  console.log('\n=== BD_CSystem: สถิติช่องชื่อ ===');
  console.log('total', all.length,
    '| brand มี', all.filter(s => String(s.brandName || '').trim()).length,
    '| comEN มี', all.filter(s => String(s.companyNameEn || '').trim()).length);
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
