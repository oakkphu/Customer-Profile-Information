# Customer Profile Database — THANVASU

เว็บภายในสำหรับดูและจัดการโปรไฟล์ลูกค้า (Internal Use Only) ตามโครงแบบฟอร์ม PDF:
**ข้อมูลลูกค้า → ระบบที่ใช้กับ THANVASU → Hardware → Others (รูปภาพ)**

## ความต้องการของระบบ

- **Node.js** ≥ 18
- **SQL Server** (LocalDB / Express / Full)
- **ODBC Driver 17 for SQL Server** (หรือใหม่กว่า ที่รองรับ connection string ใน `db.js`)
- Windows Authentication (ค่าเริ่ม) หรือ SQL login ผ่าน env

## ติดตั้งครั้งแรก

1. สร้างฐานข้อมูลและตาราง:

```bash
# ใน SSMS หรือ sqlcmd — รันไฟล์นี้ครั้งเดียว
sql/setup.sql
```

สร้าง DB `CustomerProfileDB` และตาราง `dbo.Customers`

2. ติดตั้ง dependency:

```bash
npm install
```

3. เริ่มเซิร์ฟเวอร์:

```bash
node server.js
```

เปิด [http://localhost:3210](http://localhost:3210)

- **รหัสผ่านค่าเริ่ม:** `thanvasu2026` — ควรเปลี่ยนทันทีในเครื่องจริง
- เปลี่ยนรหัสผ่าน: `APP_PASSWORD=รหัสใหม่ node server.js`
- เปลี่ยนพอร์ต: `APP_PORT=4000 node server.js`

## ตัวแปรสภาพแวดล้อม (ฐานข้อมูล)

ค่าเริ่มใน `db.js` ใช้ Trusted Connection ไปที่ `127.0.0.1:1433` / `CustomerProfileDB`

| ตัวแปร | ความหมาย |
|--------|----------|
| `DB_HOST` | โฮสต์ SQL (ค่าเริ่ม `127.0.0.1`) |
| `DB_PORT` | พอร์ต (ค่าเริ่ม `1433`) |
| `DB_NAME` | ชื่อ DB (ค่าเริ่ม `CustomerProfileDB`) |
| `DB_USER` / `DB_PASS` | ถ้าตั้ง `DB_USER` จะใช้ SQL login แทน Trusted Connection |
| `DB_CONN_STRING` | ODBC connection string เต็ม (ทับค่าอื่นทั้งหมด) |
| `APP_PASSWORD` | รหัสผ่านเข้าเว็บ |
| `APP_PORT` / `PORT` | พอร์ต HTTP (ค่าเริ่ม `3210`) |

ตัวอย่าง:

```bash
set DB_HOST=127.0.0.1
set APP_PASSWORD=รหัสผ่านใหม่
node server.js
```

## โครงไฟล์

```
server.js                 — HTTP server (auth, CRUD, upload)
db.js                     — SQL Server ผ่าน ODBC
sql/setup.sql             — สร้าง DB + ตาราง
public/index.html         — หน้าเว็บ
public/assets/app.js      — logic ฝั่ง client
public/assets/styles.css
data/uploads/             — รูปที่อัปโหลด (สร้างอัตโนมัติ)
```

> **หมายเหตุ:** เดิมเคยเก็บข้อมูลใน `data/db.json` — เลิกใช้แล้ว เหลือไว้เฉพาะกรณี migrate เก่าเท่านั้น ข้อมูลจริงอยู่ที่ SQL Server

## ฟีเจอร์

- เข้าสู่ระบบด้วยรหัสผ่าน (session cookie, อายุ 12 ชม.)
- รายการลูกค้า: ค้นหา ชื่อ/บริษัท/เจ้าของ/เบอร์/อีเมล + กรองประเภทธุรกิจ
- หน้ารายละเอียด 4 ส่วนตาม PDF
- เพิ่ม/แก้ไข/ลบ (wizard 4 ขั้นตอน)
- อัปโหลด Logo (1–2) และรูปหน้าร้าน (3–5)
- รองรับภาษาไทย (UTF-8); รูปต้อง login ก่อนดู

## สำรองข้อมูล

1. Backup ฐานข้อมูล `CustomerProfileDB` บน SQL Server
2. คัดลอกโฟลเดอร์ `data/uploads/`

## แก้ปัญหาเบื้องต้น

| อาการ | ตรวจ |
|-------|------|
| ข้อความ “เชื่อมต่อฐานข้อมูลไม่ได้…” | SQL รันอยู่หรือยัง, ODBC Driver 17, `DB_*` / firewall, รัน `sql/setup.sql` แล้วหรือยัง |
| `npm install` ล้มที่ `odbc` | ติดตั้ง build tools ตามที่แพ็กเกจ `odbc` ต้องการบน Windows |
| เข้าหน้าได้แต่ไม่มีรูป | มีไฟล์ใน `data/uploads/` และ login แล้ว |
