-- Password reset + user email
USE BD_CSystem;
GO

IF COL_LENGTH('dbo.Users', 'email') IS NULL
  ALTER TABLE dbo.Users ADD email NVARCHAR(200) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = N'UX_Users_email' AND object_id = OBJECT_ID(N'dbo.Users')
)
BEGIN
  -- unique only when email is not null (filtered index)
  CREATE UNIQUE INDEX UX_Users_email ON dbo.Users(email) WHERE email IS NOT NULL;
END
GO

IF OBJECT_ID(N'dbo.PasswordResetTokens', N'U') IS NULL
CREATE TABLE dbo.PasswordResetTokens (
  id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME2 NOT NULL,
  used_at DATETIME2 NULL,
  created_at DATETIME2 NOT NULL CONSTRAINT DF_PRT_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_PRT_User FOREIGN KEY (user_id) REFERENCES dbo.Users(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = N'IX_PRT_token' AND object_id = OBJECT_ID(N'dbo.PasswordResetTokens')
)
  CREATE INDEX IX_PRT_token ON dbo.PasswordResetTokens(token_hash);
GO
