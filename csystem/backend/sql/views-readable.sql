-- สร้าง View อ่านง่าย (ชื่อร้าน + ชื่อระบบ + สถานะไทย)
USE BD_CSystem;
GO

CREATE OR ALTER VIEW dbo.v_ShopServices AS
SELECT
  ss.shop_id,
  s.name AS shop_name,
  s.rest_db AS database_name,
  s.data_source AS server_name,
  ss.service_id,
  c.code AS service_code,
  c.name AS service_name,
  ss.status,
  CASE ss.status
    WHEN 'Y' THEN N'ใช้งาน'
    WHEN 'E' THEN N'มีปัญหา'
    WHEN 'N' THEN N'ปิดชั่วคราว'
    ELSE ss.status
  END AS status_th,
  ss.status_note,
  ss.other_text,
  ss.updated_at,
  ss.updated_by
FROM dbo.ShopServices ss
INNER JOIN dbo.Shops s ON s.id = ss.shop_id
INNER JOIN dbo.ServiceCatalog c ON c.id = ss.service_id;
GO

CREATE OR ALTER VIEW dbo.v_Shops AS
SELECT
  s.id AS shop_id,
  s.name AS shop_name,
  s.start_date,
  s.business_type,
  s.business_type_other,
  s.data_source AS server_name,
  s.rest_db AS database_name,
  s.rest_id,
  s.notes,
  s.created_at,
  s.updated_at,
  SUM(CASE WHEN ss.status = 'Y' THEN 1 ELSE 0 END) AS count_Y,
  SUM(CASE WHEN ss.status = 'E' THEN 1 ELSE 0 END) AS count_E,
  SUM(CASE WHEN ss.status = 'N' THEN 1 ELSE 0 END) AS count_N
FROM dbo.Shops s
LEFT JOIN dbo.ShopServices ss ON ss.shop_id = s.id
GROUP BY
  s.id, s.name, s.start_date, s.business_type, s.business_type_other,
  s.data_source, s.rest_db, s.rest_id, s.notes, s.created_at, s.updated_at;
GO
