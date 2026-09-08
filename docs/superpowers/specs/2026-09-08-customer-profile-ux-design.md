# Customer Profile Database — UX Polish & Ready-to-Use Design

**Date:** 2026-09-08  
**Status:** Approved (conversation)  
**Approach:** Polish on existing vanilla stack (`server.js` + `public/` + SQL via `db.js`)

## Goal

Make the THANVASU Customer Profile Database **pleasant and fast for daily internal use**, and **runnable with clear setup**, without changing the data model, auth model, or API contracts in a breaking way.

## Non-goals (this round)

- Multi-user roles / per-user accounts
- Export PDF / Excel
- Rewrite to React or another framework
- Changing SQL schema columns or customer field semantics
- New features beyond usability/setup (e.g. audit log, email)

## Current baseline

- Password gate + 12h session cookie
- Customer list with search + business-type filter
- Detail view in 4 PDF-aligned sections
- 4-step create/edit wizard + image upload
- Data in SQL Server (`CustomerProfileDB.dbo.Customers`); uploads under `data/uploads/`
- README still partially describes legacy `data/db.json` storage

## Design principles

1. **Internal tool, not marketing site** — calm, dense-enough information; one clear job per screen.
2. **Preserve existing flows** — same routes/hashes (`#`, `#c/:id`, `#new`, `#edit/:id`), same API paths.
3. **Thai-first readability** — labels, empty states, and errors in clear Thai.
4. **Fail loudly on setup** — if SQL is unreachable, show actionable error instead of a blank/boot hang.

## Visual direction

| Token | Choice |
|-------|--------|
| Brand | Deep navy / blue aligned with existing THANVASU internal feel (`#1e2a52` / `#2563eb` family) |
| Surface | Soft cool gray page background; white panels with light border (keep card pattern only where it aids scanning lists/forms) |
| Type | Keep Thai-capable stack; tighten hierarchy (page title > section > field label) |
| Chrome | Reduce decorative emoji in primary chrome; keep functional icons sparingly |
| Motion | Subtle hover on list cards; toast/lightbox already present — no heavy animation |

Avoid purple-gradient “AI default” look; stay on the existing blue system and refine it.

## Screen designs

### 1. Login

- Keep centered card on branded gradient.
- Clear product name: **Customer Profile Database — THANVASU**.
- Password field + submit; error banner on wrong password.
- Hint text: how to change password via `APP_PASSWORD` (short), not the default password in production docs only.

### 2. List (home)

- Sticky topbar: brand, “รายการลูกค้า”, “เพิ่มลูกค้า”, “ออกจากระบบ”.
- Search input primary; business-type select secondary.
- Customer cards: logo/placeholder, shop name, code badge, business type, owner/contact snippet, start date.
- Empty: no customers → CTA to create first.
- Empty search: “ไม่พบรายการ” with clear filters affordance (clear search/filter).
- Keep live filter without losing search focus (`refreshListOnly` behavior).

### 3. Detail

- Back link → list.
- Hero: logo, names, code, type, branch count; actions Edit / Delete.
- Four panels matching PDF:
  1. ข้อมูลลูกค้า  
  2. ระบบที่ใช้กับ THANVASU (+ System Flow)  
  3. Hardware  
  4. Others — รูปภาพ (logo 1–2, storefront 3–5)
- Gallery lightbox retained.

### 4. Wizard (create / edit)

- Four steps with clear active/done states.
- Required fields marked; Next blocked with toast if invalid.
- Step 4 uploads: drag-drop + click; preview thumbs; remove; caps enforced (logo 2, storefront 5).
- Save uses existing POST/PUT then `/api/upload`.

## Ready-to-use (ops)

Update README to match reality:

1. Prerequisites: Node ≥ 18, SQL Server, ODBC Driver 17, Windows Auth (or `DB_*` / `DB_CONN_STRING`).
2. Run `sql/setup.sql` once.
3. `npm install` then `node server.js` (port `3210` default).
4. Env vars: `APP_PASSWORD`, `APP_PORT`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS`, `DB_CONN_STRING`.
5. Backup: SQL DB + `data/uploads/`.
6. Remove or clearly mark legacy `db.json` as migration-only.

Server UX for failures:

- If customer list/load fails due to DB, return JSON error with readable message; client toast/banner: “เชื่อมต่อฐานข้อมูลไม่ได้ — ตรวจ SQL Server / ODBC / env”.

## Technical constraints

- **Touch primarily:** `public/assets/styles.css`, `public/assets/app.js`, `README.md`; light touch `server.js` only for clearer DB error responses if needed.
- **Do not break:** cookie auth, multipart upload, ODBC CRUD in `db.js` field mapping.
- **No new dependencies** for UI (stay zero frontend build step).

## Success criteria

- Staff can log in, find a customer in &lt;5 seconds via search, open detail, edit via wizard, upload images.
- New machine can go from clone → SQL setup → first login using README alone.
- Mobile width usable for list + detail + form (single column breakpoints already present; verify and fix gaps).
- Visual polish without changing field meanings or PDF section order.

## Implementation note

After this spec is accepted, create an implementation plan (writing-plans) then execute in small steps: README/ops → CSS polish → list/detail/wizard UX copy → DB error surfacing → smoke check in browser.
