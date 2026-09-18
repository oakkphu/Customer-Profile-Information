'use strict';
const fs = require('fs');
const store = require('../db');

(async () => {
  for (const id of [1, 3, 5]) {
    const f = await store.getMediaFile(id);
    console.log('media', id, f ? { path: f.path, exists: fs.existsSync(f.path), mime: f.mime } : null);
  }
  const ov = await store.brandBranchOverview({});
  for (const b of ov.topBrands || []) {
    console.log(b.rank, b.brandName, b.logoUrl, 'shopId=', b.shopId);
  }
  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
