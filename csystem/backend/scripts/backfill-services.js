'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const odbc = require('odbc');
const store = require('../db');

(async () => {
  const cn = await odbc.connect({ connectionString: store.CONN });
  try {
    const before = await cn.query('SELECT COUNT(*) AS n FROM ShopServices');
    await cn.query(`
      INSERT INTO ShopServices (shop_id, service_id, status, updated_by)
      SELECT s.id, c.id, 'N', 1
      FROM Shops s
      CROSS JOIN ServiceCatalog c
      WHERE NOT EXISTS (
        SELECT 1 FROM ShopServices ss WHERE ss.shop_id = s.id AND ss.service_id = c.id
      )
    `);
    const after = await cn.query('SELECT COUNT(*) AS n FROM ShopServices');
    const shops = await cn.query('SELECT COUNT(*) AS n FROM Shops');
    const cat = await cn.query('SELECT COUNT(*) AS n FROM ServiceCatalog');
    console.log({
      shops: shops[0].n,
      catalog: cat[0].n,
      servicesBefore: before[0].n,
      servicesAfter: after[0].n,
      expect: Number(shops[0].n) * Number(cat[0].n),
    });
  } finally {
    await cn.close();
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});
