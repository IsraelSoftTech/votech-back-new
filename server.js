const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const net = require('net');
const { exec } = require('child_process');
const util = require('util');
const multer = require('multer');
const XLSX = require('xlsx');
const execAsync = util.promisify(exec);

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const PORT = 5000;

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Configure multer for Excel file uploads
const excelUpload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit for Excel files
  },
  fileFilter: function (req, file, cb) {
    // Accept Excel files
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
        file.mimetype === 'application/vnd.ms-excel') {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed!'), false);
    }
  }
});

// Create uploads directory if it doesn't exist
const fs = require('fs');
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Function to find an available port
const findAvailablePort = (startPort) => {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        findAvailablePort(startPort + 1)
          .then(resolve)
          .catch(reject);
      } else {
        reject(err);
      }
    });

    server.listen(startPort, () => {
      const { port } = server.address();
      server.close(() => {
        resolve(port);
      });
    });
  });
};

// CORS configuration with dynamic origin
const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://localhost:3003',
    'http://localhost:3004',
    'http://localhost:3005'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  credentials: true,
  maxAge: 86400
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads')); // Serve uploaded files
app.options('*', cors(corsOptions));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
  console.log('Authenticating request...');
  
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    console.log('No authorization header');
    return res.status(401).json({ error: 'No authorization header' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    console.log('No token in authorization header');
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const user = jwt.verify(token, JWT_SECRET);
    console.log('Token verified for user:', user.username);
    req.user = user;
    next();
  } catch (err) {
    console.error('Token verification failed:', err.message);
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// Public endpoints (no authentication required)
app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is running' });
});

