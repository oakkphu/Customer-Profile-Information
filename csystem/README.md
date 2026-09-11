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

## Deploy ด้วย Docker / Coolify

ไฟล์พร้อมใช้: `Dockerfile`, `docker-compose.yml`, `.env.example`

### Coolify

1. **New Resource → Dockerfile** (หรือ Docker Compose)
2. Git repo + **Base Directory / Build Context = `csystem`**
3. **Port = `3000`** (UI และ `/api` ในคอนเทนเนอร์เดียว)
4. Environment ตาม `.env.example` อย่างน้อย: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS`, `APP_SESSION_SECRET`, `ADMIN_PASSWORD`, `COOKIE_SECURE=1`
5. Persistent Storage → `/app/backend/uploads`
6. Deploy แล้วเปิดโดเมนจาก Coolify

เซิร์ฟเวอร์ Coolify ต้องเชื่อมต่อ SQL Server (`DB_HOST:DB_PORT`) ได้

### ทดสอบ Docker บนเครื่อง

```bash
cd csystem
cp .env.example .env   # ใส่ DB_PASS / secrets
docker compose up --build
# เปิด http://localhost:3000
```
