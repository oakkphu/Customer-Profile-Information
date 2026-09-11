'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const odbc = require('odbc');

const USER = process.env.DB_USER || 'uinet';
const PASS = process.env.DB_PASS || 'p@$$w0rd';

function cs(server, database) {
  return (
    'Driver={ODBC Driver 17 for SQL Server};Server=' + server +
    ';Database=' + database +
    ';UID=' + USER + ';PWD=' + PASS +
    ';Encrypt=yes;TrustServerCertificate=yes;Login Timeout=10;'
  );
}

(async () => {
  const server = 'tvs12coffee.thanvasupos.com';
  const db = 'CFS_Coffee_HQ';
  const cn = await odbc.connect({ connectionString: cs(server, db) });
  try {
    const appish = await cn.query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE='BASE TABLE' AND (
        TABLE_NAME LIKE '%App%' OR TABLE_NAME LIKE '%Config%' OR TABLE_NAME LIKE '%Module%'
        OR TABLE_NAME LIKE '%KDS%' OR TABLE_NAME LIKE '%Kiosk%' OR TABLE_NAME LIKE '%CRM%'
        OR TABLE_NAME LIKE '%Self%' OR TABLE_NAME LIKE '%Book%' OR TABLE_NAME LIKE '%QTV%'
        OR TABLE_NAME LIKE '%Payment%' OR TABLE_NAME LIKE '%API%' OR TABLE_NAME LIKE '%Setting%'
      )
      ORDER BY TABLE_NAME
    `);
    console.log('interesting tables:', appish.map(r => r.TABLE_NAME).join(', '));

    for (const t of ['Tbl_AppPage', 'Tbl_BookConfig', 'Tbl_SystemConfig', 'Tbl_Config', 'Tbl_Shop', 'Tbl_Restaurant']) {
      try {
        const cols = await cn.query(`
          SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = ? ORDER BY ORDINAL_POSITION
        `, [t]);
        if (!cols.length) continue;
        console.log('\n##', t, 'cols:', cols.map(c => c.COLUMN_NAME).join(', '));
        const rows = await cn.query('SELECT TOP 8 * FROM dbo.[' + t.replace(/]/g, '') + ']');
        console.log(JSON.stringify(rows, null, 2).slice(0, 1500));
      } catch (e) {
        console.log(t, 'skip', String(e.message || e).slice(0, 100));
      }
    }
  } finally {
    await cn.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
