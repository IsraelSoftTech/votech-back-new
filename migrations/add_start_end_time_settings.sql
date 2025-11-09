-- Update staff_attendance_settings table to support time values
ALTER TABLE staff_attendance_settings 
ALTER COLUMN setting_value TYPE VARCHAR(255);

-- Insert start_time and end_time settings if they don't exist
INSERT INTO staff_attendance_settings (setting_key, setting_value, description)
VALUES 
    ('start_time', '08:00', 'Expected start time for staff (HH:MM format)'),
    ('end_time', '17:00', 'Expected end time for staff (HH:MM format)')
ON CONFLICT (setting_key) DO NOTHING;

