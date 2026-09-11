'use strict';
const ExcelJS = require('exceljs');
const store = require('./db');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDD0636' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const Y_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
const E_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEDD5' } };
const N_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
const SOFT = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1F2' } };
const THIN = { style: 'thin', color: { argb: 'FFE5E7EB' } };

function statusCode(st) {
  const s = String(st || 'N').toUpperCase();
  return (s === 'Y' || s === 'E' || s === 'N') ? s : 'N';
}

function statusTh(st) {
  const s = statusCode(st);
  if (s === 'Y') return 'Y ใช้งาน';
  if (s === 'E') return 'E มีปัญหา';
  return 'N ปิดชั่วคราว';
}

function healthFlag(s) {
  const e = (s.serviceSummary && s.serviceSummary.E) || 0;
  if (e > 0) return 'มีปัญหา E';
  const y = (s.serviceSummary && s.serviceSummary.Y) || 0;
  if (y > 0) return 'ใช้งานปกติ';
  return 'ยังไม่เปิดระบบ';
}

function styleHeader(row) {
  row.eachCell(cell => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', wrapText: true, horizontal: 'center' };
  });
  row.height = 24;
}

function colLetter(n) {
  let s = '';
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function autosize(ws, max = 42) {
  (ws.columns || []).forEach(col => {
    let w = 12;
    col.eachCell({ includeEmpty: false }, cell => {
      const v = cell.value == null ? '' : (cell.value.formula ? 'xxxxxxxx' : String(cell.value));
      w = Math.min(max, Math.max(w, [...v].length + 2));
    });
    col.width = w;
  });
}

function addDataSheet(wb, name, headers, rows, opts) {
  opts = opts || {};
  const ws = wb.addWorksheet(String(name).slice(0, 31));
  const safeHeaders = headers.map((h, i) => String(h || ('คอลัมน์' + (i + 1))));
  const data = (rows || []).map(r => {
    const out = [];
    for (let i = 0; i < safeHeaders.length; i++) out.push(r[i] == null ? '' : r[i]);
    return out;
  });

  styleHeader(ws.addRow(safeHeaders));
  if (!data.length) {
    const empty = ws.addRow([ '(ยังไม่มีข้อมูลในชุดนี้)' ]);
    empty.getCell(1).font = { italic: true, color: { argb: 'FF6B7280' } };
  } else {
    data.forEach(r => {
      const excelRow = ws.addRow(r);
      excelRow.eachCell(cell => {
        cell.alignment = { vertical: 'middle', wrapText: true };
        cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN };
      });
    });
  }

  const lastRow = Math.max(2, data.length + 1);
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: lastRow, column: safeHeaders.length },
  };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  if (opts.colorStatusFromCol != null) {
    data.forEach((r, i) => {
      const st = String(r[opts.colorStatusFromCol - 1] || '').trim().charAt(0);
      const cell = ws.getRow(i + 2).getCell(opts.colorStatusFromCol);
      if (st === 'Y') cell.fill = Y_FILL;
      else if (st === 'E') cell.fill = E_FILL;
      else if (st === 'N') cell.fill = N_FILL;
    });
  }
  if (opts.colorHealthFromCol != null) {
    data.forEach((r, i) => {
      const v = String(r[opts.colorHealthFromCol - 1] || '');
      const cell = ws.getRow(i + 2).getCell(opts.colorHealthFromCol);
      if (v.includes('ปัญหา')) cell.fill = E_FILL;
      else if (v.includes('ปกติ')) cell.fill = Y_FILL;
      else cell.fill = N_FILL;
    });
  }

  autosize(ws);
  return ws;
}