// Temporary endpoint to create admin user (remove in production)
app.post('/api/setup-admin', async (req, res) => {
  try {
    const adminPassword = 'admin1234';
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    // Check if admin user exists
    const [existingUsers] = await db.promise().query('SELECT * FROM users WHERE username = ?', ['admin1234']);
    if (existingUsers.length > 0) {
      // Update existing admin password and role
      await db.promise().query(
        'UPDATE users SET password = ?, role = ? WHERE username = ?',
        [hashedPassword, 'admin', 'admin1234']
      );
      console.log('Admin password and role updated');
    } else {
      // Create new admin user with role admin
      await db.promise().query(
        'INSERT INTO users (username, password, email, contact, is_default, role) VALUES (?, ?, ?, ?, ?, ?)',
        ['admin1234', hashedPassword, 'admin@example.com', '+237000000000', 1, 'admin']
      );
      console.log('Admin user created');
    }
    res.json({ 
      message: 'Admin user setup complete',
      username: 'admin1234',
      password: 'admin1234'
    });
  } catch (error) {
    console.error('Error setting up admin:', error);
    res.status(500).json({ error: 'Failed to setup admin user' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  console.log('Login attempt for:', username);

  try {
    const [users] = await db.promise().query('SELECT * FROM users WHERE username = ?', [username]);
    
    if (users.length === 0) {
      console.log('User not found:', username);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password);
    
    if (!validPassword) {
      console.log('Invalid password for:', username);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Create token with expiration and role
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    // Send back user data (excluding password) along with token
    const userData = {
      id: user.id,
      username: user.username,
      contact: user.contact,
      created_at: user.created_at,
      role: user.role
    };

    console.log('Login successful for:', username);
    res.json({ 
      token,
      user: userData
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/register', async (req, res) => {
  console.log('Received registration request:', {
    body: req.body,
    headers: req.headers,
    method: req.method,
    url: req.url
  });
  
  const { username, contact, password } = req.body;

  if (!username || !password) {
    console.log('Missing required fields:', { username: !!username, password: !!password });
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    // Check if username exists
    const [users] = await db.promise().query('SELECT * FROM users WHERE username = ?', [username]);
    
    if (users.length > 0) {
      console.log('Username already exists:', username);
      return res.status(400).json({ error: 'Username already exists' });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create new user with role 'user'
    const [result] = await db.promise().query(
      'INSERT INTO users (username, contact, password, role) VALUES (?, ?, ?, ?)',
      [username, contact, hashedPassword, 'user']
    );
    
    console.log('Account created successfully:', { username, userId: result.insertId });
    res.status(201).json({ message: 'Account created successfully' });
  } catch (error) {
    console.error('Error in registration endpoint:', error);
    res.status(500).json({ error: `Failed to create account: ${error.message}` });
  }
});

app.post('/api/check-user', async (req, res) => {
  const { username } = req.body;
  console.log('Checking if user exists:', username);

  try {
    const [users] = await db.promise().query('SELECT username FROM users WHERE username = ?', [username]);
    
    if (users.length > 0) {
      console.log('User exists:', username);
      res.json({ exists: true });
    } else {
      console.log('User does not exist:', username);
      res.json({ exists: false });
    }
  } catch (error) {
    console.error('Error checking user:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/reset-password', async (req, res) => {
  const { username, newPassword } = req.body;
  console.log('Password reset request for:', username);

  try {
    // Check if user exists
    const [users] = await db.promise().query('SELECT * FROM users WHERE username = ?', [username]);
    
    if (users.length === 0) {
      console.log('User not found for password reset:', username);
      return res.status(404).json({ error: 'User not found' });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Update the password
    await db.promise().query(
      'UPDATE users SET password = ? WHERE username = ?',
      [hashedPassword, username]
    );
    
    console.log('Password reset successful for:', username);
    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/change-password', authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;

  try {
    // Get current user
    const [users] = await db.promise().query('SELECT * FROM users WHERE id = ?', [userId]);
    
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];
    
    // Verify current password
    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Update password
    await db.promise().query(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashedPassword, userId]
    );
    
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Users endpoints
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const [users] = await db.promise().query(
      'SELECT id, username, email, contact, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    
    console.log('Successfully fetched users:', users);
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Error fetching users' });
  }
});

// Students endpoints
app.post('/api/students', authenticateToken, upload.single('student_picture'), async (req, res) => {
  const { 
    full_name, 
    sex, 
    date_of_birth, 
    place_of_birth, 
    father_name, 
    mother_name, 
    previous_class, 
    next_class, 
    previous_average, 
    guardian_contact, 
    vocational_training 
  } = req.body;
  const userId = req.user.id;
  
  // Get file path from uploaded file
  const student_picture = req.file ? `/uploads/${req.file.filename}` : null;

  try {
    const [result] = await db.promise().query(
      `INSERT INTO students (user_id, full_name, sex, date_of_birth, place_of_birth, father_name, mother_name, previous_class, next_class, previous_average, guardian_contact, student_picture, vocational_training)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, full_name, sex, date_of_birth, place_of_birth, father_name, mother_name, previous_class, next_class, previous_average, guardian_contact, student_picture, vocational_training]
    );
    
    res.status(201).json({ id: result.insertId });
  } catch (error) {
    console.error('Error creating student:', error);
    res.status(500).json({ error: 'Error creating student' });
  }
});

// Students GET endpoint with admin logic
app.get('/api/students', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  const year = req.query.year ? parseInt(req.query.year) : null;
  try {
    let students, query, params;
    if (userRole === 'admin') {
      // Admin: see all students for the year
      if (year) {
        query = 'SELECT * FROM students WHERE YEAR(created_at) = ? ORDER BY created_at DESC';
        params = [year];
      } else {
        query = 'SELECT * FROM students ORDER BY created_at DESC';
        params = [];
      }
    } else {
      // Regular user: only see their own students
      if (year) {
        query = 'SELECT * FROM students WHERE user_id = ? AND YEAR(created_at) = ? ORDER BY created_at DESC';
        params = [userId, year];
      } else {
        query = 'SELECT * FROM students WHERE user_id = ? ORDER BY created_at DESC';
        params = [userId];
      }
    }
    [students] = await db.promise().query(query, params);
    res.json(students);
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({ error: 'Error fetching students' });
  }
});

app.put('/api/students/:id', authenticateToken, upload.single('student_picture'), async (req, res) => {
  const { 
    full_name, 
    sex, 
    date_of_birth, 
    place_of_birth, 
    father_name, 
    mother_name, 
    previous_class, 
    next_class, 
    previous_average, 
    guardian_contact, 
    vocational_training 
  } = req.body;
  const userId = req.user.id;
  const studentId = req.params.id;
  
  // Get file path from uploaded file
  const student_picture = req.file ? `/uploads/${req.file.filename}` : null;

  try {
    // First verify the student belongs to the user
    const [students] = await db.promise().query(
      'SELECT * FROM students WHERE id = ? AND user_id = ?',
      [studentId, userId]
    );

    if (students.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Build update query dynamically based on whether a new picture is provided
    let updateQuery = `UPDATE students 
       SET full_name = ?, sex = ?, date_of_birth = ?, place_of_birth = ?, father_name = ?, mother_name = ?, previous_class = ?, next_class = ?, previous_average = ?, guardian_contact = ?, vocational_training = ?`;
    let updateValues = [full_name, sex, date_of_birth, place_of_birth, father_name, mother_name, previous_class, next_class, previous_average, guardian_contact, vocational_training];
    
    if (student_picture !== null) {
      updateQuery += ', student_picture = ?';
      updateValues.push(student_picture);
    }
    
    updateQuery += ' WHERE id = ? AND user_id = ?';
    updateValues.push(studentId, userId);

    // Update the student
    await db.promise().query(updateQuery, updateValues);
    
    res.json({ message: 'Student updated successfully' });
  } catch (error) {
    console.error('Error updating student:', error);
    res.status(500).json({ error: 'Error updating student' });
  }
});

app.delete('/api/students/:id', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const studentId = req.params.id;

  try {
    // First verify the student belongs to the user
    const [students] = await db.promise().query(
      'SELECT * FROM students WHERE id = ? AND user_id = ?',
      [studentId, userId]
    );

    if (students.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Delete the student
    await db.promise().query(
      'DELETE FROM students WHERE id = ? AND user_id = ?',
      [studentId, userId]
    );
    
    res.json({ message: 'Student deleted successfully' });
  } catch (error) {
    console.error('Error deleting student:', error);
    res.status(500).json({ error: 'Error deleting student' });
  }
});

// Excel upload endpoint for bulk student registration
app.post('/api/students/upload', authenticateToken, excelUpload.single('file'), async (req, res) => {
  const userId = req.user.id;
  
  if (!req.file) {
    return res.status(400).json({ error: 'No Excel file uploaded' });
  }

  function parseExcelDate(dateStr) {
    if (!dateStr) return '';
    // If it's a number, treat as Excel serial date
    if (typeof dateStr === 'number') {
      // Excel's epoch starts at 1900-01-01
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(excelEpoch.getTime() + dateStr * 86400000);
      // Format as yyyy-mm-dd
      return d.toISOString().slice(0, 10);
    }
    // Accept both Date objects and strings
    if (dateStr instanceof Date) {
      return dateStr.toISOString().slice(0, 10);
    }
    if (typeof dateStr === 'string') {
      // Try to parse d-MMM-yyyy (e.g., 5-Dec-2025)
      const match = /^([0-9]{1,2})[-.\/]([A-Za-z]{3})[-.\/]([0-9]{4})$/.exec(dateStr.trim());
      if (match) {
        const day = match[1].padStart(2, '0');
        const monthStr = match[2].toLowerCase();
        const year = match[3];
        const months = {
          jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
          jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
        };
        const month = months[monthStr] || '01';
        return `${year}-${month}-${day}`;
      }
      // Try to parse yyyy-mm-dd
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
      // Fallback: return as is
      return dateStr;
    }
    // Fallback: return as is
    return dateStr;
  }

  function normalizeSex(sex) {
    if (!sex) return 'Male';
    const s = sex.toString().trim().toLowerCase();
    if (s === 'f' || s === 'female') return 'Female';
    return 'Male';
  }

  try {
    // Read the Excel file
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    // Skip the header row and process data
    const students = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      // Skip row if all fields are empty
      if (!row || row.length < 11 || row.every(cell => cell === undefined || cell === null || cell === '')) continue;
      if (row[0]) { // Only process if Full Name is present
        students.push({
          full_name: row[0] || '',
          sex: normalizeSex(row[1]),
          date_of_birth: parseExcelDate(row[2]),
          place_of_birth: row[3] || '',
          father_name: row[4] || '',
          mother_name: row[5] || '',
          previous_class: row[6] || '',
          next_class: row[7] || '',
          previous_average: row[8] || '',
          guardian_contact: row[9] || '',
          vocational_training: row[10] || ''
        });
      }
    }

    if (students.length === 0) {
      return res.status(400).json({ error: 'No valid student data found in the Excel file' });
    }

    // Insert students into database
    const insertPromises = students.map(student => {
      return db.promise().query(
        `INSERT INTO students (user_id, full_name, sex, date_of_birth, place_of_birth, father_name, mother_name, previous_class, next_class, previous_average, guardian_contact, vocational_training)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, student.full_name, student.sex, student.date_of_birth, student.place_of_birth, student.father_name, student.mother_name, student.previous_class, student.next_class, student.previous_average, student.guardian_contact, student.vocational_training]
      ).catch(err => {
        console.error('Failed to insert row:', student, err.message);
        throw err;
      });
    });

    await Promise.all(insertPromises);

    // Clean up the uploaded file
    const fs = require('fs');
    fs.unlinkSync(req.file.path);

    res.json({ 
      message: `${students.length} students uploaded successfully`,
      count: students.length
    });
  } catch (error) {
    console.error('Error uploading students:', error);
    
    // Clean up the uploaded file in case of error
    if (req.file) {
      const fs = require('fs');
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        console.error('Error deleting uploaded file:', unlinkError);
      }
    }
    
    res.status(500).json({ error: 'Error uploading students from Excel file', details: error.message });
  }
});

// Student analytics endpoint: students added per day for the last 30 days
app.get('/api/students/analytics/daily', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const year = req.query.year ? parseInt(req.query.year) : null;
  try {
    let rows;
    if (year) {
      [rows] = await db.promise().query(
        `SELECT DATE(created_at) as date, COUNT(*) as count
         FROM students
         WHERE user_id = ? AND YEAR(created_at) = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
         GROUP BY DATE(created_at)
         ORDER BY date ASC`,
        [userId, year]
      );
    } else {
      [rows] = await db.promise().query(
        `SELECT DATE(created_at) as date, COUNT(*) as count
         FROM students
         WHERE user_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
         GROUP BY DATE(created_at)
         ORDER BY date ASC`,
        [userId]
      );
    }
    res.json(rows);
  } catch (error) {
    console.error('Error fetching student analytics:', error);
    res.status(500).json({ error: 'Error fetching student analytics', details: error.message });
  }
});

// Classes endpoints
app.post('/api/classes', authenticateToken, async (req, res) => {
  const { 
    name, 
    registration_fee, 
    tuition_fee, 
    vocational_fee, 
    sport_wear_fee, 
    health_sanitation_fee, 
    number_of_installments,
    year
  } = req.body;
  const userId = req.user.id;

  try {
    const [result] = await db.promise().query(
      `INSERT INTO classes (user_id, name, registration_fee, tuition_fee, vocational_fee, sport_wear_fee, health_sanitation_fee, number_of_installments, year)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, name, registration_fee, tuition_fee, vocational_fee, sport_wear_fee, health_sanitation_fee, number_of_installments, year]
    );
    
    res.status(201).json({ id: result.insertId });
  } catch (error) {
    console.error('Error creating class:', error);
    res.status(500).json({ error: 'Error creating class' });
  }
});

app.get('/api/classes', authenticateToken, async (req, res) => {
  const year = req.query.year ? parseInt(req.query.year) : null;
  try {
    let query = 'SELECT * FROM classes';
    let params = [];
    if (year) {
      query += ' WHERE year = ?';
      params.push(year);
    }
    query += ' ORDER BY created_at DESC';
    const [classes] = await db.promise().query(query, params);
    res.json(classes);
  } catch (error) {
    console.error('Error fetching classes:', error);
    res.status(500).json({ error: 'Error fetching classes' });
  }
});

app.put('/api/classes/:id', authenticateToken, async (req, res) => {
  const { 
    name, 
    registration_fee, 
    tuition_fee, 
    vocational_fee, 
    sport_wear_fee, 
    health_sanitation_fee, 
    number_of_installments,
    year
  } = req.body;
  const userId = req.user.id;
  const classId = req.params.id;

  try {
    // First verify the class belongs to the user
    const [classes] = await db.promise().query(
      'SELECT * FROM classes WHERE id = ? AND user_id = ?',
      [classId, userId]
    );

    if (classes.length === 0) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // Update the class
    await db.promise().query(
      `UPDATE classes 
       SET name = ?, registration_fee = ?, tuition_fee = ?, vocational_fee = ?, sport_wear_fee = ?, health_sanitation_fee = ?, number_of_installments = ?, year = ?
       WHERE id = ? AND user_id = ?`,
      [name, registration_fee, tuition_fee, vocational_fee, sport_wear_fee, health_sanitation_fee, number_of_installments, year, classId, userId]
    );
    
    res.json({ message: 'Class updated successfully' });
  } catch (error) {
    console.error('Error updating class:', error);
    res.status(500).json({ error: 'Error updating class' });
  }
});

app.delete('/api/classes/:id', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const classId = req.params.id;

  try {
    // First verify the class belongs to the user
    const [classes] = await db.promise().query(
      'SELECT * FROM classes WHERE id = ? AND user_id = ?',
      [classId, userId]
    );

    if (classes.length === 0) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // Delete the class
    await db.promise().query(
      'DELETE FROM classes WHERE id = ? AND user_id = ?',
      [classId, userId]
    );
    
    res.json({ message: 'Class deleted successfully' });
  } catch (error) {
    console.error('Error deleting class:', error);
    res.status(500).json({ error: 'Error deleting class' });
  }
});

// Vocational endpoints
app.post('/api/vocational', authenticateToken, upload.fields([
  { name: 'picture1', maxCount: 1 },
  { name: 'picture2', maxCount: 1 },
  { name: 'picture3', maxCount: 1 },
  { name: 'picture4', maxCount: 1 }
]), async (req, res) => {
  const { title, description, year } = req.body;
  const userId = req.user.id;
  
  // Get file paths from uploaded files
  const picture1 = req.files.picture1 ? `/uploads/${req.files.picture1[0].filename}` : null;
  const picture2 = req.files.picture2 ? `/uploads/${req.files.picture2[0].filename}` : null;
  const picture3 = req.files.picture3 ? `/uploads/${req.files.picture3[0].filename}` : null;
  const picture4 = req.files.picture4 ? `/uploads/${req.files.picture4[0].filename}` : null;

  try {
    const [result] = await db.promise().query(
      `INSERT INTO vocational (user_id, name, description, picture1, picture2, picture3, picture4, year)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, title, description, picture1, picture2, picture3, picture4, year]
    );
    
    res.status(201).json({ id: result.insertId });
  } catch (error) {
    console.error('Error creating vocational department:', error);
    res.status(500).json({ error: 'Error creating vocational department' });
  }
});

app.get('/api/vocational', authenticateToken, async (req, res) => {
  const year = req.query.year ? parseInt(req.query.year) : null;
  try {
    let query = 'SELECT id, user_id, name as title, description, picture1, picture2, picture3, picture4, year, created_at, updated_at FROM vocational';
    let params = [];
    if (year) {
      query += ' WHERE year = ?';
      params.push(year);
    }
    query += ' ORDER BY created_at DESC';
    const [vocational] = await db.promise().query(query, params);
    res.json(vocational);
  } catch (error) {
    console.error('Error fetching vocational departments:', error);
    res.status(500).json({ error: 'Error fetching vocational departments' });
  }
});

app.put('/api/vocational/:id', authenticateToken, upload.fields([
  { name: 'picture1', maxCount: 1 },
  { name: 'picture2', maxCount: 1 },
  { name: 'picture3', maxCount: 1 },
  { name: 'picture4', maxCount: 1 }
]), async (req, res) => {
  const { title, description, year } = req.body;
  const userId = req.user.id;
  const vocationalId = req.params.id;
  
  // Get file paths from uploaded files
  const picture1 = req.files.picture1 ? `/uploads/${req.files.picture1[0].filename}` : null;
  const picture2 = req.files.picture2 ? `/uploads/${req.files.picture2[0].filename}` : null;
  const picture3 = req.files.picture3 ? `/uploads/${req.files.picture3[0].filename}` : null;
  const picture4 = req.files.picture4 ? `/uploads/${req.files.picture4[0].filename}` : null;

  try {
    // First verify the vocational department belongs to the user
    const [vocational] = await db.promise().query(
      'SELECT * FROM vocational WHERE id = ? AND user_id = ?',
      [vocationalId, userId]
    );

    if (vocational.length === 0) {
      return res.status(404).json({ error: 'Vocational department not found' });
    }

    // Build update query dynamically based on what's provided
    let updateQuery = 'UPDATE vocational SET name = ?, description = ?, year = ?';
    let updateValues = [title, description, year];
    
    if (picture1 !== null) {
      updateQuery += ', picture1 = ?';
      updateValues.push(picture1);
    }
    if (picture2 !== null) {
      updateQuery += ', picture2 = ?';
      updateValues.push(picture2);
    }
    if (picture3 !== null) {
      updateQuery += ', picture3 = ?';
      updateValues.push(picture3);
    }
    if (picture4 !== null) {
      updateQuery += ', picture4 = ?';
      updateValues.push(picture4);
    }
    
    updateQuery += ' WHERE id = ? AND user_id = ?';
    updateValues.push(vocationalId, userId);

    // Update the vocational department
    await db.promise().query(updateQuery, updateValues);
    
    res.json({ message: 'Vocational department updated successfully' });
  } catch (error) {
    console.error('Error updating vocational department:', error);
    res.status(500).json({ error: 'Error updating vocational department' });
  }
});

app.delete('/api/vocational/:id', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const vocationalId = req.params.id;

  try {
    // First verify the vocational department belongs to the user
    const [vocational] = await db.promise().query(
      'SELECT * FROM vocational WHERE id = ? AND user_id = ?',
      [vocationalId, userId]
    );

    if (vocational.length === 0) {
      return res.status(404).json({ error: 'Vocational department not found' });
    }

    // Delete the vocational department
    await db.promise().query(
      'DELETE FROM vocational WHERE id = ? AND user_id = ?',
      [vocationalId, userId]
    );
    
    res.json({ message: 'Vocational department deleted successfully' });
  } catch (error) {
    console.error('Error deleting vocational department:', error);
    res.status(500).json({ error: 'Error deleting vocational department' });
  }
});

// Teachers endpoints
app.post('/api/teachers', authenticateToken, async (req, res) => {
  const { teacher_name, subjects, id_card, classes_taught, salary_amount } = req.body;
  const userId = req.user.id;

  try {
    const [result] = await db.promise().query(
      `INSERT INTO teachers (user_id, teacher_name, subjects, id_card, classes_taught, salary_amount)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, teacher_name, subjects, id_card, classes_taught, salary_amount]
    );
    
    res.status(201).json({ id: result.insertId });
  } catch (error) {
    console.error('Error creating teacher:', error);
    res.status(500).json({ error: 'Error creating teacher' });
  }
});

app.get('/api/teachers', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const year = req.query.year ? parseInt(req.query.year) : null;
  try {
    let teachers, query, params;
    if (year) {
      query = 'SELECT * FROM teachers WHERE user_id = ? AND YEAR(created_at) = ? ORDER BY created_at DESC';
      params = [userId, year];
    } else {
      query = 'SELECT * FROM teachers WHERE user_id = ? ORDER BY created_at DESC';
      params = [userId];
    }
    [teachers] = await db.promise().query(query, params);
    res.json(teachers);
  } catch (error) {
    console.error('Error fetching teachers:', error);
    res.status(500).json({ error: 'Error fetching teachers' });
  }
});

app.put('/api/teachers/:id', authenticateToken, async (req, res) => {
  const { teacher_name, subjects, id_card, classes_taught, salary_amount } = req.body;
  const userId = req.user.id;
  const teacherId = req.params.id;

  try {
    // First verify the teacher belongs to the user
    const [teachers] = await db.promise().query(
      'SELECT * FROM teachers WHERE id = ? AND user_id = ?',
      [teacherId, userId]
    );

    if (teachers.length === 0) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    // Update the teacher
    await db.promise().query(
      `UPDATE teachers 
       SET teacher_name = ?, subjects = ?, id_card = ?, classes_taught = ?, salary_amount = ?
       WHERE id = ? AND user_id = ?`,
      [teacher_name, subjects, id_card, classes_taught, salary_amount, teacherId, userId]
    );
    
    res.json({ message: 'Teacher updated successfully' });
  } catch (error) {
    console.error('Error updating teacher:', error);
    res.status(500).json({ error: 'Error updating teacher' });
  }
});

app.delete('/api/teachers/:id', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const teacherId = req.params.id;

  try {
    // First verify the teacher belongs to the user
    const [teachers] = await db.promise().query(
      'SELECT * FROM teachers WHERE id = ? AND user_id = ?',
      [teacherId, userId]
    );

    if (teachers.length === 0) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    // Delete the teacher
    await db.promise().query(
      'DELETE FROM teachers WHERE id = ? AND user_id = ?',
      [teacherId, userId]
    );
    
    res.json({ message: 'Teacher deleted successfully' });
  } catch (error) {
    console.error('Error deleting teacher:', error);
    res.status(500).json({ error: 'Error deleting teacher' });
  }
});

// Teacher analytics endpoint: teachers added per day for the last 30 days
app.get('/api/teachers/analytics/daily', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const year = req.query.year ? parseInt(req.query.year) : null;
  try {
    let rows;
    if (year) {
      [rows] = await db.promise().query(
        `SELECT DATE(created_at) as date, COUNT(*) as count
         FROM teachers
         WHERE user_id = ? AND YEAR(created_at) = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
         GROUP BY DATE(created_at)
         ORDER BY date ASC`,
        [userId, year]
      );
    } else {
      [rows] = await db.promise().query(
        `SELECT DATE(created_at) as date, COUNT(*) as count
         FROM teachers
         WHERE user_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
         GROUP BY DATE(created_at)
         ORDER BY date ASC`,
        [userId]
      );
    }
    res.json(rows);
  } catch (error) {
    console.error('Error fetching teacher analytics:', error);
    res.status(500).json({ error: 'Error fetching teacher analytics', details: error.message });
  }
});

// Fee analytics endpoint: total fee amount paid per day for the last 30 days
app.get('/api/fees/analytics/daily', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const year = req.query.year ? parseInt(req.query.year) : null;
  try {
    // Get raw results from DB
    let rows;
    if (year) {
      [rows] = await db.promise().query(
        `SELECT DATE(f.paid_at) as date, SUM(f.amount) as total
         FROM fees f
         JOIN students s ON f.student_id = s.id
         WHERE s.user_id = ? AND YEAR(f.paid_at) = ? AND f.paid_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
         GROUP BY DATE(f.paid_at)
         ORDER BY date ASC`,
        [userId, year]
      );
    } else {
      [rows] = await db.promise().query(
        `SELECT DATE(f.paid_at) as date, SUM(f.amount) as total
         FROM fees f
         JOIN students s ON f.student_id = s.id
         WHERE s.user_id = ? AND f.paid_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
         GROUP BY DATE(f.paid_at)
         ORDER BY date ASC`,
        [userId]
      );
    }
    // Build a map for quick lookup
    const totalsByDate = {};
    rows.forEach(row => {
      totalsByDate[row.date] = parseFloat(row.total);
    });
    // Generate last 30 days
    const result = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      result.push({
        date: dateStr,
        total: totalsByDate[dateStr] || 0
      });
    }
    res.json(result);
  } catch (error) {
    console.error('Error fetching fee analytics:', error);
    res.status(500).json({ error: 'Error fetching fee analytics', details: error.message });
  }
});

// FEES & ID CARDS ENDPOINTS

// 1. Search students for auto-suggest
app.get('/api/students/search', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const query = req.query.query || '';
  try {
    const [students] = await db.promise().query(
      'SELECT id, full_name, class_id FROM students WHERE user_id = ? AND full_name LIKE ? ORDER BY full_name ASC LIMIT 10',
      [userId, `%${query}%`]
    );
    res.json(students);
  } catch (error) {
    res.status(500).json({ error: 'Error searching students' });
  }
});

// 2. Get student class and fee balance
app.get('/api/student/:id/fees', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const studentId = req.params.id;
  const year = req.query.year ? parseInt(req.query.year) : null;
  try {
    // Get student and class
    const [[student]] = await db.promise().query(
      'SELECT s.id, s.full_name, s.class_id, c.name as class_name, c.registration_fee, c.tuition_fee, c.vocational_fee, c.sport_wear_fee, c.health_sanitation_fee FROM students s JOIN classes c ON s.class_id = c.id WHERE s.id = ? AND s.user_id = ?',
      [studentId, userId]
    );
    if (!student) return res.status(404).json({ error: 'Student not found' });
    // Get all fees paid
    let fees;
    if (year) {
      [fees] = await db.promise().query(
        'SELECT fee_type, SUM(amount) as paid FROM fees WHERE student_id = ? AND YEAR(paid_at) = ? GROUP BY fee_type',
        [studentId, year]
      );
    } else {
      [fees] = await db.promise().query(
        'SELECT fee_type, SUM(amount) as paid FROM fees WHERE student_id = ? GROUP BY fee_type',
        [studentId]
      );
    }
    // Calculate balances
    const feeMap = Object.fromEntries(fees.map(f => [f.fee_type, parseFloat(f.paid)]));
    const balance = {
      Registration: Math.max(0, parseFloat(student.registration_fee) - (feeMap['Registration'] || 0)),
      Tuition: Math.max(0, parseFloat(student.tuition_fee) - (feeMap['Tuition'] || 0)),
      Vocational: Math.max(0, parseFloat(student.vocational_fee) - (feeMap['Vocational'] || 0)),
      'Sport Wear': Math.max(0, parseFloat(student.sport_wear_fee) - (feeMap['Sport Wear'] || 0)),
      'Sanitation & Health': Math.max(0, parseFloat(student.health_sanitation_fee) - (feeMap['Sanitation & Health'] || 0)),
    };
    res.json({ student, balance });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching student fees' });
  }
});

// 3. Record a fee payment
app.post('/api/fees', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { student_id, class_id, fee_type, amount, paid_at } = req.body;
  try {
    // Optionally: check if student belongs to user
    if (paid_at) {
      await db.promise().query(
        'INSERT INTO fees (student_id, class_id, fee_type, amount, paid_at) VALUES (?, ?, ?, ?, ?)',
        [student_id, class_id, fee_type, amount, paid_at]
      );
    } else {
      await db.promise().query(
        'INSERT INTO fees (student_id, class_id, fee_type, amount) VALUES (?, ?, ?, ?)',
        [student_id, class_id, fee_type, amount]
      );
    }
    res.json({ message: 'Fee payment recorded' });
  } catch (error) {
    res.status(500).json({ error: 'Error recording fee payment' });
  }
});

// 4. Get fee stats for a class
app.get('/api/fees/class/:classId', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const classId = req.params.classId;
  const year = req.query.year ? parseInt(req.query.year) : null;
  try {
    // Get all students in class
    const [students] = await db.promise().query(
      'SELECT s.id, s.full_name, c.registration_fee, c.tuition_fee, c.vocational_fee, c.sport_wear_fee, c.health_sanitation_fee FROM students s JOIN classes c ON s.class_id = c.id WHERE s.class_id = ? AND s.user_id = ?',
      [classId, userId]
    );
    // Get all fees for these students
    const studentIds = students.map(s => s.id);
    let fees = [];
    if (studentIds.length > 0) {
      const placeholders = studentIds.map(() => '?').join(',');
      if (year) {
        [fees] = await db.promise().query(
          `SELECT student_id, fee_type, SUM(amount) as paid FROM fees WHERE student_id IN (${placeholders}) AND YEAR(paid_at) = ? GROUP BY student_id, fee_type`,
          [...studentIds, year]
        );
      } else {
        [fees] = await db.promise().query(
          `SELECT student_id, fee_type, SUM(amount) as paid FROM fees WHERE student_id IN (${placeholders}) GROUP BY student_id, fee_type`,
          studentIds
        );
      }
    }
    // Map fees by student
    const feeMap = {};
    for (const f of fees) {
      if (!feeMap[f.student_id]) feeMap[f.student_id] = {};
      feeMap[f.student_id][f.fee_type] = parseFloat(f.paid);
    }
    // Build stats
    const stats = students.map(s => {
      const paid = feeMap[s.id] || {};
      const reg = parseFloat(s.registration_fee);
      const tui = parseFloat(s.tuition_fee);
      const voc = parseFloat(s.vocational_fee);
      const sport = parseFloat(s.sport_wear_fee);
      const health = parseFloat(s.health_sanitation_fee);
      const total = reg + tui + voc + sport + health;
      const paidReg = paid['Registration'] || 0;
      const paidTui = paid['Tuition'] || 0;
      const paidVoc = paid['Vocational'] || 0;
      const paidSport = paid['Sport Wear'] || 0;
      const paidHealth = paid['Sanitation & Health'] || 0;
      const paidTotal = paidReg + paidTui + paidVoc + paidSport + paidHealth;
      return {
        name: s.full_name,
        Registration: paidReg,
        Tuition: paidTui,
        Vocational: paidVoc,
        'Sport Wear': paidSport,
        'Sanitation & Health': paidHealth,
        Total: paidTotal,
        Balance: Math.max(0, total - paidTotal),
        Status: paidTotal >= total ? 'Paid' : 'Owing'
      };
    });
    res.json(stats);
  } catch (error) {
    console.error('Error in /api/fees/class/:classId:', error);
    res.status(500).json({ error: 'Error fetching class fee stats', details: error.message });
  }
});

// 5. List students for ID cards
app.get('/api/idcards/students', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    const [students] = await db.promise().query(
      'SELECT s.id, s.full_name, s.sex, s.date_of_birth, s.place_of_birth, s.father_name, s.mother_name, s.guardian_contact, s.student_picture, c.name as class_name FROM students s JOIN classes c ON s.class_id = c.id WHERE s.user_id = ?',
      [userId]
    );
    res.json(students);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching students for ID cards' });
  }
});

// Get current user endpoint
app.get('/api/users/current', authenticateToken, async (req, res) => {
  try {
    const [users] = await db.promise().query(
      'SELECT id, username, contact FROM users WHERE id = ?',
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];
    res.json({
      id: user.id,
      username: user.username,
      contact: user.contact
    });
  } catch (error) {
    console.error('Error fetching current user:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Logout endpoint
app.post('/api/logout', authenticateToken, (req, res) => {
  // In a more complex system, you might want to invalidate the token here
  // For now, we'll just send a success response
  res.json({ message: 'Logged out successfully' });
});

// Endpoint: Get total fees paid for the current year
app.get('/api/fees/total/yearly', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const year = req.query.year ? parseInt(req.query.year) : null;
  try {
    let rows;
    if (year) {
      [rows] = await db.promise().query(
        `SELECT SUM(amount) as total
         FROM fees f
         JOIN students s ON f.student_id = s.id
         WHERE s.user_id = ? AND YEAR(f.paid_at) = ?`,
        [userId, year]
      );
    } else {
      [rows] = await db.promise().query(
        `SELECT SUM(amount) as total
         FROM fees f
         JOIN students s ON f.student_id = s.id
         WHERE s.user_id = ? AND YEAR(f.paid_at) = YEAR(CURDATE())`,
        [userId]
      );
    }
    const total = rows[0]?.total || 0;
    res.json({ total });
  } catch (error) {
    console.error('Error fetching yearly total fees:', error);
    res.status(500).json({ error: 'Error fetching yearly total fees', details: error.message });
  }
});

// Automatic migration: add 'role' column to users if missing, and set admin role
async function ensureUserRoles() {
  try {
    // Add 'role' column if it doesn't exist
    await db.promise().query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user'`);
    // Set admin user role
    await db.promise().query(`UPDATE users SET role = 'admin' WHERE username = 'admin1234'`);
  } catch (err) {
    console.error('Error ensuring user roles:', err);
  }
}

// Database verification function
function verifyDatabaseStructure() {
  return new Promise((resolve, reject) => {
    const requiredTables = [
      'users',
      'students',
      'classes',
      'vocational',
      'teachers',
      'fees',
      'id_cards'
    ];

    const checkTable = (tableName) => {
      return new Promise((resolveTable, rejectTable) => {
        db.query(`SHOW TABLES LIKE '${tableName}'`, (err, results) => {
          if (err) {
            console.error(`Error checking table ${tableName}:`, err);
            rejectTable(err);
          } else {
            if (results.length === 0) {
              console.log(`Table ${tableName} does not exist`);
              resolveTable(false);
            } else {
              console.log(`Table ${tableName} exists`);
              resolveTable(true);
            }
          }
        });
      });
    };

    Promise.all(requiredTables.map(checkTable))
      .then((results) => {
        const allTablesExist = results.every(exists => exists);
        if (allTablesExist) {
          console.log('All required tables exist');
          resolve(true);
        } else {
          console.log('Some required tables are missing');
          resolve(false);
        }
      })
      .catch(reject);
  });
}

// Database initialization function
async function initializeDatabase() {
  try {
    console.log('Initializing database...');
    
    // Read and execute the SQL file
    const fs = require('fs');
    const sqlPath = path.join(__dirname, 'init-db.sql');
    
    if (!fs.existsSync(sqlPath)) {
      throw new Error(`SQL file not found: ${sqlPath}`);
    }
    
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    const statements = sqlContent.split(';').filter(stmt => stmt.trim());
    
    for (const statement of statements) {
      if (statement.trim()) {
        await db.promise().query(statement);
      }
    }
    
    // Run migration to add class_id column if it doesn't exist
    await runMigrations();
    
    console.log('Database initialized successfully');
    return true;
  } catch (error) {
    console.error('Error initializing database:', error);
    return false;
  }
}

// Migration function to add class_id column
async function runMigrations() {
  try {
    console.log('Running migrations...');
    
    // Check if class_id column exists
    const [columns] = await db.promise().query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'mpasat_online' AND TABLE_NAME = 'students' AND COLUMN_NAME = 'class_id'"
    );
    
    if (columns.length === 0) {
      console.log('Adding class_id column to students table...');
      await db.promise().query('ALTER TABLE students ADD COLUMN class_id INT');
      
      // Add foreign key constraint
      await db.promise().query(
        'ALTER TABLE students ADD CONSTRAINT students_ibfk_2 FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL'
      );
      console.log('class_id column and foreign key added successfully');
    } else {
      console.log('class_id column already exists');
    }

    // Assign first available class to students with NULL class_id
    const [classes] = await db.promise().query('SELECT id FROM classes LIMIT 1');
    if (classes.length > 0) {
      const classId = classes[0].id;
      const [result] = await db.promise().query('UPDATE students SET class_id = ? WHERE class_id IS NULL', [classId]);
      console.log(`Assigned class_id=${classId} to ${result.affectedRows} students with NULL class_id.`);
    } else {
      console.log('No classes found to assign to students.');
    }
  } catch (error) {
    console.error('Migration error:', error);
    // Don't throw error for migration failures, just log them
  }
}

// Database connection
let db;

const connectToDatabase = () => {
  return new Promise((resolve, reject) => {
    // First connect without specifying database
    const initialConnection = mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      charset: 'utf8mb4'
    });

    initialConnection.connect((err) => {
      if (err) {
        console.error('Error connecting to MySQL server:', err);
        reject(err);
        return;
      }

      console.log('Connected to MySQL server');

      // Create database if it doesn't exist
      initialConnection.query('CREATE DATABASE IF NOT EXISTS mpasat_online', (err) => {
        if (err) {
          console.error('Error creating database:', err);
          initialConnection.end();
          reject(err);
          return;
        }

        console.log('Database "mpasat_online" created or already exists');
        initialConnection.end();

        // Now connect to the specific database
        db = mysql.createConnection({
          host: 'localhost',
          user: 'root',
          password: '',
          database: 'mpasat_online',
          charset: 'utf8mb4'
        });

        db.connect(async (err) => {
          if (err) {
            console.error('Error connecting to database:', err);
            reject(err);
          } else {
            console.log('Connected to MySQL database "mpasat_online"');
            // Ensure user roles after db is ready
            await ensureUserRoles();
            resolve();
          }
        });

        db.on('error', (err) => {
          console.error('Database error:', err);
          if (err.code === 'PROTOCOL_CONNECTION_LOST') {
            console.log('Database connection was lost. Reconnecting...');
            connectToDatabase();
          } else {
            throw err;
          }
        });
      });
    });
  });
};

// Public endpoint: get all vocationals for Home page
app.get('/api/vocational/public', async (req, res) => {
  try {
    const [vocational] = await db.promise().query(
      'SELECT id, name as title, description, picture1, picture2, picture3, picture4, year, created_at, updated_at FROM vocational ORDER BY created_at DESC'
    );
    res.json(vocational);
  } catch (error) {
    console.error('Error fetching public vocational departments:', error);
    res.status(500).json({ error: 'Error fetching vocational departments' });
  }
});

// Serve static files from the React app build
app.use(express.static(path.join(__dirname, '../frontend/build')));

// Catch-all handler: for any request that doesn't match an API route, send back React's index.html
app.get('*', (req, res) => {
  // Only serve index.html for non-API requests
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, '../frontend/build', 'index.html'));
  } else {
    res.status(404).json({ error: 'API route not found' });
  }
});

