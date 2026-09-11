'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const odbc = require('odbc');

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
  try {
    const cols = await cn.query(`
      SELECT COLUMN_NAME AS c, DATA_TYPE AS t
      FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Tbl_Rest'
      ORDER BY ORDINAL_POSITION
    `);
    console.log('Tbl_Rest columns:', cols.map(x => x.c).join(', '));

    const s2 = await cn.query(`
      SELECT RestServerName2 AS s, COUNT(*) AS n
      FROM dbo.Tbl_Rest
      GROUP BY RestServerName2
      ORDER BY n DESC
    `);
    console.log('\nRestServerName2:');
    s2.forEach(r => console.log(r.n, JSON.stringify(r.s)));

    const tvs = await cn.query(`
      SELECT RestID, RestName, RestServerName, RestServerName2, RestDBName
      FROM dbo.Tbl_Rest
      WHERE RestServerName LIKE '%tvsdb2%'
         OR RestServerName2 LIKE '%tvsdb2%'
         OR RestServerName LIKE '%28914%' AND RestServerName LIKE '%tvsdb%'
         OR ISNULL(RestServerName,'') IN ('.','')
      ORDER BY RestName
    `);
    console.log('\nrows related to tvsdb2 / empty server:', tvs.length);
    tvs.slice(0, 30).forEach(r => console.log(r.RestID, r.RestName, '|', r.RestServerName, '|', r.RestServerName2, '|', r.RestDBName));

    // sample of CreateDate / any HQ flag
    const sample = await cn.query(`
      SELECT TOP 5 RestID, RestName, RestServerName, RestServerName2, RestDBName
      FROM dbo.Tbl_Rest WHERE RestServerName2 IS NOT NULL AND LTRIM(RTRIM(RestServerName2)) <> ''
    `);
    console.log('\nsample with ServerName2:');
    sample.forEach(r => console.log(r));
  } finally {
    await cn.close();
  }

  // VIPCard / AIOffice quick peek
  for (const db of ['VIPCard', 'VIPCardDB', 'AIOffice', 'newtrc']) {
    try {
      const c = await odbc.connect({ connectionString: cs(db) });
      try {
        const t = await c.query(`
          SELECT TOP 25 TABLE_NAME AS n FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_TYPE='BASE TABLE'
            AND (TABLE_NAME LIKE '%Cust%' OR TABLE_NAME LIKE '%Rest%' OR TABLE_NAME LIKE '%Shop%'
              OR TABLE_NAME LIKE '%Member%' OR TABLE_NAME LIKE '%Client%')
          ORDER BY TABLE_NAME
        `);
        console.log('\n' + db + ':', t.map(x => x.n).join(', ') || '(no match)');
      } finally { await c.close(); }
    } catch (e) {
      console.log(db, 'fail', String(e.message || e).slice(0, 80));
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
