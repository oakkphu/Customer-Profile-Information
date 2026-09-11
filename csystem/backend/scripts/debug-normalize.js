'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const odbc = require('odbc');
const store = require('../db');

(async () => {
  const cn = await odbc.connect({ connectionString: store.CONN });
  try {
    console.log('normalize…');
    try {
      await store.normalizeShopServers(cn);
      console.log('normalize ok');
    } catch (e) {
      console.error('normalize fail', e.message, e.odbcErrors);
    }

    console.log('dirty select…');
    try {
      const dirty = await cn.query(`
        SELECT TOP 5 id, name FROM Shops
        WHERE name LIKE N'%' + NCHAR(160) + N'%'
           OR name LIKE N'%ย%S%'
           OR name LIKE N'%  %'
      `);
      console.log('dirty rows', dirty.length);
      if (dirty[0]) console.log(JSON.stringify(dirty[0]));
    } catch (e) {
      console.error('dirty fail', e.message, e.odbcErrors);
    }
  } finally {
    await cn.close();
  }

  console.log('sync…');
  try {
    console.log(await store.syncHostDatabaseShops('tvsdb2.thanvasupos.com,28914'));
  } catch (e) {
    console.error('sync fail', e.message, e.odbcErrors);
  }

  console.log('listDataSources…');
  try {
    const ds = await store.listDataSources();
    console.log('sources', ds.length);
  } catch (e) {
    console.error('listDataSources fail', e.message, e.odbcErrors);
  }

  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
