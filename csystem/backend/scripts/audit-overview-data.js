'use strict';
const odbc = require('odbc');
const store = require('../db');
const profile = require('../profile');

function dump(v) {
  return JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? Number(x) : x), 2);
}

(async () => {
  const cn = await odbc.connect({ connectionString: store.CONN });
  try {
    const shops = await cn.query(`
      SELECT id, name, brand_name, business_type, branch_count,
             CAST(branch_names AS nvarchar(max)) AS branch_names
      FROM Shops ORDER BY id`);
    for (const s of shops) {
      const names = profile.parseBranchNames(s.branch_names);
      const listed = names.length;
      let declared = s.branch_count != null ? Number(s.branch_count) : 0;
      if (!Number.isFinite(declared) || declared < 0) declared = 0;
      const bc = (listed > 0 || declared > 0) ? Math.max(listed, declared) : 1;
      console.log('SHOP', dump({
        id: Number(s.id),
        name: s.name,
        nameCodes: [...String(s.name || '')].map(c => c.codePointAt(0).toString(16)),
        brand: s.brand_name,
        type: s.business_type,
        branch_count: s.branch_count,
        listed,
        computedBranches: bc,
        branchNames: names.map(b => b.name),
      }));
    }
    const imgs = await cn.query('SELECT id, shop_id, kind, stored_name FROM ShopImages ORDER BY id');
    console.log('IMAGES', dump(imgs.map(r => ({
      id: Number(r.id),
      shop: Number(r.shop_id),
      kind: r.kind,
      file: r.stored_name,
    }))));
  } finally {
    await cn.close();
  }
  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