// Modified server startup
const startServer = async () => {
  try {
    // Kill any process using port 5000
    if (process.platform === 'win32') {
      try {
        await execAsync('netstat -ano | findstr :5000');
        await execAsync('for /f "tokens=5" %a in (\'netstat -aon ^| findstr :5000\') do taskkill /F /PID %a');
        console.log('Killed existing process on port 5000');
      } catch (error) {
        // No process was found on port 5000, which is fine
      }
    } else {
      try {
        await execAsync('lsof -i :5000 | grep LISTEN | awk \'{print $2}\' | xargs kill -9');
        console.log('Killed existing process on port 5000');
      } catch (error) {
        // No process was found on port 5000, which is fine
      }
    }

    // Connect to database
    await connectToDatabase();
    
    // Verify database structure
    const structureValid = await verifyDatabaseStructure();
    
    if (!structureValid) {
      console.log('Database structure invalid, initializing...');
      const initSuccess = await initializeDatabase();
      if (!initSuccess) {
        throw new Error('Failed to initialize database');
      }
    } else {
      // Run migrations even if structure is valid
      await runMigrations();
    }

    // Find available port
    const availablePort = await findAvailablePort(PORT);
    
    app.listen(availablePort, () => {
      console.log(`Server running on port ${availablePort}`);
      console.log(`Frontend should be accessible at: http://localhost:${availablePort}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
startServer(); 