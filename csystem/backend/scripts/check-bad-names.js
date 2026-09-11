'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const odbc = require('odbc');
const store = require('../db');

function cs(db) {
  return store.CONN.replace(/Database=[^;]+/i, 'Database=' + db);
}

(async () => {
  const shops = await store.listShops({});
  const bad = shops.filter(s => {
    const n = String(s.name || '');
    return n.includes('\uFFFD') || /เธ|เน[€]/.test(n) || /รฉ|โ€/.test(n);
  });
  console.log('bad in listShops', bad.length);
  bad.slice(0, 30).forEach(s => console.log(s.id, s.restId, JSON.stringify(s.name), s.restDb));

  const cn = await odbc.connect({ connectionString: store.CONN });
  let raw;
  try {
    raw = await cn.query(`
      SELECT id, rest_id, name AS rawNvarchar,
             CONVERT(varchar(400), name) AS asAnsi
      FROM Shops
      WHERE name LIKE N'%' + NCHAR(65533) + N'%'
         OR name LIKE N'%เธ%'
         OR name LIKE N'%ศูนย์%'
         OR rest_db LIKE N'%Phunubdao%'
         OR rest_db LIKE N'%Namnam%'
      ORDER BY id
    `);
  } finally {
    await cn.close();
  }
  console.log('\nraw CSystem matches', raw.length);
  for (const r of raw.slice(0, 20)) {
    console.log('---', r.id, r.rest_id);
    console.log(' raw', JSON.stringify(r.rawNvarchar));
    console.log(' ansi', JSON.stringify(r.asAnsi));
  }

  // compare ThanvasuInfo
  const info = await odbc.connect({ connectionString: cs('ThanvasuInfo') });
  try {
    const rests = await info.query(`
      SELECT RestID, RestName, RestDBName,
             CONVERT(varchar(400), RestName) AS nameAnsi
      FROM dbo.Tbl_Rest
      WHERE RestDBName LIKE N'%Phunubdao%'
         OR RestName LIKE N'%นับดาว%'
         OR RestName LIKE N'%ศูนย์%'
         OR RestName LIKE N'%เดลิเวอรี่%'
    `);
    console.log('\nThanvasuInfo hits', rests.length);
    rests.forEach(r => {
      console.log(r.RestID, JSON.stringify(r.RestName), '/', JSON.stringify(r.nameAnsi), r.RestDBName);
    });
  } finally {
    await info.close();
  }
  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
