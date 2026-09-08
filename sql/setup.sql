IF DB_ID('CustomerProfileDB') IS NULL CREATE DATABASE CustomerProfileDB;
GO
USE CustomerProfileDB;
GO
IF OBJECT_ID('dbo.Customers') IS NULL CREATE TABLE dbo.Customers (
  id NVARCHAR(50) NOT NULL PRIMARY KEY,
  code NVARCHAR(20) NOT NULL UNIQUE,
  shop_name_th NVARCHAR(200), shop_name_en NVARCHAR(200),
  company_name_th NVARCHAR(200), company_name_en NVARCHAR(200),
  business_type NVARCHAR(100), business_type_other NVARCHAR(200),
  branch_count NVARCHAR(20),
  branches NVARCHAR(MAX), website NVARCHAR(400),
  owner_name NVARCHAR(200), owner_nickname NVARCHAR(100), owner_phone NVARCHAR(50),
  coordinator_name NVARCHAR(200), coordinator_nickname NVARCHAR(100), coordinator_phone NVARCHAR(50),
  contact_email NVARCHAR(200), start_date NVARCHAR(20),
  systems NVARCHAR(MAX), other_system_api NVARCHAR(400), system_flow NVARCHAR(MAX),
  hardware NVARCHAR(MAX), other_hardware NVARCHAR(400),
  logo NVARCHAR(MAX), storefront NVARCHAR(MAX),
  created_at DATETIME2, updated_at DATETIME2
);
GO
