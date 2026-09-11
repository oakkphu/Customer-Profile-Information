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
    ';Encrypt=yes;TrustServerCertificate=yes;Login Timeout=12;'
  );
}

(async () => {
  const master = await odbc.connect({ connectionString: cs('master') });
  let dbs;
  try {
    dbs = await master.query(`
      SELECT name FROM sys.databases
      WHERE name NOT IN ('master','tempdb','model','msdb')
      ORDER BY name
    `);
  } finally {
    await master.close();
  }
  console.log('=== databases on tvsdb2 ===');
  dbs.forEach(d => console.log(d.name));

  const interesting = dbs.map(d => d.name).filter(n =>
    /thanvasu|crm|customer|shop|rest|hq|csystem|air|pts|qr|identity|erp/i.test(n)
  );

  for (const dbName of interesting.slice(0, 18)) {
    console.log('\n##', dbName);
    try {
      const cn = await odbc.connect({ connectionString: cs(dbName) });
      try {
        const tables = await cn.query(`
          SELECT TOP 40 TABLE_SCHEMA + '.' + TABLE_NAME AS t
          FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_TYPE='BASE TABLE'
            AND (
              TABLE_NAME LIKE '%Rest%' OR TABLE_NAME LIKE '%Shop%' OR TABLE_NAME LIKE '%Customer%'
              OR TABLE_NAME LIKE '%Cust%' OR TABLE_NAME LIKE '%Branch%' OR TABLE_NAME LIKE '%Store%'
              OR TABLE_NAME LIKE '%Client%' OR TABLE_NAME LIKE '%Member%' OR TABLE_NAME LIKE '%Company%'
            )
          ORDER BY TABLE_NAME
        `);
        console.log('tables:', tables.map(x => x.t).join(', ') || '(none matched)');

        for (const t of tables.slice(0, 6)) {
          const name = String(t.t).split('.').pop();
          try {
            const cnt = await cn.query('SELECT COUNT(*) AS n FROM dbo.[' + name.replace(/]/g, '') + ']');
            const cols = await cn.query(`
              SELECT TOP 12 COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS
              WHERE TABLE_NAME = ? ORDER BY ORDINAL_POSITION
            `, [name]);
            console.log(' -', name, 'rows=' + cnt[0].n, 'cols=' + cols.map(c => c.c).join(','));
          } catch (e) {
            console.log(' -', name, 'err', String(e.message || e).slice(0, 80));
          }
        }
      } finally {
        await cn.close();
      }
    } catch (e) {
      console.log('connect fail', String(e.message || e).slice(0, 120));
    }
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});
