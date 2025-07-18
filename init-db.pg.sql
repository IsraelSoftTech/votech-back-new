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

-- Students
CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    sex VARCHAR(10),
    date_of_birth DATE,
    place_of_birth VARCHAR(100),
    father_name VARCHAR(100),
    mother_name VARCHAR(100),
    class_id INTEGER,
    specialty_id INTEGER REFERENCES specialties(id),
    vocational_training VARCHAR(100),
    guardian_contact VARCHAR(50),
    student_picture BYTEA,
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

-- Messages
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    recipient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    group_id INTEGER,
    content TEXT,
    type VARCHAR(20) DEFAULT 'text', -- text, image, video, audio, etc.
    file_url VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);