async function exportShopsExcelBuffer() {
  const bundle = await store.getExportBundle();
  const shops = (bundle.shops || []).slice().sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), 'th')
  );
  const hwCatalog = bundle.hardware || [];
  const issueShops = shops.filter(s => ((s.serviceSummary && s.serviceSummary.E) || 0) > 0);
  const shopNames = shops.map(s => String(s.name || '').trim()).filter(Boolean);
  const businessTypes = [...new Set(shops.map(s => s.businessType || '(ไม่ระบุ)'))]
    .sort((a, b) => String(a).localeCompare(String(b), 'th'));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'CS System';
  wb.created = new Date();

  // Hidden lists feeding real Excel dropdowns
  const listWs = wb.addWorksheet('_รายการ', { state: 'hidden' });
  listWs.getCell('A1').value = 'ชื่อร้าน';
  shopNames.forEach((n, i) => { listWs.getCell(i + 2, 1).value = n; });
  listWs.getCell('B1').value = 'ประเภทธุรกิจ';
  businessTypes.forEach((n, i) => { listWs.getCell(i + 2, 2).value = n; });
  const shopListEnd = Math.max(2, shopNames.length + 1);
  const typeListEnd = Math.max(2, businessTypes.length + 1);

  const shopHeaders = [
    'ธงสุขภาพ', 'ลำดับ', 'ชื่อร้าน', 'แบรนด์', 'บริษัท (ไทย)', 'Company (EN)',
    'ประเภทธุรกิจ', 'จำนวนสาขา', 'วันเริ่มใช้',
    'เจ้าของ', 'ผู้ประสานงาน', 'เบอร์ผู้ประสาน', 'LINE',
    'Y ใช้งาน', 'E มีปัญหา', 'N ปิด', 'หมายเหตุ',
  ];
  const shopRows = shops.map((s, i) => ([
    healthFlag(s),
    i + 1,
    s.name || '',
    s.brandName || '',
    s.companyNameTh || '',
    s.companyNameEn || '',
    s.businessType || '(ไม่ระบุ)',
    s.branchCount != null ? Number(s.branchCount) : '',
    s.startDate || '',
    s.ownerName || '',
    s.contactName || '',
    s.contactPhone || '',
    s.contactLine || '',
    (s.serviceSummary && s.serviceSummary.Y) || 0,
    (s.serviceSummary && s.serviceSummary.E) || 0,
    (s.serviceSummary && s.serviceSummary.N) || 0,
    s.notes || '',
  ]));
  const dataLast = Math.max(2, shops.length + 1);

  // 1) Dropdown picker sheet FIRST
  {
    const ws = wb.addWorksheet('ดูตามร้าน');
    ws.views = [{ showGridLines: false }];

    ws.mergeCells('A1:G1');
    ws.getCell('A1').value = 'เลือกดูร้านจากข้อมูลที่ดาวน์โหลด';
    ws.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FFDD0636' } };

    ws.mergeCells('A2:G2');
    ws.getCell('A2').value = 'ใช้ช่อง Dropdown ด้านล่าง — รายชื่อดึงจากร้านในไฟล์นี้เท่านั้น (BD_CSystem)';
    ws.getCell('A2').font = { size: 11, color: { argb: 'FF6B7280' } };

    ws.getCell('A4').value = 'เลือกชื่อร้าน';
    ws.getCell('A4').font = { bold: true, size: 12 };
    ws.getCell('B4').value = shopNames[0] || '';
    ws.getCell('B4').fill = SOFT;
    ws.getCell('B4').font = { bold: true, size: 13 };
    ws.getCell('B4').border = {
      top: { style: 'medium', color: { argb: 'FFDD0636' } },
      left: { style: 'medium', color: { argb: 'FFDD0636' } },
      bottom: { style: 'medium', color: { argb: 'FFDD0636' } },
      right: { style: 'medium', color: { argb: 'FFDD0636' } },
    };
    ws.getCell('B4').dataValidation = {
      type: 'list',
      allowBlank: false,
      showErrorMessage: true,
      showInputMessage: true,
      promptTitle: 'เลือกร้าน',
      prompt: 'กดลูกศรด้านขวา แล้วเลือกจากรายชื่อร้านในไฟล์นี้',
      errorTitle: 'เลือกร้าน',
      error: 'กรุณาเลือกจากรายการ',
      formulae: ['=_รายการ!$A$2:$A$' + shopListEnd],
    };

    ws.getCell('A5').value = 'หรือเลือกประเภทธุรกิจ';
    ws.getCell('A5').font = { bold: true, size: 12 };
    ws.getCell('B5').value = '';
    ws.getCell('B5').fill = SOFT;
    ws.getCell('B5').border = {
      top: { style: 'thin', color: { argb: 'FFDD0636' } },
      left: { style: 'thin', color: { argb: 'FFDD0636' } },
      bottom: { style: 'thin', color: { argb: 'FFDD0636' } },
      right: { style: 'thin', color: { argb: 'FFDD0636' } },
    };
    ws.getCell('B5').dataValidation = {
      type: 'list',
      allowBlank: true,
      showInputMessage: true,
      promptTitle: 'กรองประเภท',
      prompt: 'ว่างไว้ได้ ถ้าเลือกชื่อร้านแล้ว',
      formulae: ['=_รายการ!$B$2:$B$' + typeListEnd],
    };

    ws.getCell('A7').value = 'ข้อมูลร้านที่เลือก (ดึงอัตโนมัติจาก Dropdown)';
    ws.getCell('A7').font = { bold: true, size: 13, color: { argb: 'FFB0052C' } };

    // Label | Value rows — INDEX/MATCH ใช้ได้กับ Excel ทั่วไป (ไม่ต้อง Excel 365)
    const detailPairs = [
      ['ธงสุขภาพ', 1],
      ['ชื่อร้าน', 3],
      ['แบรนด์', 4],
      ['บริษัท (ไทย)', 5],
      ['Company (EN)', 6],
      ['ประเภทธุรกิจ', 7],
      ['จำนวนสาขา', 8],
      ['วันเริ่มใช้', 9],
      ['เจ้าของ', 10],
      ['ผู้ประสานงาน', 11],
      ['เบอร์ผู้ประสาน', 12],
      ['LINE', 13],
      ['Y ใช้งาน', 14],
      ['E มีปัญหา', 15],
      ['N ปิด', 16],
      ['หมายเหตุ', 17],
    ];
    detailPairs.forEach((pair, i) => {
      const row = 8 + i;
      const labelCell = ws.getCell(row, 1);
      const valueCell = ws.getCell(row, 2);
      labelCell.value = pair[0];
      labelCell.font = { bold: true };
      labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      // MATCH ชื่อร้านในคอลัมน์ C ของชีต ร้านทั้งหมด แล้วดึงคอลัมน์ที่ต้องการ
      valueCell.value = {
        formula:
          'IF($B$4="","",(IFERROR(INDEX(ร้านทั้งหมด!' +
          colLetter(pair[1]) +
          '$2:' +
          colLetter(pair[1]) +
          '$' +
          dataLast +
          ',MATCH($B$4,ร้านทั้งหมด!$C$2:$C$' +
          dataLast +
          ',0)),"ไม่พบ")))',
      };
      valueCell.alignment = { wrapText: true, vertical: 'middle' };
      valueCell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN };
      labelCell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN };
    });

    ws.mergeCells('A25:B27');
    ws.getCell('A25').value =
      '1) กดลูกศรช่อง B4 เลือกร้านจากรายชื่อในไฟล์นี้\n' +
      '2) ถ้าอยากกรองหลายร้าน / ตามประเภท: ไปชีต "ร้านทั้งหมด" → กดลูกศรหัวตารางที่คอลัมน์ "ชื่อร้าน" หรือ "ประเภทธุรกิจ"\n' +
      '3) ช่อง B5 เป็นรายการประเภทธุรกิจอ้างอิง — กรองจริงใช้ที่ชีต ร้านทั้งหมด';
    ws.getCell('A25').alignment = { wrapText: true, vertical: 'top' };
    ws.getCell('A25').font = { size: 10, color: { argb: 'FF6B7280' } };
    ws.getRow(25).height = 48;

    ws.getColumn(1).width = 18;
    ws.getColumn(2).width = 48;
  }

  // 2) ร้านทั้งหมด + AutoFilter ลูกศรจริง
  addDataSheet(wb, 'ร้านทั้งหมด', shopHeaders, shopRows, { colorHealthFromCol: 1 });

  // 3) ร้านมีปัญหา E
  addDataSheet(wb, 'ร้านมีปัญหาE', [
    'ชื่อร้าน', 'ประเภทธุรกิจ', 'จำนวน E', 'ระบบที่มีปัญหา', 'ผู้ประสานงาน', 'เบอร์', 'LINE',
  ], issueShops.map(s => {
    const bad = (s.services || [])
      .filter(x => statusCode(x.status) === 'E')
      .map(x => (x.name || x.code) + (x.statusNote ? ' (' + x.statusNote + ')' : ''))
      .join(' · ');
    return [
      s.name || '',
      s.businessType || '(ไม่ระบุ)',
      (s.serviceSummary && s.serviceSummary.E) || 0,
      bad,
      s.contactName || '',
      s.contactPhone || '',
      s.contactLine || '',
    ];
  }));

  // 4) สาขา
  {
    const rows = [];
    shops.forEach(s => {
      const branches = (s.branches && s.branches.length) ? s.branches : [];
      if (!branches.length) {
        rows.push([s.name || '', s.businessType || '(ไม่ระบุ)', '(ยังไม่ระบุ)', '', '']);
        return;
      }
      branches.forEach(b => {
        rows.push([
          s.name || '',
          s.businessType || '(ไม่ระบุ)',
          b.name || '',
          b.province || '',
          b.mapUrl || '',
        ]);
      });
    });
    addDataSheet(wb, 'สาขา', ['ชื่อร้าน', 'ประเภทธุรกิจ', 'ชื่อสาขา', 'จังหวัด', 'ลิงก์แผนที่'], rows);
  }

  // 5) สถานะ Y/E เท่านั้น
  {
    const rows = [];
    shops.forEach(s => {
      (s.services || []).forEach(x => {
        const st = statusCode(x.status);
        if (st === 'N') return;
        rows.push([
          s.name || '',
          s.businessType || '(ไม่ระบุ)',
          x.name || x.code || '',
          st,
          statusTh(st),
          x.statusNote || '',
        ]);
      });
    });
    addDataSheet(wb, 'สถานะระบบ_YและE', [
      'ชื่อร้าน', 'ประเภทธุรกิจ', 'ระบบ', 'รหัส', 'สถานะ', 'หมายเหตุ',
    ], rows, { colorStatusFromCol: 4 });
  }

  // 6) Hardware
  {
    const headers = ['ชื่อร้าน', 'ประเภทธุรกิจ'].concat(hwCatalog.map(h => h.name || h.code || ''));
    const rows = shops.map(s => {
      const byId = new Map((s.hardware || []).map(h => [Number(h.hardwareId), Number(h.qty || 0)]));
      return [s.name || '', s.businessType || '(ไม่ระบุ)'].concat(
        hwCatalog.map(h => byId.get(Number(h.id)) || 0)
      );
    });
    addDataSheet(wb, 'Hardware', headers, rows);
  }

  // 7) สรุป
  {
    const rows = [
      ['จำนวนร้านทั้งหมด', shops.length],
      ['ร้านที่มีปัญหา E', issueShops.length],
    ];
    businessTypes.forEach(t => {
      rows.push(['ประเภท: ' + t, shops.filter(s => (s.businessType || '(ไม่ระบุ)') === t).length]);
    });
    addDataSheet(wb, 'สรุปตัวเลข', ['รายการ', 'จำนวน'], rows);
  }

  wb.views = [{ activeTab: 0 }];

  const out = await wb.xlsx.writeBuffer({ useStyles: true, useSharedStrings: true });
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

module.exports = {
  exportShopsExcelBuffer,
  CONTENT_TYPE: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  FILE_EXT: 'xlsx',
};
