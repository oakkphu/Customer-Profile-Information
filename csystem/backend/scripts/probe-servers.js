'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const odbc = require('odbc');

const USER = process.env.DB_USER || 'uinet';
const PASS = process.env.DB_PASS || 'p@$$w0rd';
const DRIVER = 'ODBC Driver 17 for SQL Server';

function connStr(server, database) {
  return (
    'Driver={' + DRIVER + '};Server=' + server +
    ';Database=' + (database || 'master') +
    ';UID=' + USER + ';PWD=' + PASS +
    ';Encrypt=yes;TrustServerCertificate=yes;Login Timeout=8;'
  );
}

async function probe(server, database) {
  const t0 = Date.now();
  try {
    const cn = await odbc.connect({ connectionString: connStr(server, database) });
    try {
      const info = await cn.query('SELECT DB_NAME() AS db, @@SERVERNAME AS srv');
      let tables = [];
      try {
        tables = await cn.query(`
          SELECT TOP 30 TABLE_SCHEMA + '.' + TABLE_NAME AS t
          FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_TYPE='BASE TABLE'
          ORDER BY TABLE_NAME
        `);
      } catch (e) {}
      return {
        ok: true,
        ms: Date.now() - t0,
        db: info[0] && info[0].db,
        srv: info[0] && info[0].srv,
        tables: tables.map(r => r.t),
      };
    } finally {
      try { await cn.close(); } catch (e) {}
    }
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: String(e.message || e).slice(0, 200) };
  }
}

(async () => {
  const central = connStr(
    (process.env.DB_HOST || 'tvsdb2.thanvasupos.com') + ',' + (process.env.DB_PORT || '28914'),
    'ThanvasuInfo'
  );
  const cn = await odbc.connect({ connectionString: central });
  let rows;
  try {
    rows = await cn.query(`
      SELECT RestServerName AS serverName, RestDBName AS dbName, COUNT(*) AS n
      FROM dbo.Tbl_Rest
      WHERE RestServerName IS NOT NULL AND LTRIM(RTRIM(RestServerName)) NOT IN ('.', '')
      GROUP BY RestServerName, RestDBName
      ORDER BY RestServerName, n DESC
    `);
  } finally {
    await cn.close();
  }

  const servers = [...new Set(rows.map(r => String(r.serverName || '').trim()))].filter(Boolean);
  console.log('servers', servers.length, 'server+db combos', rows.length);

  // probe each distinct server (master) + top db sample
  for (const s of servers) {
    const sampleDb = (rows.find(r => String(r.serverName).trim() === s) || {}).dbName;
    const master = await probe(s, 'master');
    console.log('\n===', s, '===');
    console.log('master:', master.ok ? 'OK ' + master.ms + 'ms srv=' + master.srv : 'FAIL ' + master.error);
    if (sampleDb) {
      const db = await probe(s, sampleDb);
      console.log('db', sampleDb + ':', db.ok ? 'OK tables=' + (db.tables || []).slice(0, 12).join(', ') : 'FAIL ' + db.error);
    }
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});
