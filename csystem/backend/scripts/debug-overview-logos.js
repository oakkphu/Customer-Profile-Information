'use strict';
const store = require('../db');
const odbc = require('odbc');

function dump(v) {
  return JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? Number(x) : x));
}

(async () => {
  const cn = await odbc.connect({ connectionString: store.CONN });
  try {
    const imgs = await cn.query(`
      SELECT TOP 20 id, shop_id, kind, stored_name, original_name
      FROM ShopImages ORDER BY id DESC`);
    console.log('ShopImages sample:');
    imgs.forEach(r => console.log(dump(r), 'types', typeof r.id, typeof r.shop_id));

    const ov = await store.brandBranchOverview({});
    console.log('\nTop brands logos:');
    (ov.topBrands || []).forEach(b => {
      console.log(b.rank, b.brandName, 'shopId=', b.shopId, typeof b.shopId, 'logo=', b.logoUrl);
    });
  } finally {
    await cn.close();
  }
  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
