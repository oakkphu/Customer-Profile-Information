# Customer Profile Database — THANVASU

เว็บสำหรับดูข้อมูลโปรไฟล์ลูกค้า (Customer Profile Information — Internal Use Only) โดยแบ่งตามโครงของไฟล์ PDF:
ข้อมูลลูกค้า → ระบบที่ใช้กับ THANVASU → Hardware → Others (รูปภาพ)

## เริ่มใช้งาน

```bash
node server.js
```

เปิด `http://localhost:3210` ในเบราวเซอร์

- **รหัสผ่าน (ค่าเริ่ม)**: `thanvasu2026`
- เปลี่ยนรหัสผ่าน: ตั้ง environment variable ก่อนเริ่ม เช่น
  ```bash
  APP_PASSWORD=รหัสผ่านใหม่ node server.js
  ```
- เปลี่ยน port: `APP_PORT=4000 node server.js`

## โครงไฟล์

```
server.js              — เซิร์ฟเวอร์ (zero-dependency, Node.js ≥ 18)
public/index.html      — หน้าเว็บ
public/assets/app.js   — logic ฝั่ง client
public/assets/styles.css
data/db.json           — ข้อมูลลูกค้า (สร้างเองครั้งแรก)
data/uploads/          — รูปที่อัปโหลด
```

## ฟีเจอร์

- เข้าสู่ระบบด้วยรหัสผ่าน (session cookie, อายุ 12 ชม.)
- รายการลูกค้า: ค้นหา ชื่อ/บริษัท/เจ้าของ/เบอร์/อีเมล + กรองตามประเภทธุรกิจ
- หน้าแสดงข้อมูลลูกค้าแบบครบ (4 ส่วนตาม PDF)
- เพิ่ม/แก้ไข/ลบลูกค้า (wizard 4 ขันตอน)
- อัปโหลดรูป Logo (1–2) และรูปหน้าร้าน (3–5) — drag & drop หรือคลิก
- ข้อมูลทั้งหมดเก็บใน `data/db.json` (backup โดยคัดลอบไฟล์นี้ + โฟลเดอร์ `uploads`)

## หมาย

- ใช้กับภาษาไทยได้เต็มรูปแบบ (UTF-8)
- รูปถูกป้องกัน: ต้องเข้าสู่ระบบก่อนเห็น