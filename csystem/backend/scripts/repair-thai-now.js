'use strict';
process.env.PREFER_DOTENV = '1';
const store = require('../db');

(async () => {
  const shops = await store.listShops({});
  console.log('shops loaded', shops.length);
  const logs = await store.listAuditLogs(15);
  for (const r of logs) {
    console.log(Number(r.id), r.action, '→', r.summary);
  }
  // raw DB check
  const odbc = require('odbc');
  const cn = await odbc.connect({ connectionString: store.CONN });
  try {
    const rows = await cn.query(`
      SELECT TOP 8 id, action, summary
      FROM AuditLog
      ORDER BY id DESC
    `);
    console.log('--- raw DB ---');
    for (const r of rows) {
      console.log(Number(r.id), r.action, JSON.stringify(r.summary));
    }
  } finally {
    await cn.close();
  }
  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
