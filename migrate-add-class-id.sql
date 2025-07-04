-- Migration script to add class_id column to students table
USE mpasat_online;

-- Add class_id column if it doesn't exist
ALTER TABLE students ADD COLUMN IF NOT EXISTS class_id INT;

-- Add foreign key constraint if it doesn't exist
-- Note: MySQL doesn't support IF NOT EXISTS for foreign keys, so we'll handle this carefully
SET @sql = (SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
     WHERE TABLE_SCHEMA = 'mpasat_online' 
     AND TABLE_NAME = 'students' 
     AND COLUMN_NAME = 'class_id' 
     AND CONSTRAINT_NAME = 'students_ibfk_2') = 0,
    'ALTER TABLE students ADD CONSTRAINT students_ibfk_2 FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL',
    'SELECT "Foreign key constraint already exists"'
));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt; 