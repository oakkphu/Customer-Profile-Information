IF DB_ID(N'BD_CSystem') IS NULL CREATE DATABASE BD_CSystem;
GO
USE BD_CSystem;
GO

IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
CREATE TABLE dbo.Users (
  id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  username NVARCHAR(80) NOT NULL UNIQUE,
  password_hash NVARCHAR(200) NOT NULL,
  email NVARCHAR(200) NULL,
  role NVARCHAR(20) NOT NULL CONSTRAINT DF_Users_role DEFAULT N'User',
  is_active BIT NOT NULL CONSTRAINT DF_Users_active DEFAULT 1,
  created_at DATETIME2 NOT NULL CONSTRAINT DF_Users_created DEFAULT (CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time' AS DATETIME2)),
  updated_at DATETIME2 NOT NULL CONSTRAINT DF_Users_updated DEFAULT (CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time' AS DATETIME2))
);
GO

IF OBJECT_ID(N'dbo.PasswordResetTokens', N'U') IS NULL
CREATE TABLE dbo.PasswordResetTokens (
  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME2 NOT NULL,
  used_at DATETIME2 NULL,
  created_at DATETIME2 NOT NULL CONSTRAINT DF_PRT_created DEFAULT (CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time' AS DATETIME2)),
  CONSTRAINT FK_PRT_User FOREIGN KEY (user_id) REFERENCES dbo.Users(id) ON DELETE CASCADE
);
GO

IF OBJECT_ID(N'dbo.Shops', N'U') IS NULL
CREATE TABLE dbo.Shops (
  id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  name NVARCHAR(200) NOT NULL,
  start_date DATE NULL,
  business_type NVARCHAR(120) NULL,
  business_type_other NVARCHAR(200) NULL,
  data_source NVARCHAR(200) NULL,
  notes NVARCHAR(MAX) NULL,
  rest_id NVARCHAR(40) NULL,
  rest_db NVARCHAR(200) NULL,
  brand_name NVARCHAR(200) NULL,
  company_name_th NVARCHAR(200) NULL,
  company_name_en NVARCHAR(200) NULL,
  branch_count INT NULL,
  branch_names NVARCHAR(MAX) NULL,
  website_social NVARCHAR(1000) NULL,
  owner_name NVARCHAR(120) NULL,
  owner_nickname NVARCHAR(80) NULL,
  owner_phone NVARCHAR(40) NULL,
  contact_name NVARCHAR(120) NULL,
  contact_nickname NVARCHAR(80) NULL,
  contact_phone NVARCHAR(40) NULL,
  contact_email NVARCHAR(200) NULL,
  contact_line NVARCHAR(120) NULL,
  contact_other NVARCHAR(500) NULL,
  system_flow NVARCHAR(MAX) NULL,
  hardware_other NVARCHAR(500) NULL,
  created_at DATETIME2 NOT NULL CONSTRAINT DF_Shops_created DEFAULT (CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time' AS DATETIME2)),
  updated_at DATETIME2 NOT NULL CONSTRAINT DF_Shops_updated DEFAULT (CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time' AS DATETIME2)),
  created_by INT NULL,
  updated_by INT NULL
);
GO

IF OBJECT_ID(N'dbo.HardwareCatalog', N'U') IS NULL
CREATE TABLE dbo.HardwareCatalog (
  id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  code NVARCHAR(80) NOT NULL UNIQUE,
  name NVARCHAR(200) NOT NULL,
  sort_order INT NOT NULL CONSTRAINT DF_Hw_sort DEFAULT 0
);
GO

IF OBJECT_ID(N'dbo.ShopHardware', N'U') IS NULL
CREATE TABLE dbo.ShopHardware (
  shop_id INT NOT NULL,
  hardware_id INT NOT NULL,
  qty INT NOT NULL CONSTRAINT DF_SH_qty DEFAULT 0,
  CONSTRAINT PK_ShopHardware PRIMARY KEY (shop_id, hardware_id),
  CONSTRAINT FK_SH_Shop FOREIGN KEY (shop_id) REFERENCES dbo.Shops(id) ON DELETE CASCADE,
  CONSTRAINT FK_SH_Hw FOREIGN KEY (hardware_id) REFERENCES dbo.HardwareCatalog(id)
);
GO

IF OBJECT_ID(N'dbo.ShopBranchHardware', N'U') IS NULL
CREATE TABLE dbo.ShopBranchHardware (
  shop_id INT NOT NULL,
  branch_id NVARCHAR(40) NOT NULL,
  hardware_id INT NOT NULL,
  qty INT NOT NULL CONSTRAINT DF_SBH_qty DEFAULT 0,
  CONSTRAINT PK_ShopBranchHardware PRIMARY KEY (shop_id, branch_id, hardware_id),
  CONSTRAINT FK_SBH_Shop FOREIGN KEY (shop_id) REFERENCES dbo.Shops(id) ON DELETE CASCADE,
  CONSTRAINT FK_SBH_Hw FOREIGN KEY (hardware_id) REFERENCES dbo.HardwareCatalog(id)
);
GO

IF OBJECT_ID(N'dbo.ShopImages', N'U') IS NULL
CREATE TABLE dbo.ShopImages (
  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  shop_id INT NOT NULL,
  kind NVARCHAR(20) NOT NULL,
  stored_name NVARCHAR(200) NOT NULL,
  original_name NVARCHAR(260) NULL,
  mime NVARCHAR(80) NULL,
  size_bytes INT NULL,
  sort_order INT NOT NULL CONSTRAINT DF_SI_sort DEFAULT 0,
  file_data VARBINARY(MAX) NULL,
  created_at DATETIME2 NOT NULL CONSTRAINT DF_SI_created DEFAULT (CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time' AS DATETIME2)),
  CONSTRAINT FK_SI_Shop FOREIGN KEY (shop_id) REFERENCES dbo.Shops(id) ON DELETE CASCADE,
  CONSTRAINT CK_SI_kind CHECK (kind IN (N'logo', N'store'))
);
GO

IF COL_LENGTH(N'dbo.ShopImages', N'file_data') IS NULL
  ALTER TABLE dbo.ShopImages ADD file_data VARBINARY(MAX) NULL;
GO

IF OBJECT_ID(N'dbo.ServiceCatalog', N'U') IS NULL
CREATE TABLE dbo.ServiceCatalog (
  id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  code NVARCHAR(80) NOT NULL UNIQUE,
  name NVARCHAR(200) NOT NULL,
  sort_order INT NOT NULL CONSTRAINT DF_Svc_sort DEFAULT 0,
  allows_free_text BIT NOT NULL CONSTRAINT DF_Svc_free DEFAULT 0
);
GO

IF OBJECT_ID(N'dbo.ShopServices', N'U') IS NULL
CREATE TABLE dbo.ShopServices (
  shop_id INT NOT NULL,
  service_id INT NOT NULL,
  status CHAR(1) NOT NULL CONSTRAINT DF_SS_status DEFAULT 'N',
  status_note NVARCHAR(500) NULL,
  other_text NVARCHAR(400) NULL,
  updated_at DATETIME2 NOT NULL CONSTRAINT DF_SS_updated DEFAULT (CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time' AS DATETIME2)),
  updated_by INT NULL,
  CONSTRAINT PK_ShopServices PRIMARY KEY (shop_id, service_id),
  CONSTRAINT FK_SS_Shop FOREIGN KEY (shop_id) REFERENCES dbo.Shops(id) ON DELETE CASCADE,
  CONSTRAINT FK_SS_Svc FOREIGN KEY (service_id) REFERENCES dbo.ServiceCatalog(id),
  CONSTRAINT CK_SS_status CHECK (status IN ('Y','E','N'))
);
GO

IF OBJECT_ID(N'dbo.LoginLog', N'U') IS NULL
CREATE TABLE dbo.LoginLog (
  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  user_id INT NULL,
  username_attempted NVARCHAR(80) NOT NULL,
  success BIT NOT NULL,
  ip NVARCHAR(64) NULL,
  created_at DATETIME2 NOT NULL CONSTRAINT DF_Login_created DEFAULT (CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time' AS DATETIME2))
);
GO

IF OBJECT_ID(N'dbo.AuditLog', N'U') IS NULL
CREATE TABLE dbo.AuditLog (
  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  user_id INT NULL,
  entity_type NVARCHAR(40) NOT NULL,
  entity_id NVARCHAR(40) NOT NULL,
  action NVARCHAR(20) NOT NULL,
  summary NVARCHAR(500) NULL,
  before_json NVARCHAR(MAX) NULL,
  after_json NVARCHAR(MAX) NULL,
  created_at DATETIME2 NOT NULL CONSTRAINT DF_Audit_created DEFAULT (CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time' AS DATETIME2))
);
GO

-- Seed service catalog (idempotent by code)
MERGE dbo.ServiceCatalog AS t
USING (VALUES
  (N'app_pos', N'App POS', 1, 0),
  (N'app_kds', N'App KDS', 2, 0),
  (N'app_kiosk', N'App Kiosk', 3, 0),
  (N'web_crm', N'Web CRM', 4, 0),
  (N'app_cashier_ordering', N'App Cashier Ordering', 5, 0),
  (N'app_staff_ordering', N'App Staff Ordering', 6, 0),
  (N'web_self_order_only', N'Web Self Ordering (Order Only)', 7, 0),
  (N'web_self_pay_first', N'Web Self Ordering (Pay First)', 8, 0),
  (N'web_self_pay_later', N'Web Self Ordering (Pay Later)', 9, 0),
  (N'web_self_pickup', N'Web Self Ordering (Pick Up)', 10, 0),
  (N'web_booking', N'Web Booking', 11, 0),
  (N'web_qtv', N'Web QTV', 12, 0),
  (N'web_bi', N'Web BI Dashboard', 13, 0),
  (N'web_report', N'Web Report', 14, 0),
  (N'erp', N'ERP (KNAP / Others)', 15, 0),
  (N'payment_api', N'Payment API (KBank / BBL / Others)', 16, 0),
  (N'other_api', N'Other system API', 17, 1)
) AS s(code, name, sort_order, allows_free_text)
ON t.code = s.code
WHEN NOT MATCHED THEN INSERT (code, name, sort_order, allows_free_text)
  VALUES (s.code, s.name, s.sort_order, s.allows_free_text);
GO

MERGE dbo.HardwareCatalog AS t
USING (VALUES
  (N'pos', N'POS', 1),
  (N'kiosk', N'Kiosk', 2),
  (N'printer', N'Printer', 3),
  (N'kitchen_printer', N'Kitchen Printer', 4),
  (N'customer_display', N'Customer Display', 5),
  (N'kds_screen', N'KDS Screen', 6),
  (N'cash_drawer', N'Cash Drawer', 7),
  (N'barcode_scanner', N'Barcode Scanner', 8),
  (N'handheld_scanner', N'Handheld Scanner', 9)
) AS s(code, name, sort_order)
ON t.code = s.code
WHEN NOT MATCHED THEN INSERT (code, name, sort_order)
  VALUES (s.code, s.name, s.sort_order);
GO

-- Default admin: username admin / password admin123 (change after first login)
-- Hash is scrypt format: scrypt$N$r$p$saltB64$hashB64 — seeded by app if missing
IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE username = N'admin')
INSERT INTO dbo.Users (username, password_hash, role) VALUES
  (N'admin', N'PLACEHOLDER_SET_BY_APP', N'SuperAdmin');
GO

-- View อ่านง่ายใน SSMS: มีชื่อร้าน + ชื่อระบบ ไม่ต้องจำ id
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
