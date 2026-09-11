'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const odbc = require('odbc');
const store = require('../db');

(async () => {
  const cn = await odbc.connect({ connectionString: store.CONN });
  try {
    const rows = await cn.query(`
      SELECT DISTINCT business_type AS t, COUNT(*) AS n
      FROM Shops GROUP BY business_type ORDER BY n DESC
    `);
    rows.forEach(r => {
      const t = r.t == null ? null : String(r.t);
      console.log(r.n, JSON.stringify(t));
      if (t && /caf/i.test(t)) {
        console.log('  codes', [...t].map(c => 'U+' + c.codePointAt(0).toString(16)).join(' '));
      }
    });
  } finally {
    await cn.close();
  }
  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
