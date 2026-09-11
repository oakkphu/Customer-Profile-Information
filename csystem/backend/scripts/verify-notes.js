'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const odbc = require('odbc');
const store = require('../db');

(async () => {
  const cn = await odbc.connect({ connectionString: store.CONN });
  try {
    const a = await cn.query(`
      SELECT TOP 5 id, CAST(notes AS nvarchar(400)) AS notes
      FROM Shops WHERE rest_id IS NOT NULL AND rest_id NOT LIKE N'host:%'
      ORDER BY id
    `);
    a.forEach(r => {
      const n = String(r.notes || '');
      console.log(r.id, JSON.stringify(n));
      console.log(' ', [...n.slice(0, 10)].map(c => 'U+' + c.codePointAt(0).toString(16)).join(' '));
    });

    const good = await cn.query(`SELECT COUNT(*) AS n FROM Shops WHERE notes LIKE N'%สาขา:%'`);
    console.log('notes with สาขา:', good[0].n);

    const badMoj = await cn.query(`
      SELECT COUNT(*) AS n FROM Shops
      WHERE notes LIKE N'%' + NCHAR(0x0E40) + NCHAR(0x0E18) + N'%'
    `);
    console.log('notes with เธ sequence:', badMoj[0].n);

    const sampleBad = await cn.query(`
      SELECT TOP 5 id, CAST(notes AS nvarchar(200)) AS notes
      FROM Shops
      WHERE notes LIKE N'%' + NCHAR(0x0E40) + NCHAR(0x0E18) + N'%'
      ORDER BY id
    `);
    sampleBad.forEach(r => console.log('bad?', r.id, JSON.stringify(r.notes)));

    const buddy = await cn.query(`
      SELECT id, name, CAST(notes AS nvarchar(300)) AS notes
      FROM Shops WHERE name LIKE N'%Buddy%' OR name LIKE N'%Suki Onsen%'
    `);
    buddy.forEach(r => console.log('buddy', r.id, r.name, '|', r.notes));
  } finally {
    await cn.close();
  }
  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
