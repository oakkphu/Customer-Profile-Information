# Customer Profile UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the existing THANVASU Customer Profile UI for daily internal use and make setup docs match the SQL Server reality, without changing API contracts or schema.

**Architecture:** Keep zero-build vanilla SPA (`public/assets/app.js` + `styles.css`) talking to `server.js` + ODBC `db.js`. Improve CSS tokens/chrome, Thai empty/error copy, clear-filter on empty search, and map DB connection failures to readable JSON + client banner/toast.

**Tech Stack:** Node.js ≥ 18, ODBC SQL Server, vanilla HTML/CSS/JS (no frontend build)

## Global Constraints

- No new npm dependencies for UI
- Do not change customer field semantics or PDF section order (1–4)
- Preserve hashes: `#`, `#c/:id`, `#new`, `#edit/:id` and API paths under `/api/*`
- Do not break cookie auth or multipart upload
- Thai-first user-facing copy; reduce decorative emoji in primary chrome
- Visual: navy/blue system (`#1e2a52` / `#2563eb`), not purple-gradient defaults

## File map

| File | Role |
|------|------|
| `README.md` | Setup: SQL, ODBC, env, run, backup; mark `db.json` legacy |
| `server.js` | Map ODBC/DB errors to Thai JSON `error` on customer routes |
| `public/assets/styles.css` | Visual polish, mobile gaps, banner/empty-clear styles |
| `public/assets/app.js` | Login/shell/list/detail copy; clear filters; DB error UI |
| `db.js` | No change unless needed for error message (prefer catch in server) |

---

### Task 1: README ready-to-use

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: none
- Produces: accurate ops instructions for clone → SQL → first login

- [ ] **Step 1: Replace README content** with SQL-first setup (Node ≥ 18, ODBC Driver 17, `sql/setup.sql`, `npm install`, `node server.js`, env vars, backup SQL + `data/uploads/`, note legacy `db.json`)

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: align README with SQL Server setup"
```

---

### Task 2: Surfacing DB connection errors

**Files:**
- Modify: `server.js` (catch around store calls / global handler)
- Modify: `public/assets/app.js` (`api`, `loadCustomers`, `route`, dashboard banner)

**Interfaces:**
- Consumes: `store.listCustomers`, `store.getCustomer`, etc.
- Produces: HTTP 503 JSON `{ error: "เชื่อมต่อฐานข้อมูลไม่ได้ — ตรวจ SQL Server / ODBC / env" }` when ODBC connection fails; client shows toast and optional `#dbBanner` on list

- [ ] **Step 1: Add helper in `server.js`**

```js
function isDbError(e) {
  const msg = String((e && e.message) || e || '');
  return /odbc|connect|login failed|ENOTFOUND|ECONNREFUSED|timeout|SQL_/i.test(msg);
}
function dbFail(res, e) {
  console.error(e);
  json(res, 503, { error: 'เชื่อมต่อฐานข้อมูลไม่ได้ — ตรวจ SQL Server / ODBC / env' });
}
```

Wrap customer/list/get/put/delete/upload/nextCode paths: on catch if `isDbError(e)` call `dbFail`, else existing 500.

Also in the top-level `catch (e)` of the request handler: if `isDbError(e)` → `dbFail`.

- [ ] **Step 2: Client — detect DB errors in `route`/`loadCustomers`**

On list load failure, if message includes `เชื่อมต่อฐานข้อมูล`, render dashboard shell with `.db-banner` and empty list (or keep previous) + toast.

- [ ] **Step 3: Smoke** — stop SQL or break `DB_CONN_STRING`, open app after login, expect Thai error (manual when SQL available to break).

- [ ] **Step 4: Commit**

```bash
git add server.js public/assets/app.js
git commit -m "fix: surface SQL connection failures in Thai"
```

---

### Task 3: CSS visual polish

**Files:**
- Modify: `public/assets/styles.css`

**Interfaces:**
- Consumes: existing class names in `app.js`
- Produces: refined tokens + `.db-banner`, `.clear-filters`, tighter topbar/login; mobile breakpoints for topbar wrap

- [ ] **Step 1: Update `:root` tokens** — keep blue navy; slightly stronger type hierarchy; add `.db-banner` (amber/warning), `.btn-link` for clear filters; topbar wrap on small screens; reduce pill overuse if needed.

- [ ] **Step 2: Visual check** — open `/` login + list in browser at ~375px and desktop.

- [ ] **Step 3: Commit**

```bash
git add public/assets/styles.css
git commit -m "style: polish Customer Profile UI chrome"
```

---

### Task 4: Frontend UX copy and list affordances

**Files:**
- Modify: `public/assets/app.js`

**Interfaces:**
- Consumes: CSS classes from Task 3
- Produces: cleaner login/shell labels; empty-search “ล้างตัวกรอง” button that clears `state.q` + `state.typeFilter` and re-renders; fewer decorative emoji in topbar/login buttons

- [ ] **Step 1: Update `renderLogin`** — title “Customer Profile Database”, sub “THANVASU • Internal Use Only”; submit “เข้าสู่ระบบ”; hint about internal access only (no default password on screen).

- [ ] **Step 2: Update `shell`** — brand text without heavy emoji; buttons “รายการลูกค้า”, “เพิ่มลูกค้า”, “ออกจากระบบ”.

- [ ] **Step 3: Empty search state** — include button `#btnClearFilters` that sets `state.q=''`, `state.typeFilter=''`, calls `renderDashboard()` (or refresh). Same in `refreshListOnly` empty HTML.

- [ ] **Step 4: Detail/actions** — “แก้ไข” / “ลบ” without emoji clutter (optional small text only).

- [ ] **Step 5: Commit**

```bash
git add public/assets/app.js
git commit -m "ux: clarify chrome copy and clear-filters on empty search"
```

---

### Task 5: End-to-end smoke

**Files:** none (manual)

- [ ] **Step 1:** `npm install` if needed; ensure SQL + `sql/setup.sql` done.
- [ ] **Step 2:** `node server.js` — expect listen on 3210.
- [ ] **Step 3:** Login → list → open/create/edit path smoke in browser.
- [ ] **Step 4:** If anything broken, fix and commit.

---

## Spec coverage check

| Spec item | Task |
|-----------|------|
| README SQL/ODBC/env/backup | 1 |
| DB fail loudly | 2 |
| Visual navy/blue polish | 3 |
| Login / list / detail / wizard copy & clear filters | 4 |
| Mobile usable | 3 (+ smoke 5) |
| No API/schema change | all |

## Execution

Inline in this session (user requested immediate execution).
