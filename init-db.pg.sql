-- Users
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    contact VARCHAR(50),
    password VARCHAR(255) NOT NULL,
    name VARCHAR(100),
    email VARCHAR(255),
    gender VARCHAR(20),
    role VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Classes
CREATE TABLE IF NOT EXISTS classes (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    registration_fee VARCHAR(50),
    bus_fee VARCHAR(50),
    internship_fee VARCHAR(50),
    remedial_fee VARCHAR(50),
    tuition_fee VARCHAR(50),
    pta_fee VARCHAR(50),
    total_fee VARCHAR(50),
    suspended BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Specialties
CREATE TABLE IF NOT EXISTS specialties (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    abbreviation VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Specialty Classes (many-to-many)
CREATE TABLE IF NOT EXISTS specialty_classes (
    id SERIAL PRIMARY KEY,
    specialty_id INTEGER REFERENCES specialties(id) ON DELETE CASCADE,
    class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE
);

-- Students table intentionally omitted (removed)
CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    student_id VARCHAR(32) UNIQUE NOT NULL,
    registration_date DATE NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    sex VARCHAR(10) NOT NULL,
    date_of_birth DATE NOT NULL,
    place_of_birth VARCHAR(100) NOT NULL,
    father_name VARCHAR(100),
    mother_name VARCHAR(100),
    class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
    specialty_id INTEGER REFERENCES specialties(id) ON DELETE SET NULL,
    academic_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL,
    guardian_contact VARCHAR(50),
    mother_contact VARCHAR(50),
    photo_url VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Fees (for tracking fee payments)
CREATE TABLE IF NOT EXISTS fees (
    id SERIAL PRIMARY KEY,
    student_id INTEGER,
    class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
    fee_type VARCHAR(50) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Messages (user-to-user chat)
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    group_id INTEGER,
    content TEXT NOT NULL,
    file_url VARCHAR(255),
    file_name VARCHAR(255),
    file_type VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP
);

-- Group chats
CREATE TABLE IF NOT EXISTS groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    creator_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Group participants (many-to-many)
CREATE TABLE IF NOT EXISTS group_participants (
    id SERIAL PRIMARY KEY,
    group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(group_id, user_id)
);

-- Subjects
CREATE TABLE IF NOT EXISTS subjects (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Inventory
CREATE TABLE IF NOT EXISTS inventory (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  item_name VARCHAR(255) NOT NULL,
  department VARCHAR(255) NOT NULL,
  quantity INTEGER NOT NULL,
  estimated_cost NUMERIC(12,2) NOT NULL,
  type VARCHAR(20) NOT NULL, -- 'income' or 'expenditure'
  depreciation_rate NUMERIC(5,2),
  budget_head_id INTEGER,
  asset_category VARCHAR(100),
  purchase_date DATE,
  supplier VARCHAR(255),
  warranty_expiry DATE,
  location VARCHAR(255),
  condition VARCHAR(50) DEFAULT 'new',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Budget Heads for Financial Categorization
CREATE TABLE IF NOT EXISTS budget_heads (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  code VARCHAR(50) UNIQUE,
  category VARCHAR(100) NOT NULL, -- 'income', 'expenditure', 'asset'
  description TEXT,
  allocated_amount NUMERIC(15,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Asset Categories for Equipment Classification
CREATE TABLE IF NOT EXISTS asset_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  default_depreciation_rate NUMERIC(5,2) DEFAULT 0,
  useful_life_years INTEGER DEFAULT 5,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Financial Transactions for Comprehensive Tracking
CREATE TABLE IF NOT EXISTS financial_transactions (
  id SERIAL PRIMARY KEY,
  transaction_date DATE NOT NULL,
  type VARCHAR(20) NOT NULL, -- 'income', 'expenditure', 'asset_purchase'
  amount NUMERIC(15,2) NOT NULL,
  budget_head_id INTEGER REFERENCES budget_heads(id),
  description TEXT NOT NULL,
  reference_type VARCHAR(50), -- 'inventory', 'salary', 'fee', etc.
  reference_id INTEGER,
  department VARCHAR(255),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Asset Depreciation Tracking
CREATE TABLE IF NOT EXISTS asset_depreciation (
  id SERIAL PRIMARY KEY,
  inventory_id INTEGER REFERENCES inventory(id) ON DELETE CASCADE,
  asset_name VARCHAR(255) NOT NULL,
  original_cost NUMERIC(12,2) NOT NULL,
  current_value NUMERIC(12,2) NOT NULL,
  depreciation_rate NUMERIC(5,2) NOT NULL,
  monthly_depreciation NUMERIC(12,2) NOT NULL,
  total_depreciation NUMERIC(12,2) NOT NULL,
  calculation_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(inventory_id, calculation_date)
);

-- Sample Budget Heads Data
INSERT INTO budget_heads (name, code, category, description, allocated_amount) VALUES
('Tuition Fees', 'TF001', 'income', 'Student tuition and registration fees', 50000000),
('Government Grants', 'GG001', 'income', 'Educational grants from government', 20000000),
('Donations', 'DN001', 'income', 'Charitable donations and sponsorships', 5000000),
('Salaries and Wages', 'SW001', 'expenditure', 'Staff and teacher salaries', 30000000),
('Utilities', 'UT001', 'expenditure', 'Electricity, water, and internet', 5000000),
('Maintenance', 'MN001', 'expenditure', 'Building and equipment maintenance', 3000000),
('Office Supplies', 'OS001', 'expenditure', 'Stationery and office materials', 1000000),
('Computer Equipment', 'CE001', 'asset', 'Computers, laptops, and IT equipment', 10000000),
('Furniture', 'FR001', 'asset', 'Desks, chairs, and classroom furniture', 5000000),
('Laboratory Equipment', 'LE001', 'asset', 'Science lab and technical equipment', 8000000)
ON CONFLICT (name) DO NOTHING;

-- Sample Asset Categories Data
INSERT INTO asset_categories (name, description, default_depreciation_rate, useful_life_years) VALUES
('Computer Equipment', 'Computers, laptops, tablets, and IT devices', 2.5, 4),
('Furniture', 'Desks, chairs, cabinets, and classroom furniture', 1.0, 10),
('Laboratory Equipment', 'Science lab equipment and technical instruments', 2.0, 5),
('Vehicles', 'School buses and transport vehicles', 1.5, 7),
('Buildings', 'School buildings and infrastructure', 0.5, 50),
('Office Equipment', 'Printers, scanners, and office machines', 3.0, 3),
('Audio Visual Equipment', 'Projectors, sound systems, and displays', 2.0, 5),
('Sports Equipment', 'Physical education and sports equipment', 1.5, 8)
ON CONFLICT (name) DO NOTHING;

-- Academic Years
CREATE TABLE IF NOT EXISTS academic_years (
    id SERIAL PRIMARY KEY,
    year_name VARCHAR(50) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Lessons Table (for created lesson plan content)
CREATE TABLE IF NOT EXISTS lessons (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    subject VARCHAR(100),
    class_name VARCHAR(100),
    week VARCHAR(50),
    period_type VARCHAR(20) NOT NULL DEFAULT 'weekly' CHECK (period_type IN ('weekly', 'monthly', 'yearly')),
    objectives TEXT,
    content TEXT,
    activities TEXT,
    assessment TEXT,
    resources TEXT,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    admin_comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP,
    reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- Lesson Plans Table (for uploaded PDF files)
CREATE TABLE IF NOT EXISTS lesson_plans (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    period_type VARCHAR(20) NOT NULL CHECK (period_type IN ('weekly', 'monthly', 'yearly')),
    file_url VARCHAR(500) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    admin_comment TEXT,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP,
    reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);





-- Salary Management
CREATE TABLE IF NOT EXISTS salaries (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,

    amount DECIMAL(10,2) NOT NULL,
    month VARCHAR(20) NOT NULL CHECK (month IN ('January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December')),
    year INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
    paid BOOLEAN DEFAULT FALSE,
    paid_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, month, year) -- Ensure only one salary record per user per month
);

-- Salary Descriptions for Pay Slips
CREATE TABLE IF NOT EXISTS salary_descriptions (
    id SERIAL PRIMARY KEY,
    description VARCHAR(100) NOT NULL,
    percentage DECIMAL(5,2) NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Timetable Configs (global settings)
CREATE TABLE IF NOT EXISTS timetable_configs (
    id SERIAL PRIMARY KEY,
    config JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Class Timetables
CREATE TABLE IF NOT EXISTS timetables (
    id SERIAL PRIMARY KEY,
    class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(class_id)
);

-- Teacher Assignments (teacher to class+subject)
CREATE TABLE IF NOT EXISTS teacher_assignments (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
    periods_per_week INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(teacher_id, class_id, subject_id)
);

-- Teacher Disciplinary Cases
CREATE TABLE IF NOT EXISTS teacher_discipline_cases (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    case_name VARCHAR(200) NOT NULL,
    description TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User Activity Tracking Tables
CREATE TABLE IF NOT EXISTS user_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    session_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    session_end TIMESTAMP,
    ip_address VARCHAR(45),
    user_agent TEXT,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'ended', 'expired')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_activities (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    activity_type VARCHAR(100) NOT NULL,
    activity_description TEXT NOT NULL,
    entity_type VARCHAR(50),
    entity_id INTEGER,
    entity_name VARCHAR(255),
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Cases table for psychosocialist counseling
CREATE TABLE IF NOT EXISTS cases (
    id SERIAL PRIMARY KEY,
    case_number VARCHAR(20) UNIQUE NOT NULL,
    student_id VARCHAR(32) REFERENCES students(student_id) ON DELETE CASCADE,
    class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
    issue_type VARCHAR(100) NOT NULL,
    issue_description TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'pending', 'resolved', 'closed')),
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    started_date DATE NOT NULL,
    resolved_date DATE,
    sessions_completed INTEGER DEFAULT 0,
    sessions_scheduled INTEGER DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Case sessions table for tracking counseling sessions
CREATE TABLE IF NOT EXISTS case_sessions (
    id SERIAL PRIMARY KEY,
    case_id INTEGER REFERENCES cases(id) ON DELETE CASCADE,
    session_date DATE NOT NULL,
    session_time TIME NOT NULL,
    session_type VARCHAR(50) NOT NULL,
    session_notes TEXT,
    status VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'rescheduled')),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Case reports table for storing generated reports
CREATE TABLE IF NOT EXISTS case_reports (
    id SERIAL PRIMARY KEY,
    case_id INTEGER REFERENCES cases(id) ON DELETE CASCADE,
    report_type VARCHAR(50) NOT NULL,
    report_content TEXT NOT NULL,
    report_file_url VARCHAR(255),
    sent_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sent_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);



-- Attendance (for students only)
CREATE TABLE IF NOT EXISTS attendance_sessions (
    id SERIAL PRIMARY KEY,
    type VARCHAR(10) NOT NULL CHECK (type IN ('student','teacher')),
    class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
    taken_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    session_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attendance_records (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES attendance_sessions(id) ON DELETE CASCADE,
    student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    teacher_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(10) NOT NULL CHECK (status IN ('present','absent')),
    marked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(session_id, student_id),
    UNIQUE(session_id, teacher_id),
    CHECK ((student_id IS NOT NULL AND teacher_id IS NULL) OR (student_id IS NULL AND teacher_id IS NOT NULL))
);

-- Staff Attendance Records
CREATE TABLE IF NOT EXISTS staff_attendance_records (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    staff_name VARCHAR(255) NOT NULL,
    time_in TIME,
    time_out TIME,
    classes_taught TEXT,
    status VARCHAR(50) NOT NULL CHECK (status IN ('Present', 'Absent', 'Late', 'Half Day')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date, staff_name)
);

-- Index for better performance on date queries
CREATE INDEX IF NOT EXISTS idx_staff_attendance_date ON staff_attendance_records(date);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_staff_name ON staff_attendance_records(staff_name);

-- Staff Full/Part Time Status
CREATE TABLE IF NOT EXISTS staff_employment_status (
    id SERIAL PRIMARY KEY,
    staff_name VARCHAR(255) NOT NULL UNIQUE,
    employment_type VARCHAR(20) NOT NULL CHECK (employment_type IN ('Full Time', 'Part Time')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Staff Attendance Settings (Expected days per month and work hours)
CREATE TABLE IF NOT EXISTS staff_attendance_settings (
    id SERIAL PRIMARY KEY,
    setting_key VARCHAR(50) NOT NULL UNIQUE,
    setting_value VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default settings if they don't exist
INSERT INTO staff_attendance_settings (setting_key, setting_value, description)
VALUES 
    ('full_time_expected_days', '22', 'Expected number of days present per month for full-time staff'),
    ('part_time_expected_days', '11', 'Expected number of days present per month for part-time staff'),
    ('start_time', '08:00', 'Expected start time for staff (HH:MM format)'),
    ('end_time', '17:00', 'Expected end time for staff (HH:MM format)')
ON CONFLICT (setting_key) DO NOTHING;

-- Index for better performance
CREATE INDEX IF NOT EXISTS idx_staff_employment_status_staff_name ON staff_employment_status(staff_name);

-- Discipline Cases table
CREATE TABLE IF NOT EXISTS discipline_cases (
    id SERIAL PRIMARY KEY,
    student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    case_description TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'not resolved' CHECK (status IN ('resolved', 'not resolved')),
    recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    recorded_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP NULL,
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    resolution_notes TEXT NULL
);

-- Teacher Discipline Cases table removed

-- Events table
CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('Meeting', 'Class', 'Others')),
    event_date DATE NOT NULL,
    event_time TIME NOT NULL,
    participants VARCHAR(255),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- HODs table for managing Heads of Departments
CREATE TABLE IF NOT EXISTS hods (
    id SERIAL PRIMARY KEY,
    department_name VARCHAR(255) NOT NULL,
    hod_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
    suspended BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- HOD Teachers table for managing teachers under each HOD
CREATE TABLE IF NOT EXISTS hod_teachers (
    id SERIAL PRIMARY KEY,
    hod_id INTEGER REFERENCES hods(id) ON DELETE CASCADE,
    teacher_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(hod_id, teacher_id)
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_status ON user_sessions(status);
CREATE INDEX IF NOT EXISTS idx_user_activities_user_id ON user_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activities_created_at ON user_activities(created_at);
CREATE INDEX IF NOT EXISTS idx_user_activities_activity_type ON user_activities(activity_type);

-- Index for better performance
CREATE INDEX IF NOT EXISTS idx_discipline_cases_student ON discipline_cases(student_id);
CREATE INDEX IF NOT EXISTS idx_discipline_cases_class ON discipline_cases(class_id);
CREATE INDEX IF NOT EXISTS idx_discipline_cases_status ON discipline_cases(status);
CREATE INDEX IF NOT EXISTS idx_discipline_cases_recorded_at ON discipline_cases(recorded_at);

-- Indexes for teacher discipline cases removed






