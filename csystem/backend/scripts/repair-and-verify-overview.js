'use strict';
const odbc = require('odbc');
const store = require('../db');
const profile = require('../profile');

(async () => {
  const cn = await odbc.connect({ connectionString: store.CONN });
  try {
    const shops = await cn.query('SELECT id, name, brand_name FROM Shops');
    let nameFixed = 0;
    for (const s of shops) {
      const id = Number(s.id);
      const name = store.cleanShopName ? store.cleanShopName(s.name) : String(s.name || '');
      // cleanShopName may not be exported — inline
      let n = String(s.name || '').replace(/\u0E19\u0E4D\u0E47\u0E32/g, 'น้ำ');
      let b = String(s.brand_name || '').replace(/\u0E19\u0E4D\u0E47\u0E32/g, 'น้ำ');
      if (n !== String(s.name || '') || b !== String(s.brand_name || '')) {
        await cn.query(
          'UPDATE Shops SET name = ?, brand_name = ? WHERE id = ?',
          [n, b || null, id]
        );
        nameFixed += 1;
        console.log('fixed name shop', id, n);
      }
    }
    console.log('names repaired:', nameFixed);

    const rows = await cn.query('SELECT id, CAST(branch_names AS nvarchar(max)) AS bn FROM Shops WHERE branch_names IS NOT NULL');
    let fixed = 0;
    for (const r of rows) {
      const before = String(r.bn || '');
      const branches = profile.parseBranches(before);
      const after = profile.serializeBranches(branches);
      if (after && after !== before) {
        await cn.query('UPDATE Shops SET branch_names = ? WHERE id = ?', [after, Number(r.id)]);
        fixed += 1;
        console.log('fixed branches shop', Number(r.id), after);
      }
    }
    console.log('branch rows repaired:', fixed);

    const ov = await store.brandBranchOverview({});
    console.log(JSON.stringify({
      totalBrands: ov.totalBrands,
      totalBranches: ov.totalBranches,
      totalBusinessTypes: ov.totalBusinessTypes,
      totalShops: ov.totalShops,
      sumBrandType: ov.brandsByType.reduce((n, x) => n + x.count, 0),
      sumBranchType: ov.branchesByType.reduce((n, x) => n + x.count, 0),
      brandsByType: ov.brandsByType,
      branchesByType: ov.branchesByType,
      topBrands: ov.topBrands.map(b => ({
        rank: b.rank, brand: b.brandName, branches: b.branches, shops: b.shopCount, logo: b.logoUrl,
      })),
    }, null, 2));
  } finally {
    await cn.close();
  }
  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
