'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const odbc = require('odbc');
const store = require('../db');

(async () => {
  const cn = await odbc.connect({ connectionString: store.CONN });
  try {
    const long = await cn.query(`
      SELECT TOP 20 id, LEN(data_source) AS n, data_source
      FROM Shops
      WHERE data_source IS NOT NULL
      ORDER BY LEN(data_source) DESC
    `);
    long.forEach(r => console.log(r.n, JSON.stringify(r.data_source)));

    console.log('--- step1 trim ---');
    await cn.query(`
      UPDATE Shops SET data_source = LTRIM(RTRIM(data_source))
      WHERE data_source IS NOT NULL AND data_source <> LTRIM(RTRIM(data_source))
    `);
    console.log('ok1');

    console.log('--- step2 merge port ---');
    await cn.query(`
      UPDATE s
      SET s.data_source = s.data_source + N',28914'
      FROM Shops s
      WHERE s.data_source LIKE N'%.thanvasupos.com'
        AND s.data_source NOT LIKE N'%,%'
        AND EXISTS (
          SELECT 1 FROM Shops x
          WHERE x.data_source = s.data_source + N',28914'
        )
    `);
    console.log('ok2');

    console.log('--- step3 junk ---');
    await cn.query(`
      UPDATE Shops
      SET data_source = N''
      WHERE data_source IN (N'.', N'ForTest Not Del')
         OR data_source LIKE N'ForTest%'
    `);
    console.log('ok3');
  } catch (e) {
    console.error('fail', e.message, e.odbcErrors);
  } finally {
    await cn.close();
  }
  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
