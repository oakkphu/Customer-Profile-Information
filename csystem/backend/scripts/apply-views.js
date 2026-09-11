'use strict';
const fs = require('fs');
const path = require('path');
const odbc = require('odbc');
const store = require('../db');

(async () => {
  const sqlPath = path.join(__dirname, '..', 'sql', 'views-readable.sql');
  const raw = fs.readFileSync(sqlPath, 'utf8');
  const batches = raw.split(/^\s*GO\s*$/gim).map(s => s.trim()).filter(Boolean);
  const cn = await odbc.connect({ connectionString: store.CONN });
  try {
    for (const batch of batches) {
      await cn.query(batch);
    }
    const sample = await cn.query(`
      SELECT TOP 5 shop_name, service_name, status, status_th
      FROM dbo.v_ShopServices
      WHERE status IN ('Y','E')
      ORDER BY status, shop_name
    `);
    console.log('Views ready: v_ShopServices, v_Shops');
    sample.forEach(r => console.log(' ', r.status, r.status_th, '|', r.shop_name, '|', r.service_name));
  } finally {
    await cn.close();
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});
