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

-- Students
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
    guardian_contact VARCHAR(50),
    photo_url VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Messages (user-to-user chat)
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read BOOLEAN DEFAULT FALSE
);

-- Attendance
CREATE TABLE IF NOT EXISTS attendance_sessions (
    id SERIAL PRIMARY KEY,
    class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    taken_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    session_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attendance_records (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES attendance_sessions(id) ON DELETE CASCADE,
    student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    status VARCHAR(10) NOT NULL CHECK (status IN ('present', 'absent')),
    marked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Teachers
CREATE TABLE IF NOT EXISTS teachers (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    sex VARCHAR(10) NOT NULL,
    id_card VARCHAR(50) NOT NULL,
    dob DATE NOT NULL,
    pob VARCHAR(100) NOT NULL,
    subjects VARCHAR(255) NOT NULL,
    classes VARCHAR(255) NOT NULL,
    contact VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE teachers ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending';

CREATE TABLE IF NOT EXISTS subjects (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);