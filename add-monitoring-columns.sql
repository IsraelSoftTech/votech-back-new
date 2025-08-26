-- Add monitoring columns to users table
-- This migration adds the missing last_login and last_ip columns that the monitoring system expects

-- Add last_login column
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP;

-- Add last_ip column  
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_ip VARCHAR(45);

-- Add comment to document the purpose
COMMENT ON COLUMN users.last_login IS 'Timestamp of user last login for monitoring purposes';
COMMENT ON COLUMN users.last_ip IS 'IP address of user last login for monitoring purposes';
