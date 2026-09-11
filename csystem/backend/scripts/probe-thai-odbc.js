'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const odbc = require('odbc');
const store = require('../db');

function sqlN(str) {
  return "N'" + String(str == null ? '' : str).replace(/'/g, "''") + "'";
}

(async () => {
  const cn = await odbc.connect({ connectionString: store.CONN });
  try {
    const sample = 'ทดสอบเขียน Audit ภาษาไทย';
    const now = `CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time' AS DATETIME2)`;
    // A: param bind
    try {
      await cn.query(
        `INSERT INTO AuditLog (user_id, entity_type, entity_id, action, summary, created_at)
         VALUES (1, N'Test', N'0', N'test', ?, ${now})`,
        [sample]
      );
      console.log('A bind insert ok');
    } catch (e) {
      console.log('A bind fail', e.message);
    }

    // B: N' literal in SQL
    await cn.query(
      `INSERT INTO AuditLog (user_id, entity_type, entity_id, action, summary, created_at)
       VALUES (1, N'Test', N'1', N'test', ${sqlN(sample)}, ${now})`
    );
    console.log('B literal insert ok');

    // C: double cast read
    const rows = await cn.query(`
      SELECT TOP 5 id,
        summary AS rawNvarchar,
        CONVERT(varchar(500), summary) AS asVarchar,
        CAST(CAST(summary AS varchar(500)) AS nvarchar(500)) AS roundTrip
      FROM AuditLog
      WHERE entity_type = N'Test' OR id IN (SELECT TOP 3 id FROM AuditLog ORDER BY id DESC)
      ORDER BY id DESC
    `);
    for (const r of rows) {
      console.log({
        id: r.id,
        raw: r.rawNvarchar,
        asVarchar: r.asVarchar,
        roundTrip: r.roundTrip,
      });
    }

    await cn.query(`DELETE FROM AuditLog WHERE entity_type = N'Test'`);
  } finally {
    await cn.close();
  }
  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
