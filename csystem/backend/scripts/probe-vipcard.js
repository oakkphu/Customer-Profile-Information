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
  for (const db of ['VIPCard', 'VIPCardDB']) {
    const cn = await odbc.connect({ connectionString: cs(db) });
    try {
      const cols = await cn.query(`
        SELECT COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME='Members' ORDER BY ORDINAL_POSITION
      `);
      const n = await cn.query('SELECT COUNT(*) AS n FROM dbo.Members');
      const sample = await cn.query('SELECT TOP 3 * FROM dbo.Members');
      console.log('\n' + db + '.Members', 'count=' + n[0].n);
      console.log('cols', cols.map(c => c.c).join(', '));
      console.log(JSON.stringify(sample, (_k, v) => typeof v === 'bigint' ? Number(v) : v, 2).slice(0, 1200));
    } finally {
      await cn.close();
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
