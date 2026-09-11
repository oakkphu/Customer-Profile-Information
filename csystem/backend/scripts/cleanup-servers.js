'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const odbc = require('odbc');
const store = require('../db');

(async () => {
  const cn = await odbc.connect({ connectionString: store.CONN });
  try {
    // ย้อนพอร์ตที่เคยเติมผิดให้ tvs12coffee (ต้นทางไม่มี ,28914)
    await cn.query(`
      UPDATE Shops
      SET data_source = N'tvs12coffee.thanvasupos.com'
      WHERE data_source = N'tvs12coffee.thanvasupos.com,28914'
    `);
  } finally {
    await cn.close();
  }

  const ds = await store.listDataSources();
  console.log('=== dropdown (valid) ===');
  ds.filter(d => d.valid).forEach(d => console.log(String(d.count).padStart(4), d.dataSource));
  console.log('\n=== hidden (invalid) ===');
  ds.filter(d => !d.valid).forEach(d => console.log(String(d.count).padStart(4), d.dataSource));
  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
