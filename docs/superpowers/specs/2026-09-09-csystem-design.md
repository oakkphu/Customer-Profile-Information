# CSystem — Design Spec

**Date:** 2026-09-09  
**Status:** Approved in conversation (sections 1–3)  
**Approach:** Greenfield internal console (Approach 1) — not based on the existing Customer Profile app

## Goal

Internal THANVASU tool for staff to see **which shops use which systems**, maintain support status per module (**Y / E / N**), add/edit shop records, and run simple reports — with login and audit trails.

## Users

- **Admin** — full access: shops CRUD, reports, login logs, audit logs  
- **User** — view all shops; create/edit shops and service statuses; no delete; no admin log screens (unless later expanded)

## Non-goals (v1)

- Auto-sync from `ThanvasuInfo` or per-shop POS databases  
- Writing back to customer production DBs  
- Mobile app  
- Per-shop assignment of owners (Admin/User roles only)  
- Reusing or refactoring the existing Customer Profile codebase

## Architecture

```
Browser (CSystem UI)
    → Node.js HTTP API (session auth)
        → SQL Server BD_CSystem @ tvsdb2.thanvasupos.com,28914
```

- Secrets via environment variables (never committed)  
- Passwords stored hashed in `Users`  
- All mutating actions write `AuditLog`; logins write `LoginLog`

## Database: `BD_CSystem`

Server: `tvsdb2.thanvasupos.com,28914`

### `Users`
| Column | Notes |
|--------|--------|
| id | PK |
| username | unique |
| password_hash | |
| role | `Admin` \| `User` |
| is_active | |
| created_at, updated_at | |

### `Shops`
| Column | Notes |
|--------|--------|
| id | PK |
| name | shop display name |
| start_date | date service started |
| business_type | see catalog below |
| business_type_other | when Other |
| data_source | free text label of origin DB (whiteboard “DB1/DB2” example) |
| notes | optional |
| created_at, updated_at | |
| created_by, updated_by | user id |

### `ServiceCatalog`
Fixed list of modules (seed data):

1. App POS  
2. App KDS  
3. App Kiosk  
4. Web CRM  
5. App Cashier Ordering  
6. App Staff Ordering  
7. Web Self Ordering (Order Only)  
8. Web Self Ordering (Pay First)  
9. Web Self Ordering (Pay Later)  
10. Web Self Ordering (Pick Up)  
11. Web Booking  
12. Web QTV  
13. Web BI Dashboard  
14. Web Report  
15. ERP (KNAP / Others)  
16. Payment API (KBank / BBL / Others)  
17. Other system API  

| Column | Notes |
|--------|--------|
| id | PK |
| code | stable key |
| name | display name |
| sort_order | |
| allows_free_text | true for Other system API |

### `ShopServices`
One row per shop × catalog item.

| Column | Notes |
|--------|--------|
| shop_id | FK → Shops |
| service_id | FK → ServiceCatalog |
| status | **Y** \| **E** \| **N** |
| status_note | required/encouraged when E; optional otherwise |
| other_text | when service is Other system API |
| updated_at, updated_by | |

**Status meanings**
- **Y** — in active use  
- **E** — problem / awaiting repair / other issue  
- **N** — temporarily off  

**Default on new shop:** create all catalog rows with status **N**.

### `LoginLog`
| Column | Notes |
|--------|--------|
| id | PK |
| user_id | nullable if unknown user |
| username_attempted | |
| success | bit |
| ip | optional |
| created_at | |

### `AuditLog`
| Column | Notes |
|--------|--------|
| id | PK |
| user_id | who changed |
| entity_type | e.g. `Shop`, `ShopService` |
| entity_id | |
| action | `create` \| `update` \| `delete` |
| summary | short Thai/EN description |
| before_json | optional snapshot |
| after_json | optional snapshot |
| created_at | |

## Business type dropdown

- Restaurant — ร้านอาหาร  
- Café / Coffee Shop — คาเฟ่ / ร้านกาแฟ  
- Bar / Pub — บาร์ / ผับ  
- Bakery / Dessert Shop — ร้านเบเกอรี่ / ร้านขนม  
- Fast Food / Quick Service Restaurant (QSR) — ร้านอาหารจานด่วน  
- Food Court / Food Stall — ศูนย์อาหาร / ร้านอาหารแบบคีออส  
- Retail Store — ร้านค้าปลีก  
- Convenience Store — ร้านสะดวกซื้อ  
- Supermarket / Grocery Store — ซูเปอร์มาร์เก็ต / ร้านขายของชำ  
- Fashion / Apparel Store — ร้านเสื้อผ้า / แฟชั่น  
- Beauty / Cosmetics Store — ร้านเครื่องสำอาง  
- Salon / Spa — ร้านเสริมสวย / สปา  
- Pharmacy — ร้านขายยา  
- Hotel / Resort — โรงแรม / รีสอร์ต  
- Franchise — ธุรกิจแฟรนไชส์  
- Wholesale — ธุรกิจค้าส่ง  
- Service Business — ธุรกิจบริการ  
- Other — อื่น ๆ  

## Screens

### Login
Username + password → session; write `LoginLog`.

### Shop list (home)
Columns: Name, Start Date, Business type, Data source, Service summary (counts or chips of Y/E/N).  
Actions: search; filters (business type, data source, has any E, module=status); **+ Add shop**.

### Add / Edit shop
Fields: name, start date, business type (+ other), data source, notes.  
Module grid: each catalog row → Y/E/N + note; Other system API free text.  
Save → `Shops` + `ShopServices` + `AuditLog`.

### Shop detail
Read-optimized view with color status (Y green / E amber / N gray); Edit button; recent audit snippet optional.

### Reports
- Shops by business type  
- Per-module Y/E/N counts  
- List of shops with any **E**  
- Filters: date range / business type  
- Export CSV (v1)

### Admin logs (Admin only)
Login history + audit history (who changed what when).

## API (sketch)

- `POST /api/login`, `POST /api/logout`, `GET /api/me`  
- `GET/POST /api/shops`, `GET/PUT/DELETE /api/shops/:id` (DELETE Admin only)  
- `PUT /api/shops/:id/services`  
- `GET /api/meta` (business types + service catalog)  
- `GET /api/reports/summary`, `GET /api/reports/issues`  
- `GET /api/login-logs`, `GET /api/audit` (Admin)

## Tech stack

- New project folder / app (not extending Customer Profile UI)  
- Node.js ≥ 18 API  
- SQL Server via ODBC or `mssql` to `BD_CSystem`  
- Session cookie auth; password hashing (e.g. bcrypt/scrypt)  
- Env: `DB_*`, `APP_PORT`, session secret  

## Success criteria

- Staff can log in and see shops with module statuses at a glance  
- Staff can add/edit a shop and set each module to Y/E/N  
- Filters find shops by business type and problem status (E)  
- Every login and edit is attributable in logs  
- Data lives only in `BD_CSystem` on tvsdb2  

## Implementation note

After spec approval, create an implementation plan (schema SQL → auth → shops CRUD → services Y/E/N → reports → logs UI), then build in a new codebase path agreed with the team.
