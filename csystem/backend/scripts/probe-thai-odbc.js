'use strict';
const path = require('path');
process.env.PREFER_DOTENV = '1';
const store = require('../db');
const odbc = require('odbc');

(async () => {
  const cn = await odbc.connect({ connectionString: store.CONN });
  try {
    const sample = 'ทดสอบเขียน Audit ภาษาไทย';
    const now = `CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time' AS DATETIME2)`;

    await cn.query(
      `INSERT INTO AuditLog (user_id, entity_type, entity_id, action, summary, created_at)
       VALUES (1, ${store.sqlN('Test')}, ${store.sqlN('hex')}, ${store.sqlN('test')}, ${store.sqlN(sample)}, ${now})`
    );
    console.log('hex insert ok');

    const rows = await cn.query(`
      SELECT TOP 3 id, summary AS rawNvarchar,
        CONVERT(varchar(500), summary) AS asVarchar
      FROM AuditLog
      WHERE entity_type = ${store.sqlN('Test')}
      ORDER BY id DESC
    `);
    for (const r of rows) {
      console.log({ id: Number(r.id), raw: r.rawNvarchar, asVarchar: r.asVarchar });
    }

    await cn.query(`DELETE FROM AuditLog WHERE entity_type = ${store.sqlN('Test')}`);
    console.log('cleanup ok');
  } finally {
    await cn.close();
  }
  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
