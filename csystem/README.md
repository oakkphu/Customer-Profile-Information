# CS System — THANVASU

ระบบ **Customer Profile** ภายใน: ข้อมูลลูกค้า · ระบบที่ใช้ (Checkbox) · Hardware · รูปภาพ  
ข้อมูลบันทึกใน **BD_CSystem** (ไม่ดึงอัตโนมัติจาก Database อื่น)

| ส่วน | โฟลเดอร์ | พอร์ต |
|------|----------|--------|
| Backend (API) | `backend/` | 3220 |
| Frontend (UI) | `frontend/` | 3230 |

## ติดตั้งครั้งแรก

```bash
cd csystem
# คัดลอก backend/.env.example → backend/.env แล้วใส่ DB_PASS
# (หรือใช้ .env.example ที่ราก csystem สำหรับ Docker/Coolify)
npm run install:all
# รัน backend/sql/setup.sql ใน SSMS (ครั้งแรก)
```

## รันระบบบนเครื่อง (dev)

```bash
cd csystem
npm start
```

หรือดับเบิลคลิก `start.cmd` / รัน `node start.js`

จากนั้นเปิด **http://localhost:3230**

- ผู้ใช้: `admin`
- รหัส: ค่า `ADMIN_PASSWORD` ใน `backend/.env` หรือ `admin123`

คำสั่งเดียวนี้จะเปิดทั้ง API และ UI พร้อมกัน (กด Ctrl+C หยุดทั้งคู่)

## ดูข้อมูลใน SSMS ให้อ่านง่าย

ตาราง `ShopServices` เก็บแค่ `shop_id` / `service_id` (ออกแบบถูกต้อง)  
เปิด **Views** แทน:

| View | ใช้ดูอะไร |
|------|-----------|
| `dbo.v_ShopServices` | **shop_id** + ชื่อร้าน + ชื่อระบบ + สถานะ Y/E/N + คำไทย |
| `dbo.v_Shops` | **shop_id** + ชื่อร้าน + นับจำนวน Y/E/N |

ตัวอย่าง:

```sql
SELECT shop_id, shop_name, service_name, status, status_th
FROM dbo.v_ShopServices
WHERE status IN ('Y','E')
ORDER BY shop_name;
```

## เปลี่ยนรหัสผ่าน

หลังเข้าสู่ระบบ กด **เปลี่ยนรหัสผ่าน** ที่แถบซ้าย — ใส่รหัสเดิมแล้วตั้งรหัสใหม่เอง

## สถานะระบบ (Y / E / N)

- **Y** = ใช้งานอยู่
- **E** = มีปัญหา / รอซ่อม
- **N** = ปิดชั่วคราว

## รันด้วย Docker บนเครื่อง (แนะนำ)

1. `copy .env.example .env` แล้วใส่ `DB_PASS` จริงใน `.env` (อย่า commit ไฟล์นี้)
2. ดับเบิลคลิก `run-docker.cmd` หรือรัน `docker compose up --build`
3. เปิด http://localhost:3001

Compose จะอ่าน `.env` ให้อัตโนมัติ — ไม่ต้องพิมพ์ `--env-file` เอง

## Deploy ด้วย Docker / Coolify / Kube

ไฟล์พร้อมใช้: `Dockerfile`, `docker-compose.yml`, `.env.example`

แอปฟัง **พอร์ตเดียวใน container** (`PORT=3000`): หน้าเว็บ + `/api/*`

### เก็บรูปถาวร

รูปเก็บใน **BD_CSystem** ตาราง `ShopImages.file_data` (VARBINARY) เป็นหลัก  
โฟลเดอร์ `uploads` เป็นแคชเสริมเท่านั้น — **redeploy / ลบ volume แล้วรูปยังอยู่** ถ้า DB ยังอยู่

สำรองข้อมูล: backup **BD_CSystem** ก็พอครอบคลุมรูปแล้ว  
(volume `/app/backend/uploads` ยังแนะนำไว้เพื่อแคชเร็ว แต่ไม่บังคับเพื่อความถาวร)

### Coolify / Rancher / Kube — ใส่ Env ยังไงให้ปลอดภัย

1. ตัวแปรทั่วไป → ประเภท **Key/Value Pair**  
   `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_ENCRYPT`, `PORT`, `DOCKER=1`, `ODBC_DRIVER=ODBC Driver 18 for SQL Server`, `COOKIE_SECURE=1`, `UPLOAD_ROOT=/app/backend/uploads`
2. รหัสลับ → ประเภท **Secret** (ถ้ามี)  
   `DB_PASS`, `APP_SESSION_SECRET`, `ADMIN_PASSWORD`
3. Save → Redeploy ( Persistent Storage สำหรับ uploads เป็นทางเลือก )
4. ดู log ต้องเป็น `DB_PASS=set`

อย่าพึ่งให้ระบบดึง `.env` จาก Git — รหัสจะหลุด

### ทดสอบ image เดี่ยวๆ

```bash
docker run --rm -p 3001:3000 --env-file .env ^
  thanvasu/web-cssystem:v1.0.4
```