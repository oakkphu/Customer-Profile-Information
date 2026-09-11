'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const odbc = require('odbc');
const store = require('../db');

(async () => {
  const cs = store.CONN.replace(/Database=[^;]+/i, 'Database=ThanvasuInfo');
  const cn = await odbc.connect({ connectionString: cs });
  try {
    const rows = await cn.query(`
      SELECT RestName
      FROM dbo.Tbl_Rest
      WHERE RestName LIKE N'%La Meow%'
      ORDER BY RestName
    `);
    for (const r of rows) {
      const n = String(r.RestName || '');
      const mid = n.includes('ย') || /\sS\d/.test(n);
      if (!mid) continue;
      console.log(JSON.stringify(n));
    }
  } finally {
    await cn.close();
  }
  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
