'use strict';
const store = require('../db');
const odbc = require('odbc');
(async () => {
  const cn = await odbc.connect({ connectionString: store.CONN });
  const sql = `SELECT id, name,
    CONVERT(varchar(10), start_date, 23) AS start_date,
    business_type, business_type_other, data_source,
    CAST(notes AS nvarchar(4000)) AS notes,
    CONVERT(varchar(30), created_at, 126) AS created_at,
    CONVERT(varchar(30), updated_at, 126) AS updated_at,
    created_by, updated_by
  FROM Shops`;
  try {
    const r = await cn.query(sql);
    console.log('OK', r.length, r[0]);
  } catch (e) {
    console.log('FAIL', e.message, e.odbcErrors);
  }
  await cn.close();
})().catch(e => console.error(e));
