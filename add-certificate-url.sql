-- Migration: Add certificate_url column to teachers table
-- Run this in pgAdmin or your database client

-- Add certificate_url column (nullable)
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS certificate_url VARCHAR(255); 