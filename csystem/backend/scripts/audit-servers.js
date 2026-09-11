'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const odbc = require('odbc');
const store = require('../db');

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

function looksLikeServer(s) {
  const v = String(s || '').trim();
  if (!v) return false;
  if (v === '.' || v === '(ไม่ระบุ)' || v === '(unknown)') return false;
  if (/^BD_/i.test(v)) return false;
  if (/^manual$/i.test(v)) return false;
  if (/fortest/i.test(v)) return false;
  if (/^thanvasuinfo$/i.test(v)) return false;
  // host / IP / named instance
  if (/^\d{1,3}(\.\d{1,3}){3}/.test(v)) return true;
  if (/\./.test(v) || /\\/.test(v) || /,/.test(v)) return true;
  return false;
}

(async () => {
  const info = await odbc.connect({ connectionString: cs('ThanvasuInfo') });
  let rests;
  try {
    rests = await info.query(`
      SELECT RestID, RestName,
             LTRIM(RTRIM(ISNULL(RestServerName, N''))) AS s,
             LTRIM(RTRIM(ISNULL(RestDBName, N''))) AS db
      FROM dbo.Tbl_Rest
    `);
  } finally {
    await info.close();
  }

  const byId = new Map(rests.map(r => [String(r.RestID), r]));
  const restServerCounts = new Map();
  for (const r of rests) {
    const k = r.s || '(empty)';
    restServerCounts.set(k, (restServerCounts.get(k) || 0) + 1);
  }

  const shops = await store.listShops({});
  const bySrc = new Map();
  const mismatch = [];
  const junk = [];

  for (const s of shops) {
    const key = String(s.dataSource || '');
    bySrc.set(key, (bySrc.get(key) || 0) + 1);
    if (!looksLikeServer(key)) {
      junk.push(s);
    }
    if (!s.restId || String(s.restId).startsWith('disc:')) continue;
    const rest = byId.get(String(s.restId));
    if (!rest) {
      mismatch.push({ id: s.id, name: s.name, ds: key, restId: s.restId, issue: 'rest-missing' });
      continue;
    }
    const expected = String(rest.s || '').trim() || '(unknown)';
    if (key !== expected) {
      mismatch.push({
        id: s.id,
        name: s.name,
        ds: key,
        expected,
        restId: s.restId,
        issue: 'mismatch',
      });
    }
  }

  console.log('=== CSystem data_source ===');
  [...bySrc.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'en'))
    .forEach(([k, n]) => {
      const ok = looksLikeServer(k) ? 'OK ' : 'BAD';
      console.log(ok, String(n).padStart(4), JSON.stringify(k));
    });

  console.log('\n=== ThanvasuInfo RestServerName (suspect) ===');
  [...restServerCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'en'))
    .forEach(([k, n]) => {
      const ok = looksLikeServer(k) ? 'OK ' : 'BAD';
      console.log(ok, String(n).padStart(4), JSON.stringify(k));
    });

  console.log('\n=== mismatches Rest vs shop ===', mismatch.length);
  mismatch.slice(0, 30).forEach(m => console.log(JSON.stringify(m)));

  console.log('\n=== junk shops in CSystem ===', junk.length);
  for (const s of junk) {
    console.log(
      s.id,
      JSON.stringify(s.dataSource),
      'rest=' + s.restId,
      'db=' + s.restDb,
      s.name
    );
  }

  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
