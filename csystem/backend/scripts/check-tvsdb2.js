'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const odbc = require('odbc');
const store = require('../db');

function cs(db) {
  return (
    'Driver={ODBC Driver 17 for SQL Server};Server=' +
    (process.env.DB_HOST || 'tvsdb2.thanvasupos.com') + ',' +
    (process.env.DB_PORT || '28914') +
    ';Database=' + db +
    ';UID=' + (process.env.DB_USER || 'uinet') +
    ';PWD=' + (process.env.DB_PASS || '') +
    ';Encrypt=yes;TrustServerCertificate=yes;'
  );
}

(async () => {
  const cn = await odbc.connect({ connectionString: cs('ThanvasuInfo') });
  let rests;
  try {
    rests = await cn.query(
      'SELECT RestServerName AS s, COUNT(*) AS n FROM dbo.Tbl_Rest GROUP BY RestServerName ORDER BY RestServerName'
    );
    console.log('--- RestServerName ---');
    rests.forEach(r => console.log(r.n, JSON.stringify(r.s)));
    const hit = await cn.query(
      "SELECT COUNT(*) AS n FROM dbo.Tbl_Rest WHERE RestServerName LIKE '%tvsdb2%'"
    );
    console.log('tvsdb2 rows in Tbl_Rest:', hit[0].n);
  } finally {
    await cn.close();
  }

  const m = await odbc.connect({ connectionString: cs('master') });
  try {
    const dbs = await m.query(
      "SELECT name FROM sys.databases WHERE name LIKE 'CFS_%' OR name LIKE 'BD_%' OR name LIKE 'Thanvasu%' ORDER BY name"
    );
    console.log('--- dbs on tvsdb2 ---');
    dbs.forEach(d => console.log(d.name));
  } finally {
    await m.close();
  }

  const src = await store.listDataSources();
  console.log('--- CSystem sources ---');
  src.forEach(s => console.log(s.count, s.dataSource));
})().catch(e => {
  console.error(e);
  process.exit(1);
});
