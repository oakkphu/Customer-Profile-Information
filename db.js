'use strict';
/* SQL Server data layer for Customer Profile Database
 * Uses Windows Authentication (Trusted_Connection) by default.
 * Override with env: DB_CONN_STRING (full ODBC connection string)
 */
const odbc = require('odbc');

const CONN_STRING = process.env.DB_CONN_STRING ||
  'Driver={ODBC Driver 17 for SQL Server};Server=' + (process.env.DB_HOST || '127.0.0.1') +
  ',' + (process.env.DB_PORT || '1433') + ';Database=' + (process.env.DB_NAME || 'CustomerProfileDB') +
  (process.env.DB_USER ? ';UID=' + process.env.DB_USER + ';PWD=' + (process.env.DB_PASS || '') : ';Trusted_Connection=Yes') + ';';

const JSON_COLS = ['branches', 'systems', 'hardware', 'logo', 'storefront'];
const DATE_COLS = ['created_at', 'updated_at'];

function rowToCustomer(r) {
  const c = {};
  for (const k of Object.keys(r)) {
    if (JSON_COLS.includes(k)) {
      try { c[k] = r[k] ? JSON.parse(r[k]) : (k === 'branches' || k === 'systems' ? [] : {}); }
      catch (e) { c[k] = k === 'branches' || k === 'systems' ? [] : {}; }
    } else if (DATE_COLS.includes(k)) {
      c[k] = r[k] ? (r[k] instanceof Date ? r[k].toISOString() : String(r[k])) : null;
    } else {
      c[k] = r[k];
    }
  }
  return c;
}

function customerToRow(c) {
  const row = {};
  for (const k of Object.keys(c)) {
    if (JSON_COLS.includes(k)) row[k] = JSON.stringify(c[k] || (k === 'branches' || k === 'systems' ? [] : {}));
    else if (DATE_COLS.includes(k)) row[k] = c[k] ? new Date(c[k]) : null;
    else row[k] = c[k];
  }
  return row;
}

const COLUMNS = [
  'id', 'code', 'shop_name_th', 'shop_name_en', 'company_name_th', 'company_name_en',
  'business_type', 'business_type_other', 'branch_count', 'branches', 'website',
  'owner_name', 'owner_nickname', 'owner_phone', 'coordinator_name', 'coordinator_nickname',
  'coordinator_phone', 'contact_email', 'start_date', 'systems', 'other_system_api',
  'system_flow', 'hardware', 'other_hardware', 'logo', 'storefront', 'created_at', 'updated_at',
];

async function withConn(fn) {
  const cn = await odbc.connect({ connectionString: CONN_STRING });
  try { return await fn(cn); }
  finally { try { await cn.close(); } catch (e) {} }
}

async function listCustomers() {
  return withConn(async cn => {
    const rows = await cn.query('SELECT * FROM Customers ORDER BY created_at');
    return rows.map(rowToCustomer);
  });
}

async function getCustomer(id) {
  return withConn(async cn => {
    const rows = await cn.query('SELECT * FROM Customers WHERE id = ?', [id]);
    return rows.length ? rowToCustomer(rows[0]) : null;
  });
}

async function insertCustomer(c) {
  return withConn(async cn => {
    const row = customerToRow(c);
    const cols = COLUMNS.filter(k => row[k] !== undefined);
    const sqlText = 'INSERT INTO Customers (' + cols.join(',') + ') VALUES (' + cols.map(() => '?').join(',') + ')';
    await cn.execute(sqlText, cols.map(k => row[k]));
    return c;
  });
}

async function updateCustomer(id, c) {
  return withConn(async cn => {
    const row = customerToRow(c);
    const cols = COLUMNS.filter(k => row[k] !== undefined && k !== 'id' && k !== 'code' && k !== 'created_at');
    const set = cols.map(k => k + ' = ?').join(', ');
    await cn.execute('UPDATE Customers SET ' + set + ' WHERE id = ?', cols.map(k => row[k]).concat([id]));
    return c;
  });
}

async function deleteCustomer(id) {
  return withConn(async cn => {
    await cn.execute('DELETE FROM Customers WHERE id = ?', [id]);
  });
}

async function nextCode() {
  return withConn(async cn => {
    const rows = await cn.query("SELECT ISNULL(MAX(CAST(SUBSTRING(code, 4, 10) AS INT)), 0) + 1 AS n FROM Customers WHERE code LIKE 'CU-%'");
    return 'CU-' + String(rows[0].n).padStart(4, '0');
  });
}

module.exports = { listCustomers, getCustomer, insertCustomer, updateCustomer, deleteCustomer, nextCode, CONN_STRING };