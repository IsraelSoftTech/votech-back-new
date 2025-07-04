-- Create database if it doesn't exist
CREATE DATABASE IF NOT EXISTS mpasat_online;
USE mpasat_online;

-- Create users table first (since other tables reference it)
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    contact VARCHAR(20),
    is_default BOOLEAN DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create students table
CREATE TABLE IF NOT EXISTS students (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    sex ENUM('Male', 'Female') NOT NULL,
    date_of_birth DATE NOT NULL,
    place_of_birth VARCHAR(255) NOT NULL,
    father_name VARCHAR(255) NOT NULL,
    mother_name VARCHAR(255) NOT NULL,
    class_id INT,
    previous_class VARCHAR(100),
    next_class VARCHAR(100),
    previous_average DECIMAL(5,2),
    guardian_contact VARCHAR(20) NOT NULL,
    student_picture VARCHAR(500),
    vocational_training VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL
);

-- Create classes table
CREATE TABLE IF NOT EXISTS classes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    registration_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    tuition_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    vocational_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    sport_wear_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    health_sanitation_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    number_of_installments INT NOT NULL DEFAULT 1,
    year INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create vocational table
CREATE TABLE IF NOT EXISTS vocational (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    picture1 VARCHAR(500),
    picture2 VARCHAR(500),
    picture3 VARCHAR(500),
    picture4 VARCHAR(500),
    year INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create teachers table
CREATE TABLE IF NOT EXISTS teachers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    teacher_name VARCHAR(255) NOT NULL,
    subjects TEXT NOT NULL,
    id_card VARCHAR(100),
    classes_taught TEXT,
    salary_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create fees table
CREATE TABLE IF NOT EXISTS fees (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    class_id INT NOT NULL,
    fee_type ENUM('Registration', 'Tuition', 'Vocational', 'Sport Wear', 'Sanitation & Health') NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
);

-- Create id_cards table
CREATE TABLE IF NOT EXISTS id_cards (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    photo_url VARCHAR(500),
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

-- Insert default admin user if not exists
INSERT INTO users (username, password, email, contact, is_default)
SELECT 'admin1234', '$2b$10$5QFB6d0BXN1BAfY6KDm1P.D8p8KEXpVD4nqeVf1OKuR6nGhvHUHYy', 'admin@example.com', '+237000000000', 1
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'admin1234');
