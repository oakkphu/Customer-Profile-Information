# Filters + Profile Overlay Design

**Date:** 2026-09-08  
**Status:** Approved (option B)  
**Goal:** Make the ~789-shop list usable via filters/pagination, and let staff fill PDF profile fields for THANVASU shops without writing to production `Tbl_Rest`.

## Behavior

1. **List:** search, business-type dropdown (full PDF list), system filter, page size 24 with pager.
2. **Overlay:** Editing a THANVASU shop upserts profile fields into local `CustomerProfileDB.Customers` keyed by `RestID` (string id). Base name/logo/code still come from `Tbl_Rest`.
3. **Merge on read:** remote + local overlay → filterable `businessType`, systems, contacts, hardware, images.
4. **Delete:** cannot delete `Tbl_Rest` rows; may clear local overlay only (optional). UI keeps delete hidden for THANVASU shops.
5. **New shops:** “เพิ่มลูกค้า” still creates local-only profiles (`CU-xxxx`).

## Non-goals

- Writing back to `ThanvasuInfo.Tbl_Rest`
- Multi-select every PDF field as a list filter in this round (system + business type + search + pager is enough)
