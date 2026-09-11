'use strict';
const store = require('../db');
const odbc = require('odbc');
const fs = require('fs');
const path = require('path');

(async () => {
  const cn = await odbc.connect({ connectionString: store.CONN });
  try {
    await store.ensureShopExtraColumns(cn);
    const before = await cn.query('SELECT COUNT(*) AS n FROM Shops');
    const imported = await cn.query(`
      SELECT COUNT(*) AS n FROM Shops
      WHERE rest_id IS NOT NULL AND LTRIM(RTRIM(CAST(rest_id AS nvarchar(80)))) <> N''
    `);
    const manual = await cn.query(`
      SELECT COUNT(*) AS n FROM Shops
      WHERE rest_id IS NULL OR LTRIM(RTRIM(CAST(rest_id AS nvarchar(80)))) = N''
    `);
    console.log('before', {
      total: Number(before[0].n),
      imported: Number(imported[0].n),
      manual: Number(manual[0].n),
    });

    // ลบร้านที่มาจากดึง Database (มี rest_id) — รวม ThanvasuInfo / host inventory
    await cn.query(`
      DELETE FROM Shops
      WHERE rest_id IS NOT NULL AND LTRIM(RTRIM(CAST(rest_id AS nvarchar(80)))) <> N''
    `);

    // เคลียร์ data_source ที่เป็นชื่อเซิร์ฟเวอร์ค้างบนร้านที่เหลือ (ถ้ามี)
    await cn.query(`
      UPDATE Shops
      SET data_source = NULL, rest_db = NULL, updated_at = CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time' AS DATETIME2)
      WHERE data_source IS NOT NULL
        AND (
          data_source LIKE N'%.thanvasupos.com%'
          OR data_source LIKE N'tvsdb%'
          OR data_source LIKE N'%,28914%'
        )
    `);

    const after = await cn.query('SELECT COUNT(*) AS n FROM Shops');
    console.log('after', { total: Number(after[0].n) });

    // ลบโฟลเดอร์อัปโหลดที่ไม่มีร้านแล้ว
    const uploadRoot = path.join(__dirname, '..', 'uploads');
    if (fs.existsSync(uploadRoot)) {
      const ids = await cn.query('SELECT id FROM Shops');
      const keep = new Set(ids.map(r => 'shop-' + Number(r.id)));
      for (const name of fs.readdirSync(uploadRoot)) {
        if (!name.startsWith('shop-')) continue;
        if (!keep.has(name)) {
          fs.rmSync(path.join(uploadRoot, name), { recursive: true, force: true });
          console.log('removed uploads', name);
        }
      }
    }
  } finally {
    await cn.close();
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});
