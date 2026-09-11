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
  console.log('CSystem .env host:', process.env.DB_HOST + ',' + process.env.DB_PORT);
  console.log('CSystem DB_NAME:', process.env.DB_NAME);

  const m = await odbc.connect({ connectionString: cs('master') });
  let dbs, srv;
  try {
    srv = await m.query('SELECT @@SERVERNAME AS srv, DB_NAME() AS db');
    dbs = await m.query(`
      SELECT name FROM sys.databases
      WHERE name NOT IN ('master','tempdb','model','msdb')
      ORDER BY name
    `);
  } finally { await m.close(); }
  console.log('Connected server:', srv[0].srv);
  console.log('User DBs on host:', dbs.length);
  const names = dbs.map(d => d.name);
  for (const need of ['ThanvasuInfo', 'BD_CSystem', 'BD_CRM_Center', 'VIPCard', 'AIOffice']) {
    console.log(' has', need, names.includes(need) ? 'YES' : 'NO');
  }

  const info = await odbc.connect({ connectionString: cs('ThanvasuInfo') });
  let restN, withTvsdb2;
  try {
    restN = await info.query('SELECT COUNT(*) AS n FROM dbo.Tbl_Rest');
    withTvsdb2 = await info.query(`
      SELECT COUNT(*) AS n FROM dbo.Tbl_Rest
      WHERE RestServerName LIKE '%tvsdb2%' OR RestServerName2 LIKE '%tvsdb2%'
    `);
  } finally { await info.close(); }
  console.log('ThanvasuInfo.Tbl_Rest rows:', restN[0].n);
  console.log('Tbl_Rest pointing RestServerName to tvsdb2:', withTvsdb2[0].n);

  const csys = await odbc.connect({ connectionString: store.CONN });
  let shops, catalog;
  try {
    shops = await csys.query('SELECT COUNT(*) AS n FROM dbo.Shops');
    catalog = await csys.query(`
      SELECT COUNT(*) AS n FROM dbo.Shops
      WHERE rest_id IS NOT NULL AND rest_id <> N'' AND rest_id NOT LIKE N'disc:%'
    `);
  } finally { await csys.close(); }
  console.log('BD_CSystem.Shops total:', shops[0].n);
  console.log('BD_CSystem catalog (ThanvasuInfo import):', catalog[0].n);

  const src = await store.listDataSources();
  const tvs = src.find(s => String(s.dataSource).includes('tvsdb2'));
  console.log('UI tvsdb2 filter:', tvs);
})().catch(e => { console.error(e); process.exit(1); });
