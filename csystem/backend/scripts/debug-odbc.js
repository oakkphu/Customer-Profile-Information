'use strict';
const store = require('./db');
const odbc = require('odbc');
(async () => {
  const cn = await odbc.connect({ connectionString: store.CONN });
  console.log('connected');
  try {
    const a = await cn.query('SELECT COUNT(*) AS n FROM Shops');
    console.log('count', a);
  } catch (e) { console.error('count fail', e); }
  try {
    const b = await cn.query('SELECT TOP 1 * FROM ServiceCatalog ORDER BY id');
    console.log('catalog', b[0]);
  } catch (e) { console.error('catalog fail', e); }
  try {
    const c = await cn.query(
      `INSERT INTO Shops (name, start_date, business_type, data_source, created_by, updated_by)
       OUTPUT INSERTED.id AS id VALUES (?,?,?,?,?,?)`,
      ['Test Shop', '2026-01-01', 'Restaurant', 'manual', 1, 1]
    );
    console.log('insert', c);
  } catch (e) { console.error('insert fail', e.message, e.odbcErrors); }
  try {
    await cn.query(`INSERT INTO Shops (name) VALUES (?)`, ['Test Shop 2']);
    const id = await cn.query('SELECT MAX(id) AS id FROM Shops');
    console.log('insert2', id);
  } catch (e) { console.error('insert2 fail', e.message, e.odbcErrors); }
  await cn.close();
})().catch(e => console.error(e));
