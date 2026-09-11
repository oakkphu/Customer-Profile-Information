'use strict';
const odbc = require('odbc');
const store = require('../db');

(async () => {
  await store.ensureAdmin();
  const cn = await odbc.connect({ connectionString: store.CONN });
  try {
    const r = await cn.query(`
      SELECT TOP 3 id, username_attempted,
             CONVERT(varchar(30), created_at, 120) AS created_at
      FROM LoginLog ORDER BY id DESC
    `);
    console.log('LoginLog latest:');
    r.forEach(x => console.log(' ', x.id, x.username_attempted, x.created_at));
    const n = await cn.query(`
      SELECT
        CONVERT(varchar(30), CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time' AS DATETIME2), 120) AS th,
        CONVERT(varchar(30), SYSUTCDATETIME(), 120) AS utc
    `);
    console.log('Now Thailand:', n[0].th);
    console.log('Now UTC:     ', n[0].utc);
  } finally {
    await cn.close();
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});
