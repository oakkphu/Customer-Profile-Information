'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const odbc = require('odbc');

const USER = process.env.DB_USER || 'uinet';
const PASS = process.env.DB_PASS || 'p@$$w0rd';

function cs(server, database) {
  return (
    'Driver={ODBC Driver 17 for SQL Server};Server=' + server +
    ';Database=' + (database || 'master') +
    ';UID=' + USER + ';PWD=' + PASS +
    ';Encrypt=yes;TrustServerCertificate=yes;Login Timeout=10;'
  );
}

(async () => {
  const central = await odbc.connect({
    connectionString: cs(
      (process.env.DB_HOST || 'tvsdb2.thanvasupos.com') + ',' + (process.env.DB_PORT || '28914'),
      'ThanvasuInfo'
    ),
  });
  let mapped;
  try {
    mapped = await cnQuery(central, `
      SELECT RestServerName AS s, RestDBName AS d, RestName AS n
      FROM dbo.Tbl_Rest
      WHERE RestServerName = N'tvs12coffee.thanvasupos.com'
    `);
  } finally {
    await central.close();
  }

  const server = 'tvs12coffee.thanvasupos.com';
  const cn = await odbc.connect({ connectionString: cs(server, 'master') });
  let dbs;
  try {
    dbs = await cn.query(`
      SELECT name FROM sys.databases
      WHERE name LIKE 'CFS_%' OR name LIKE 'BD_%'
      ORDER BY name
    `);
  } finally {
    await cn.close();
  }

  const mappedSet = new Set(mapped.map(r => String(r.d || '').toLowerCase()));
  console.log('Tbl_Rest for', server, ':', mapped.length);
  console.log('CFS/BD dbs on server:', dbs.length);
  const onlyServer = dbs.filter(d => !mappedSet.has(String(d.name).toLowerCase()));
  const onlyMap = mapped.filter(r => !dbs.some(d => String(d.name).toLowerCase() === String(r.d || '').toLowerCase()));
  console.log('on server but not in Tbl_Rest:', onlyServer.length);
  onlyServer.slice(0, 15).forEach(d => console.log(' +', d.name));
  console.log('in Tbl_Rest but missing on server:', onlyMap.length);
  onlyMap.slice(0, 15).forEach(r => console.log(' -', r.d, r.n));
})().catch(e => { console.error(e); process.exit(1); });

async function cnQuery(cn, sql, params) {
  return params ? cn.query(sql, params) : cn.query(sql);
}
