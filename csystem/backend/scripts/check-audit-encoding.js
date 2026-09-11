'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const odbc = require('odbc');
const store = require('../db');

(async () => {
  const rows = await store.listAuditLogs(20);
  for (const r of rows) {
    const s = String(r.summary || '');
    console.log('---');
    console.log('action', r.action, 'user', r.username);
    console.log('summary JSON', JSON.stringify(s));
    console.log('codes', [...s.slice(0, 40)].map(c => c + ' U+' + c.codePointAt(0).toString(16)).join(' | '));
  }

  // column type
  const cn = await odbc.connect({ connectionString: store.CONN });
  try {
    const cols = await cn.query(`
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, COLLATION_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME='AuditLog'
    `);
    console.log('\ncolumns', cols);

    // raw via CONVERT
    const raw = await cn.query(`
      SELECT TOP 3 id, summary,
        CONVERT(varchar(200), summary) AS asVarchar,
        UNICODE(LEFT(summary,1)) AS u1
      FROM AuditLog ORDER BY id DESC
    `);
    console.log('\nraw', raw.map(r => ({
      id: r.id,
      summary: r.summary,
      asVarchar: r.asVarchar,
      u1: r.u1,
    })));
  } finally {
    await cn.close();
  }
  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
