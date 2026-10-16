// probe: ดูทุกคอลัมน์ของร้านที่ยังไม่มีชื่อภาษาอังกฤษ ใน BD_CSystem
const odbc = require('odbc');
const store = require('../db');

const NAMES = ['กะทิครัวไทย', 'ข้าวต้มกุ๊ก', 'ข้าวต้มโฟนลิงค์', 'ชาบูอู๊ดเป็นต่อ', 'กัมบัตเตะ', 'ครบอรรถรส', 'ไซเซ ซากาบะ', 'เวิลด์ ออฟ เทสต์'];

(async () => {
  const cn = await odbc.connect({ connectionString: store.CONN });
  try {
    const rows = await cn.query(`
      SELECT id, name, brand_name, company_name_th, company_name_en,
             CONVERT(varchar(10), start_date, 23) AS start_date,
             business_type, data_source, rest_id, rest_db,
             CAST(notes AS nvarchar(2000)) AS notes,
             owner_name, contact_name, website_social,
             CAST(branch_names AS nvarchar(2000)) AS branch_names
      FROM dbo.Shops ORDER BY id DESC`);
    console.log('คอลัมน์ทั้งหมด:', Object.keys(rows[0] || {}).join(', '));
    console.log('');
    for (const n of NAMES) {
      const hit = rows.filter(r => String(r.name || '').includes(n));
      hit.forEach(r => {
        const filled = {};
        Object.keys(r).forEach(k => {
          const v = r[k];
          if (v == null) return;
          const s = String(v).trim();
          if (!s || s === '0') return;
          if (/^(20\d\d-|NULL)/.test(s)) return;
          filled[k] = s.length > 60 ? s.slice(0, 60) + '…' : s;
        });
        console.log(`--- ${n} (id=${r.id}) ---`);
        console.log(JSON.stringify(filled, null, 0));
        console.log('');
      });
    }
  } finally {
    try { await cn.close(); } catch (e) {}
  }
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
