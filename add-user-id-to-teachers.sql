-- Migration: Add user_id and status columns to teachers table
-- Run this in pgAdmin or your database client

-- Add user_id column (nullable initially)
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

-- Add status column with default value
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending';

-- Update existing records to have 'pending' status if they don't have one
UPDATE teachers SET status = 'pending' WHERE status IS NULL; 