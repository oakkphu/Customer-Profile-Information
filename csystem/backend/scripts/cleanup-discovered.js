'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const odbc = require('odbc');
const store = require('../db');

(async () => {
  const cn = await odbc.connect({ connectionString: store.CONN });
  try {
    await store.ensureShopExtraColumns(cn);
    const before = await cn.query("SELECT COUNT(*) AS n FROM Shops WHERE rest_id LIKE 'disc:%'");
    await cn.query("DELETE FROM Shops WHERE rest_id LIKE 'disc:%'");
    const after = await cn.query('SELECT COUNT(*) AS n FROM Shops');
    const by = await cn.query('SELECT data_source AS s, COUNT(*) AS n FROM Shops GROUP BY data_source ORDER BY s');
    console.log({ removedDisc: before[0].n, shopsNow: after[0].n });
    by.forEach(r => console.log(r.n, r.s));
  } finally {
    await cn.close();
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});
