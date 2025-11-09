-- Staff Full/Part Time Status
CREATE TABLE IF NOT EXISTS staff_employment_status (
    id SERIAL PRIMARY KEY,
    staff_name VARCHAR(255) NOT NULL UNIQUE,
    employment_type VARCHAR(20) NOT NULL CHECK (employment_type IN ('Full Time', 'Part Time')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Staff Attendance Settings (Expected days per month)
CREATE TABLE IF NOT EXISTS staff_attendance_settings (
    id SERIAL PRIMARY KEY,
    setting_key VARCHAR(50) NOT NULL UNIQUE,
    setting_value INTEGER NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default settings if they don't exist
INSERT INTO staff_attendance_settings (setting_key, setting_value, description)
VALUES 
    ('full_time_expected_days', 22, 'Expected number of days present per month for full-time staff'),
    ('part_time_expected_days', 11, 'Expected number of days present per month for part-time staff')
ON CONFLICT (setting_key) DO NOTHING;

-- Index for better performance
CREATE INDEX IF NOT EXISTS idx_staff_employment_status_staff_name ON staff_employment_status(staff_name);

