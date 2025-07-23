process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const net = require('net');
const { exec } = require('child_process');
const util = require('util');
const multer = require('multer');
const XLSX = require('xlsx');
const execAsync = util.promisify(exec);
const { Pool } = require('pg');
require('dotenv').config();
console.log('DATABASE_URL:', process.env.DATABASE_URL);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const PORT = 5000;

// Log every incoming request
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

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

// Use memory storage for student uploads
const upload = multer({ storage: multer.memoryStorage() });

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
    'https://votech-latest-front.onrender.com', // added for new frontend
 
    'http://localhost:3000',             // local development
    'http://localhost:3004'              // local development (alternate port)
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
    const result = await pool.query('SELECT * FROM users WHERE username = $1', ['admin1234']);
    const existingUsers = result.rows;
    if (existingUsers.length > 0) {
      // Update existing admin password and role
      await pool.query(
        'UPDATE users SET password = $1, role = $2 WHERE username = $3',
        [hashedPassword, 'admin', 'admin1234']
      );
      console.log('Admin password and role updated');
    } else {
      // Create new admin user with role admin
      await pool.query(
        'INSERT INTO users (username, password, email, contact, is_default, role) VALUES ($1, $2, $3, $4, $5, $6)',
        ['admin1234', hashedPassword, 'admin@example.com', '+237000000000', true, 'admin']
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
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const users = result.rows;
    if (users.length === 0) {
      console.log('User not found:', username);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = users[0];
    if (user.suspended) {
      return res.status(403).json({ error: 'This account is suspended. Please contact the administrator.' });
    }
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
    // Check for academic years if admin
    let requireAcademicYear = false;
    if (["Admin1", "Admin2", "Admin3", "Admin4"].includes(user.role)) {
      const yearsResult = await pool.query('SELECT COUNT(*) FROM academic_years');
      const count = parseInt(yearsResult.rows[0].count, 10);
      requireAcademicYear = count === 0; // or set to true to always require
    }
    console.log('Login successful for:', username);
    res.json({ 
      token,
      user: userData,
      requireAcademicYear
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
  const { username, contact, password, role, name, email, gender } = req.body;
  if (!username || !password) {
    console.log('Missing required fields:', { username: !!username, password: !!password });
    return res.status(400).json({ error: 'Username and password are required' });
  }
  // Expanded allowed roles
  const allowedRoles = [
    'student', 'teacher', 'parent',
    'Admin1', 'Admin2', 'Admin3', 'Admin4',
    'Secretary', 'Discipline', 'Psychosocialist'
  ];
  let userRole = (role && allowedRoles.includes(role)) ? role : 'student';
  try {
    // Check if username exists
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const users = result.rows;
    if (users.length > 0) {
      console.log('Username already exists:', username);
      return res.status(400).json({ error: 'Username already exists' });
    }
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);
    // Create new user with all fields
    const insertResult = await pool.query(
      'INSERT INTO users (username, contact, password, role, name, email, gender) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [username, contact, hashedPassword, userRole, name, email, gender]
    );
    const newUser = insertResult.rows[0];
    console.log('Account created successfully:', { username, userId: newUser.id, role: userRole });
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
    const [users] = await pool.query('SELECT username FROM users WHERE username = $1', [username]);
    
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
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const users = result.rows;
    if (users.length === 0) {
      console.log('User not found for password reset:', username);
      return res.status(404).json({ error: 'User not found' });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Update the password
    await pool.query(
      'UPDATE users SET password = $1 WHERE username = $2',
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
    const [users] = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    
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
    await pool.query(
      'UPDATE users SET password = $1 WHERE id = $2',
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
    const [users] = await pool.query('SELECT id, username, email, contact, created_at FROM users WHERE id = $1', [req.user.id]);
    
    console.log('Successfully fetched users:', users);
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Error fetching users' });
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
          guardian_contact: row[6] || '',
          vocational_training: row[7] || '',
          class_id: row[8] || '',
          year: row[9] || ''
        });
      }
    }

    if (students.length === 0) {
      return res.status(400).json({ error: 'No valid student data found in the Excel file' });
    }

    // Insert students into database
    const insertPromises = students.map(student => {
      return pool.query(
        `INSERT INTO students (user_id, full_name, sex, date_of_birth, place_of_birth, father_name, mother_name, guardian_contact, vocational_training, student_picture, class_id, year)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        [userId, student.full_name, student.sex, student.date_of_birth, student.place_of_birth, student.father_name, student.mother_name, student.guardian_contact, student.vocational_training, student.student_picture, student.class_id, student.year]
      ).catch(err => {
        console.error('Failed to insert row:', student, err.message);
        throw err;
      });
    });

    const results = await Promise.all(insertPromises);

    // Clean up the uploaded file
    const fs = require('fs');
    fs.unlinkSync(req.file.path);

    res.json({ 
      message: `${results.length} students uploaded successfully`,
      count: results.length
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

// Student analytics endpoint: students added per day for all time
app.get('/api/students/analytics/daily', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM students
       GROUP BY DATE(created_at)
       ORDER BY date ASC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching student analytics:', error);
    res.status(500).json({ error: 'Error fetching student analytics', details: error.message });
  }
});

// Student analytics endpoint: students added per month (all time)
app.get('/api/students/analytics/monthly', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT TO_CHAR(created_at, 'YYYY-MM') as month, COUNT(*) as count
       FROM students
       GROUP BY month
       ORDER BY month ASC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching student monthly analytics:', error);
    res.status(500).json({ error: 'Error fetching student monthly analytics', details: error.message });
  }
});

// CLASSES ENDPOINTS
app.get('/api/classes', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM classes ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching classes:', error);
    res.status(500).json({ error: 'Error fetching classes', details: error.message });
  }
});

// Remove authentication for class creation
app.post('/api/classes', async (req, res) => {
  console.log('POST /api/classes called', req.body);
  const { name, registration_fee, bus_fee, internship_fee, remedial_fee, tuition_fee, pta_fee, total_fee, suspended } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO classes (name, registration_fee, bus_fee, internship_fee, remedial_fee, tuition_fee, pta_fee, total_fee, suspended)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [name, registration_fee, bus_fee, internship_fee, remedial_fee, tuition_fee, pta_fee, total_fee, suspended || false]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating class:', error);
    res.status(500).json({ error: 'Error creating class', details: error.message });
  }
});

app.put('/api/classes/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, registration_fee, bus_fee, internship_fee, remedial_fee, tuition_fee, pta_fee, total_fee, suspended } = req.body;
  try {
    const result = await pool.query(
      `UPDATE classes SET name=$1, registration_fee=$2, bus_fee=$3, internship_fee=$4, remedial_fee=$5, tuition_fee=$6, pta_fee=$7, total_fee=$8, suspended=$9 WHERE id=$10 RETURNING *`,
      [name, registration_fee, bus_fee, internship_fee, remedial_fee, tuition_fee, pta_fee, total_fee, suspended || false, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Class not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating class:', error);
    res.status(500).json({ error: 'Error updating class', details: error.message });
  }
});

app.delete('/api/classes/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM classes WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting class:', error);
    res.status(500).json({ error: 'Error deleting class', details: error.message });
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
    const result = await pool.query(
      `INSERT INTO vocational (user_id, name, description, picture1, picture2, picture3, picture4, year)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [userId, title, description, picture1, picture2, picture3, picture4, year]
    );
    
    res.status(201).json({ id: result.rows[0].id });
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
      query += ' WHERE year = $1';
      params.push(year);
    }
    query += ' ORDER BY created_at DESC';
    const resultVoc = await pool.query(query, params);
    res.json(resultVoc.rows);
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
  const picture1 = req.files.picture1 ? `/uploads/${req.files.picture1[0].filename}` : undefined;
  const picture2 = req.files.picture2 ? `/uploads/${req.files.picture2[0].filename}` : undefined;
  const picture3 = req.files.picture3 ? `/uploads/${req.files.picture3[0].filename}` : undefined;
  const picture4 = req.files.picture4 ? `/uploads/${req.files.picture4[0].filename}` : undefined;

  try {
    // First verify the vocational department belongs to the user
    const resultVocPut = await pool.query(
      'SELECT * FROM vocational WHERE id = $1 AND user_id = $2',
      [vocationalId, userId]
    );
    if (resultVocPut.rows.length === 0) {
      return res.status(404).json({ error: 'Vocational department not found' });
    }

    // Build update query and values dynamically
    let updateFields = ['name = $1', 'description = $2', 'year = $3'];
    let updateValues = [title, description, year];
    let paramIndex = 4;
    if (picture1 !== undefined) {
      updateFields.push(`picture1 = $${paramIndex}`);
      updateValues.push(picture1);
      paramIndex++;
    }
    if (picture2 !== undefined) {
      updateFields.push(`picture2 = $${paramIndex}`);
      updateValues.push(picture2);
      paramIndex++;
    }
    if (picture3 !== undefined) {
      updateFields.push(`picture3 = $${paramIndex}`);
      updateValues.push(picture3);
      paramIndex++;
    }
    if (picture4 !== undefined) {
      updateFields.push(`picture4 = $${paramIndex}`);
      updateValues.push(picture4);
      paramIndex++;
    }
    // Add WHERE clause
    updateFields = updateFields.join(', ');
    updateValues.push(vocationalId, userId);
    const updateQuery = `UPDATE vocational SET ${updateFields} WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}`;

    // Update the vocational department
    await pool.query(updateQuery, updateValues);
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
    const resultVocDel = await pool.query(
      'SELECT * FROM vocational WHERE id = $1 AND user_id = $2',
      [vocationalId, userId]
    );
    if (resultVocDel.rows.length === 0) {
      return res.status(404).json({ error: 'Vocational department not found' });
    }

    // Delete the vocational department
    await pool.query(
      'DELETE FROM vocational WHERE id = $1 AND user_id = $2',
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
  const { teacher_name, subjects, id_card } = req.body;
  const userId = req.user.id;

  try {
    // Check if user has already registered a teacher
    const existingTeacher = await pool.query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [userId]
    );
    
    if (existingTeacher.rows.length > 0) {
      return res.status(400).json({ error: 'You have already registered a teacher. Only one teacher registration is allowed per account.' });
    }

    const result = await pool.query(
      `INSERT INTO teachers (user_id, teacher_name, subjects, id_card, status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING *`,
      [userId, teacher_name, subjects, id_card]
    );
    
    res.status(201).json({ id: result.rows[0].id });
  } catch (error) {
    console.error('Error creating teacher:', error);
    res.status(500).json({ error: 'Error creating teacher' });
  }
});

// Teachers GET endpoint: always filter by user_id
app.get('/api/teachers', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const year = req.query.year ? parseInt(req.query.year) : null;
  try {
    let query, params;
    if (year) {
      query = 'SELECT * FROM teachers WHERE user_id = $1 AND EXTRACT(YEAR FROM created_at) = $2 ORDER BY created_at DESC';
      params = [userId, year];
    } else {
      query = 'SELECT * FROM teachers WHERE user_id = $1 ORDER BY created_at DESC';
      params = [userId];
    }
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching teachers:', error);
    res.status(500).json({ error: 'Error fetching teachers' });
  }
});

app.put('/api/teachers/:id', authenticateToken, async (req, res) => {
  const { teacher_name, subjects, id_card, classes_taught, salary_amount } = req.body;
  const userId = req.user.id;
  const userRole = req.user.role;
  const teacherId = req.params.id;

  try {
    let resultTeacher;
    
    if (userRole === 'admin') {
      // Admin can edit any teacher
      resultTeacher = await pool.query(
        'SELECT * FROM teachers WHERE id = $1',
        [teacherId]
      );
    } else {
      // Regular users can only edit their own teachers
      resultTeacher = await pool.query(
        'SELECT * FROM teachers WHERE id = $1 AND user_id = $2',
        [teacherId, userId]
      );
    }
    
    if (resultTeacher.rows.length === 0) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    // Update the teacher
    let result;
    if (userRole === 'admin') {
      // Admin can update any teacher
      result = await pool.query(
        `UPDATE teachers 
         SET teacher_name = $1, subjects = $2, id_card = $3, classes_taught = $4, salary_amount = $5
         WHERE id = $6 RETURNING *`,
        [teacher_name, subjects, id_card, classes_taught, salary_amount, teacherId]
      );
    } else {
      // Regular users can only update their own teachers
      result = await pool.query(
        `UPDATE teachers 
         SET teacher_name = $1, subjects = $2, id_card = $3, classes_taught = $4, salary_amount = $5
         WHERE id = $6 AND user_id = $7 RETURNING *`,
        [teacher_name, subjects, id_card, classes_taught, salary_amount, teacherId, userId]
      );
    }
    
    res.json({ message: 'Teacher updated successfully' });
  } catch (error) {
    console.error('Error updating teacher:', error);
    res.status(500).json({ error: 'Error updating teacher' });
  }
});

// New endpoint for admin to approve/reject teachers
app.put('/api/teachers/:id/status', authenticateToken, async (req, res) => {
  const { status } = req.body;
  const userId = req.user.id;
  const teacherId = req.params.id;

  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admin can approve/reject teachers' });
    }

    // Validate status
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be "approved" or "rejected"' });
    }

    // Update the teacher status
    const result = await pool.query(
      `UPDATE teachers 
       SET status = $1
       WHERE id = $2 RETURNING *`,
      [status, teacherId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Teacher not found' });
    }
    
    res.json({ message: `Teacher ${status} successfully` });
  } catch (error) {
    console.error('Error updating teacher status:', error);
    res.status(500).json({ error: 'Error updating teacher status' });
  }
});

app.delete('/api/teachers/:id', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  const teacherId = req.params.id;

  try {
    let resultTeacherDel;
    
    if (userRole === 'admin') {
      // Admin can delete any teacher
      resultTeacherDel = await pool.query(
        'SELECT * FROM teachers WHERE id = $1',
        [teacherId]
      );
    } else {
      // Regular users can only delete their own teachers
      resultTeacherDel = await pool.query(
        'SELECT * FROM teachers WHERE id = $1 AND user_id = $2',
        [teacherId, userId]
      );
    }
    
    if (resultTeacherDel.rows.length === 0) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    // Delete the teacher
    if (userRole === 'admin') {
      // Admin can delete any teacher
      await pool.query(
        'DELETE FROM teachers WHERE id = $1',
        [teacherId]
      );
    } else {
      // Regular users can only delete their own teachers
      await pool.query(
        'DELETE FROM teachers WHERE id = $1 AND user_id = $2',
        [teacherId, userId]
      );
    }
    
    res.json({ message: 'Teacher deleted successfully' });
  } catch (error) {
    console.error('Error deleting teacher:', error);
    res.status(500).json({ error: 'Error deleting teacher' });
  }
});

// Teacher analytics endpoint: teachers added per day for the last 30 days
app.get('/api/teachers/analytics/daily', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  const year = req.query.year ? parseInt(req.query.year) : null;
  try {
    let rows;
    if (userRole === 'admin') {
      // Admin can view analytics for all teachers
      if (year) {
        [rows] = await pool.query(
          `SELECT DATE(created_at) as date, COUNT(*) as count
           FROM teachers
           WHERE EXTRACT(YEAR FROM created_at) = $1 AND created_at >= (CURRENT_DATE - INTERVAL '30 days')
           GROUP BY DATE(created_at)
           ORDER BY date ASC`,
          [year]
        );
      } else {
        [rows] = await pool.query(
          `SELECT DATE(created_at) as date, COUNT(*) as count
           FROM teachers
           WHERE created_at >= (CURRENT_DATE - INTERVAL '30 days')
           GROUP BY DATE(created_at)
           ORDER BY date ASC`
        );
      }
    } else {
      // Regular users can only view their own teachers' analytics
      if (year) {
        [rows] = await pool.query(
          `SELECT DATE(created_at) as date, COUNT(*) as count
           FROM teachers
           WHERE user_id = $1 AND EXTRACT(YEAR FROM created_at) = $2 AND created_at >= (CURRENT_DATE - INTERVAL '30 days')
           GROUP BY DATE(created_at)
           ORDER BY date ASC`,
          [userId, year]
        );
      } else {
        [rows] = await pool.query(
          `SELECT DATE(created_at) as date, COUNT(*) as count
           FROM teachers
           WHERE user_id = $1 AND created_at >= (CURRENT_DATE - INTERVAL '30 days')
           GROUP BY DATE(created_at)
           ORDER BY date ASC`,
          [userId]
        );
      }
    }
    res.json(rows);
  } catch (error) {
    console.error('Error fetching teacher analytics:', error);
    res.status(500).json({ error: 'Error fetching teacher analytics', details: error.message });
  }
});

// FEES & ID CARDS ENDPOINTS

// 1. Search students for auto-suggest
app.get('/api/students/search', authenticateToken, async (req, res) => {
  const query = req.query.query || '';
  try {
    // All users can search all students by name or student_id
    const result = await pool.query(
      'SELECT id, full_name, student_id FROM students WHERE LOWER(full_name) LIKE LOWER($1) OR LOWER(student_id) LIKE LOWER($1) ORDER BY full_name ASC LIMIT 10',
      [`%${query}%`]
    );
    console.log(`[SEARCH DEBUG] Query: '${query}', Found: ${result.rows.length}`);
    if (result.rows.length > 0) {
      console.log('[SEARCH DEBUG] Results:', result.rows);
    }
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error searching students' });
  }
});

// Add this before startServer or before catch-all
app.get('/api/fees/total/yearly', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  const year = req.query.year ? parseInt(req.query.year) : null;
  try {
    let result;
    if (userRole === 'admin') {
      // Admin can view total fees for all students
      if (year) {
        result = await pool.query(
          `SELECT SUM(amount) as total
           FROM fees f
           WHERE EXTRACT(YEAR FROM f.paid_at) = $1`,
          [year]
        );
      } else {
        result = await pool.query(
          `SELECT SUM(amount) as total
           FROM fees f
           WHERE EXTRACT(YEAR FROM f.paid_at) = EXTRACT(YEAR FROM CURRENT_DATE)`
        );
      }
    } else {
      // Regular users can only view their own students' fees
      if (year) {
        result = await pool.query(
          `SELECT SUM(amount) as total
           FROM fees f
           JOIN students s ON f.student_id = s.id
           WHERE s.user_id = $1 AND EXTRACT(YEAR FROM f.paid_at) = $2`,
          [userId, year]
        );
      } else {
        result = await pool.query(
          `SELECT SUM(amount) as total
           FROM fees f
           JOIN students s ON f.student_id = s.id
           WHERE s.user_id = $1 AND EXTRACT(YEAR FROM f.paid_at) = EXTRACT(YEAR FROM CURRENT_DATE)` ,
          [userId]
        );
      }
    }
    const total = result.rows[0]?.total || 0;
    res.json({ total });
  } catch (error) {
    console.error('Error fetching yearly total fees:', error);
    res.status(500).json({ error: 'Error fetching yearly total fees', details: error.message });
  }
});

app.get('/api/student/:id/fees', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  const studentId = req.params.id;
  const year = req.query.year ? parseInt(req.query.year) : null;
  console.log(`[FEE STATS DEBUG] Fetching stats for studentId: ${studentId}, userId: ${userId}, role: ${userRole}`);
  try {
    // Get student and class with role-based access
    let resultStudent;
    if (userRole === 'admin' || userRole === 'Admin3' || userRole === 'Admin2' || userRole === 'Admin1' || userRole === 'Admin4') {
      // Admins can view fees for any student
      resultStudent = await pool.query(
        'SELECT s.*, c.name as class_name, c.registration_fee, c.bus_fee, c.internship_fee, c.remedial_fee, c.tuition_fee, c.pta_fee FROM students s JOIN classes c ON s.class_id = c.id WHERE s.id = $1',
        [studentId]
      );
    } else {
      // Regular users can only view their own students' fees
      resultStudent = await pool.query(
        'SELECT s.*, c.name as class_name, c.registration_fee, c.bus_fee, c.internship_fee, c.remedial_fee, c.tuition_fee, c.pta_fee FROM students s JOIN classes c ON s.class_id = c.id WHERE s.id = $1 AND s.user_id = $2',
        [studentId, userId]
      );
    }
    const student = resultStudent.rows[0];
    if (!student) {
      console.warn(`[FEE STATS DEBUG] Student not found for id: ${studentId}`);
      return res.status(404).json({ error: 'Student not found' });
    }
    // Get all fees paid
    let resultFees;
    if (year) {
      resultFees = await pool.query(
        'SELECT fee_type, SUM(amount) as paid FROM fees WHERE student_id = $1 AND EXTRACT(YEAR FROM paid_at) = $2 GROUP BY fee_type',
        [studentId, year]
      );
    } else {
      resultFees = await pool.query(
        'SELECT fee_type, SUM(amount) as paid FROM fees WHERE student_id = $1 GROUP BY fee_type',
        [studentId]
      );
    }
    // Calculate balances
    const feeMap = Object.fromEntries(resultFees.rows.map(f => [f.fee_type, parseFloat(f.paid)]));
    const balance = {
      Registration: Math.max(0, parseFloat(student.registration_fee) - (feeMap['Registration'] || 0)),
      Bus: Math.max(0, parseFloat(student.bus_fee) - (feeMap['Bus'] || 0)),
      Internship: Math.max(0, parseFloat(student.internship_fee) - (feeMap['Internship'] || 0)),
      Remedial: Math.max(0, parseFloat(student.remedial_fee) - (feeMap['Remedial'] || 0)),
      Tuition: Math.max(0, parseFloat(student.tuition_fee) - (feeMap['Tuition'] || 0)),
      PTA: Math.max(0, parseFloat(student.pta_fee) - (feeMap['PTA'] || 0)),
    };
    console.log(`[FEE STATS DEBUG] Returning stats for studentId: ${studentId}`, { student, balance });
    res.json({ student, balance });
  } catch (error) {
    console.error('[FEE STATS DEBUG] Error fetching student fee stats:', error.stack);
    res.status(500).json({ error: 'Error fetching student fees', details: error.message });
  }
});

app.post('/api/fees', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { student_id, class_id, fee_type, amount, paid_at } = req.body;
  try {
    // Optionally: check if student belongs to user
    if (paid_at) {
      await pool.query(
        'INSERT INTO fees (student_id, class_id, fee_type, amount, paid_at) VALUES ($1, $2, $3, $4, $5)',
        [student_id, class_id, fee_type, amount, paid_at]
      );
    } else {
      await pool.query(
        'INSERT INTO fees (student_id, class_id, fee_type, amount) VALUES ($1, $2, $3, $4)',
        [student_id, class_id, fee_type, amount]
      );
    }
    res.json({ message: 'Fee payment recorded' });
  } catch (error) {
    res.status(500).json({ error: 'Error recording fee payment' });
  }
});

app.get('/api/fees/class/:classId', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  const classId = req.params.classId;
  const year = req.query.year ? parseInt(req.query.year) : null;
  
  try {
    // First, check if the class exists
    const classCheck = await pool.query(
      'SELECT id, name, user_id FROM classes WHERE id = $1',
      [classId]
    );
    if (classCheck.rows.length === 0) {
      console.log(`[FEE DEBUG] Class with ID ${classId} not found.`);
      return res.status(404).json({ error: `Class with ID ${classId} not found` });
    }
    const className = classCheck.rows[0].name;
    console.log(`[FEE DEBUG] ClassId: ${classId}, ClassName: ${className}`);
    // Get all students in class with role-based access
    let resultStudents;
    if (userRole === 'admin') {
      resultStudents = await pool.query(
        'SELECT s.id, s.full_name, s.user_id, c.registration_fee, c.bus_fee, c.internship_fee, c.remedial_fee, c.tuition_fee, c.pta_fee FROM students s JOIN classes c ON s.class_id = c.id WHERE s.class_id = $1',
        [classId]
      );
    } else {
      resultStudents = await pool.query(
        'SELECT s.id, s.full_name, s.user_id, c.registration_fee, c.bus_fee, c.internship_fee, c.remedial_fee, c.tuition_fee, c.pta_fee FROM students s JOIN classes c ON s.class_id = c.id WHERE s.class_id = $1 AND s.user_id = $2',
        [classId, userId]
      );
    }
    const students = resultStudents.rows;
    console.log(`[FEE DEBUG] Found ${students.length} students in class ${className} (ID: ${classId})`);
    if (students.length > 0) {
      console.log('[FEE DEBUG] Student IDs:', students.map(s => s.id));
    }
    if (students.length === 0) {
      return res.json([]);
    }
    // Get all fees for these students
    const studentIds = students.map(s => s.id);
    let fees = [];
    if (studentIds.length > 0) {
      const placeholders = studentIds.map((_, i) => `$${i + 1}`).join(',');
      if (year) {
        const params = [...studentIds, year];
        const query = `SELECT student_id, fee_type, SUM(amount) as paid FROM fees WHERE student_id IN (${placeholders}) AND EXTRACT(YEAR FROM paid_at) = $${studentIds.length + 1} GROUP BY student_id, fee_type`;
        const resultFees = await pool.query(query, params);
        fees = resultFees.rows;
      } else {
        const query = `SELECT student_id, fee_type, SUM(amount) as paid FROM fees WHERE student_id IN (${placeholders}) GROUP BY student_id, fee_type`;
        const resultFees = await pool.query(query, studentIds);
        fees = resultFees.rows;
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
      const reg = parseFloat(s.registration_fee) || 0;
      const bus = parseFloat(s.bus_fee) || 0;
      const intern = parseFloat(s.internship_fee) || 0;
      const remedial = parseFloat(s.remedial_fee) || 0;
      const tuition = parseFloat(s.tuition_fee) || 0;
      const pta = parseFloat(s.pta_fee) || 0;
      const total = reg + bus + intern + remedial + tuition + pta;
      const paidReg = paid['Registration'] || 0;
      const paidBus = paid['Bus'] || 0;
      const paidIntern = paid['Internship'] || 0;
      const paidRemedial = paid['Remedial'] || 0;
      const paidTuition = paid['Tuition'] || 0;
      const paidPTA = paid['PTA'] || 0;
      const paidTotal = paidReg + paidBus + paidIntern + paidRemedial + paidTuition + paidPTA;
      return {
        name: s.full_name,
        Registration: paidReg,
        Bus: paidBus,
        Internship: paidIntern,
        Remedial: paidRemedial,
        Tuition: paidTuition,
        PTA: paidPTA,
        Total: paidTotal,
        Balance: Math.max(0, total - paidTotal),
        Status: paidTotal >= total ? 'Paid' : 'Owing'
      };
    });
    console.log('[FEE DEBUG] Fee stats to return:', stats);
    res.json(stats);
  } catch (error) {
    console.error('Error in /api/fees/class/:classId:', error);
    res.status(500).json({ error: 'Error fetching class fee stats', details: error.message });
  }
});

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
        pool.query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1)`, [tableName], (err, result) => {
          if (err) {
            console.error(`Error checking table ${tableName}:`, err);
            rejectTable(err);
          } else {
            if (result.rows[0].exists) {
              console.log(`Table ${tableName} exists`);
              resolveTable(true);
            } else {
              console.log(`Table ${tableName} does not exist`);
              resolveTable(false);
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

async function runMigrations() {
  try {
    console.log('Running migrations...');
    // Check if class_id column exists
    const result = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'students' AND column_name = 'class_id'"
    );
    const columns = result.rows;
    if (columns.length === 0) {
      console.log('Adding class_id column to students table...');
      await pool.query('ALTER TABLE students ADD COLUMN class_id INT');
      // Add foreign key constraint
      await pool.query(
        'ALTER TABLE students ADD CONSTRAINT students_ibfk_2 FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL'
      );
      console.log('class_id column and foreign key added successfully');
    } else {
      console.log('class_id column already exists');
    }
    // Assign first available class to students with NULL class_id
    const classResult = await pool.query('SELECT id FROM classes LIMIT 1');
    const classes = classResult.rows;
    if (classes.length > 0) {
      const classId = classes[0].id;
      const updateResult = await pool.query('UPDATE students SET class_id = $1 WHERE class_id IS NULL', [classId]);
      console.log(`Assigned class_id=${classId} to ${updateResult.rowCount} students with NULL class_id.`);
    }
  } catch (error) {
    console.error('Error running migrations:', error);
    throw error;
  }
}

// Add this before startServer
const initializeDatabase = async () => {
  try {
    console.log('Initializing database tables...');
    // Example: create all required tables if not exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        email VARCHAR(100),
        contact VARCHAR(50),
        is_default BOOLEAN DEFAULT false,
        role VARCHAR(50),
        name VARCHAR(100),
        gender VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS classes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        name VARCHAR(100) NOT NULL,
        registration_fee VARCHAR(50),
        bus_fee VARCHAR(50),
        internship_fee VARCHAR(50),
        remedial_fee VARCHAR(50),
        tuition_fee VARCHAR(50),
        pta_fee VARCHAR(50),
        total_fee VARCHAR(50),
        number_of_installments INTEGER,
        year VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        student_id VARCHAR(32) UNIQUE,
        user_id INTEGER,
        full_name VARCHAR(100) NOT NULL,
        sex VARCHAR(10),
        date_of_birth DATE,
        place_of_birth VARCHAR(100),
        father_name VARCHAR(100),
        mother_name VARCHAR(100),
        class_id INTEGER,
        vocational_training VARCHAR(100),
        guardian_contact VARCHAR(50),
        student_picture BYTEA,
        year VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS vocational (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        name VARCHAR(100),
        description TEXT,
        picture1 VARCHAR(255),
        picture2 VARCHAR(255),
        picture3 VARCHAR(255),
        picture4 VARCHAR(255),
        year VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS teachers (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        teacher_name VARCHAR(100),
        subjects TEXT,
        id_card VARCHAR(100),
        classes_taught TEXT,
        salary_amount VARCHAR(50),
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS id_cards (
        id SERIAL PRIMARY KEY,
        student_id INTEGER,
        card_number VARCHAR(100),
        issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS fees (
        id SERIAL PRIMARY KEY,
        student_id INTEGER,
        class_id INTEGER,
        fee_type VARCHAR(50),
        amount NUMERIC,
        paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('All required tables created or already exist.');
    return true;
  } catch (err) {
    console.error('Error initializing database:', err);
    return false;
  }
};

console.log('--- server.js loaded ---');
const startServer = async () => {
  try {
    console.log('Starting server...');
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

    console.log('Connecting to database...');
    await pool.connect();
    console.log('Connected to database');
    // Verify database structure
    const structureValid = await verifyDatabaseStructure();
    console.log('Database structure checked:', structureValid);
    if (!structureValid) {
      console.log('Database structure invalid, initializing...');
      const initSuccess = await initializeDatabase();
      console.log('Database initialized:', initSuccess);
      if (!initSuccess) {
        throw new Error('Failed to initialize database');
      }
    } else {
      // Run migrations even if structure is valid
      await runMigrations();
      console.log('Migrations complete');
    }
    // Find available port
    const availablePort = await findAvailablePort(PORT);
    console.log('Available port found:', availablePort);
    app.listen(availablePort, () => {
      console.log(`Server running on port ${availablePort}`);
      console.log(`Frontend should be accessible at: http://localhost:${availablePort}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// === Specialties endpoints ===

// Create a new specialty
app.post('/api/specialties', async (req, res) => {
  const { name, abbreviation } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO specialties (name, abbreviation) VALUES ($1, $2) RETURNING *',
      [name, abbreviation || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating specialty:', error);
    res.status(500).json({ error: 'Error creating specialty' });
  }
});

// Get all specialties (with assigned class_ids)
app.get('/api/specialties', async (req, res) => {
  try {
    // Get all specialties
    const result = await pool.query('SELECT * FROM specialties ORDER BY created_at DESC');
    const specialties = result.rows;
    // Get all assignments in one query
    const assignRes = await pool.query('SELECT specialty_id, class_id FROM specialty_classes');
    const assignments = assignRes.rows;
    // Map specialty_id to class_ids
    const classMap = {};
    assignments.forEach(a => {
      if (!classMap[a.specialty_id]) classMap[a.specialty_id] = [];
      classMap[a.specialty_id].push(a.class_id);
    });
    // Attach class_ids to each specialty
    const specialtiesWithClasses = specialties.map(s => ({
      ...s,
      class_ids: classMap[s.id] || []
    }));
    res.json(specialtiesWithClasses);
  } catch (error) {
    console.error('Error fetching specialties:', error);
    res.status(500).json({ error: 'Error fetching specialties' });
  }
});

// Update a specialty
app.put('/api/specialties/:id', async (req, res) => {
  const { id } = req.params;
  const { name, abbreviation } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  try {
    const result = await pool.query(
      'UPDATE specialties SET name = $1, abbreviation = $2 WHERE id = $3 RETURNING *',
      [name, abbreviation || null, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Specialty not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating specialty:', error);
    res.status(500).json({ error: 'Error updating specialty' });
  }
});

// Delete a specialty
app.delete('/api/specialties/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM specialties WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Specialty not found' });
    }
    res.json({ message: 'Specialty deleted successfully' });
  } catch (error) {
    console.error('Error deleting specialty:', error);
    res.status(500).json({ error: 'Error deleting specialty' });
  }
});

// === Specialty-Class assignment endpoints ===

// Assign one or more classes to a specialty
app.post('/api/specialties/:specialty_id/classes', async (req, res) => {
  const { specialty_id } = req.params;
  let { class_ids } = req.body;
  if (!Array.isArray(class_ids)) {
    // Accept single value as array
    class_ids = [class_ids];
  }
  if (!specialty_id || !class_ids || class_ids.length === 0) {
    return res.status(400).json({ error: 'specialty_id and class_ids are required' });
  }
  try {
    // Remove duplicates
    class_ids = [...new Set(class_ids.map(Number))];
    // Insert assignments, ignore duplicates
    const values = class_ids.map(cid => `(${Number(specialty_id)}, ${Number(cid)})`).join(',');
    await pool.query(
      `INSERT INTO specialty_classes (specialty_id, class_id)
       VALUES ${values}
       ON CONFLICT DO NOTHING`
    );
    res.json({ message: 'Classes assigned to specialty successfully' });
  } catch (error) {
    console.error('Error assigning classes to specialty:', error);
    res.status(500).json({ error: 'Error assigning classes to specialty' });
  }
});

// List all classes assigned to a specialty
app.get('/api/specialties/:specialty_id/classes', async (req, res) => {
  const { specialty_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT c.* FROM classes c
       INNER JOIN specialty_classes sc ON c.id = sc.class_id
       WHERE sc.specialty_id = $1
       ORDER BY c.name ASC`,
      [specialty_id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching classes for specialty:', error);
    res.status(500).json({ error: 'Error fetching classes for specialty' });
  }
});

// Remove a class from a specialty
app.delete('/api/specialties/:specialty_id/classes/:class_id', async (req, res) => {
  const { specialty_id, class_id } = req.params;
  try {
    const result = await pool.query(
      'DELETE FROM specialty_classes WHERE specialty_id = $1 AND class_id = $2 RETURNING *',
      [specialty_id, class_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }
    res.json({ message: 'Class removed from specialty successfully' });
  } catch (error) {
    console.error('Error removing class from specialty:', error);
    res.status(500).json({ error: 'Error removing class from specialty' });
  }
});

// Assign classes to a specialty
app.put('/api/specialties/:id/classes', async (req, res) => {
  const specialtyId = req.params.id;
  const { classIds } = req.body; // expects array of class IDs
  if (!Array.isArray(classIds)) {
    return res.status(400).json({ error: 'classIds must be an array' });
  }
  try {
    // Remove existing assignments
    await pool.query('DELETE FROM specialty_classes WHERE specialty_id = $1', [specialtyId]);
    // Insert new assignments
    for (const classId of classIds) {
      await pool.query('INSERT INTO specialty_classes (specialty_id, class_id) VALUES ($1, $2)', [specialtyId, classId]);
    }
    res.json({ message: 'Classes assigned to specialty successfully' });
  } catch (error) {
    console.error('Error assigning classes to specialty:', error);
    res.status(500).json({ error: 'Error assigning classes to specialty', details: error.message });
  }
});

// Get assigned classes for a specialty
app.get('/api/specialties/:id/classes', async (req, res) => {
  const specialtyId = req.params.id;
  try {
    const result = await pool.query('SELECT class_id FROM specialty_classes WHERE specialty_id = $1', [specialtyId]);
    const classIds = result.rows.map(r => r.class_id);
    res.json(classIds);
  } catch (error) {
    console.error('Error fetching assigned classes for specialty:', error);
    res.status(500).json({ error: 'Error fetching assigned classes for specialty', details: error.message });
  }
});

// Serve student image from DB
app.get('/api/students/:id/picture', async (req, res) => {
  const studentId = req.params.id;
  try {
    const result = await pool.query('SELECT student_picture FROM students WHERE id = $1', [studentId]);
    if (result.rows.length === 0 || !result.rows[0].student_picture) {
      console.warn(`[IMAGE] No image found for student ID: ${studentId}`);
      return res.status(404).send('No image');
    }
    res.set('Content-Type', 'image/jpeg');
    res.send(result.rows[0].student_picture);
  } catch (error) {
    console.error(`[IMAGE] Error retrieving image for student ID: ${studentId}:`, error);
    res.status(500).send('Error retrieving image');
  }
});

// Check user by username and phone number
app.post('/api/check-user-details', async (req, res) => {
  const { username, contact } = req.body;
  if (!username || !contact) {
    return res.status(400).json({ error: 'Username and phone number are required' });
  }
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1 AND contact = $2', [username, contact]);
    if (result.rows.length > 0) {
      return res.json({ exists: true });
    } else {
      return res.json({ exists: false });
    }
  } catch (error) {
    console.error('Error checking user details:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// User management endpoints for Admin3
app.get('/api/users/all', authenticateToken, async (req, res) => {
  if (req.user.role !== 'Admin3') return res.status(403).json({ error: 'Forbidden' });
  try {
    const result = await pool.query('SELECT id, name, username, contact, role, suspended FROM users ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.put('/api/users/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'Admin3') return res.status(403).json({ error: 'Forbidden' });
  const { id } = req.params;
  const { name, username, contact, password, role } = req.body;
  try {
    let updateFields = ['name = $1', 'username = $2', 'contact = $3', 'role = $4'];
    let updateValues = [name, username, contact, role];
    let paramIndex = 5;
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      updateFields.push(`password = $${paramIndex}`);
      updateValues.push(hashedPassword);
      paramIndex++;
    }
    updateValues.push(id);
    const updateQuery = `UPDATE users SET ${updateFields.join(', ')} WHERE id = $${paramIndex}`;
    await pool.query(updateQuery, updateValues);
    res.json({ message: 'User updated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

app.delete('/api/users/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'Admin3') return res.status(403).json({ error: 'Forbidden' });
  const { id } = req.params;
  try {
    // Check if user is Admin3
    const userResult = await pool.query('SELECT role FROM users WHERE id = $1', [id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (userResult.rows[0].role === 'Admin3') {
      return res.status(403).json({ error: 'You cannot delete Accounts manager.' });
    }
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

app.post('/api/users/:id/suspend', authenticateToken, async (req, res) => {
  if (req.user.role !== 'Admin3') return res.status(403).json({ error: 'Forbidden' });
  const { id } = req.params;
  try {
    // Toggle suspended status
    const result = await pool.query('UPDATE users SET suspended = NOT COALESCE(suspended, false) WHERE id = $1 RETURNING suspended', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ suspended: result.rows[0].suspended });
  } catch (error) {
    res.status(500).json({ error: 'Failed to suspend user' });
  }
});

// Student registration endpoint
app.post('/api/students', upload.single('photo'), async (req, res) => {
  console.log('BODY:', req.body);
  console.log('FILE:', req.file);
  try {
    const {
      studentId, regDate, fullName, sex, dob, pob,
      father, mother, class: className, dept: specialtyName, contact
    } = req.body;

    // Validate required fields
    if (!studentId || !regDate || !fullName || !sex || !dob || !pob || !className || !specialtyName || !contact) {
      return res.status(400).json({ error: 'All fields except photo are required.' });
    }

    // Find class_id and specialty_id
    const classResult = await pool.query('SELECT id FROM classes WHERE name = $1', [className]);
    const specialtyResult = await pool.query('SELECT id FROM specialties WHERE name = $1', [specialtyName]);
    const class_id = classResult.rows[0] ? classResult.rows[0].id : null;
    const specialty_id = specialtyResult.rows[0] ? specialtyResult.rows[0].id : null;

    // Handle photo upload
    let photo_url = null;
    if (req.file) {
      const fs = require('fs');
      const path = require('path');
      const uploadsDir = path.join(__dirname, 'uploads');
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
      const filename = `student_${Date.now()}_${req.file.originalname}`;
      const filepath = path.join(uploadsDir, filename);
      fs.writeFileSync(filepath, req.file.buffer);
      photo_url = `/uploads/${filename}`;
    }

    // Insert student into DB
    const insertResult = await pool.query(
      `INSERT INTO students (student_id, registration_date, full_name, sex, date_of_birth, place_of_birth, father_name, mother_name, class_id, specialty_id, guardian_contact, photo_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [studentId, regDate, fullName, sex, dob, pob, father, mother, class_id, specialty_id, contact, photo_url]
    );
    const student = insertResult.rows[0];
    res.status(201).json(student);
  } catch (error) {
    console.error('Error registering student:', error);
    res.status(500).json({ error: 'Failed to register student', details: error.message });
  }
});

// GET /api/students - List all students with class/specialty names
app.get('/api/students', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, c.name AS class_name, sp.name AS specialty_name
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN specialties sp ON s.specialty_id = sp.id
      ORDER BY s.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

// Add Multer error handler at the end, before app.listen or module.exports
app.use(function (err, req, res, next) {
  if (err instanceof require('multer').MulterError) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

// Permanently delete a student by id
app.delete('/api/students/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM students WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    res.json({ message: 'Student deleted successfully' });
  } catch (error) {
    console.error('Error deleting student:', error);
    res.status(500).json({ error: 'Failed to delete student' });
  }
});

const uploadMany = multer({ storage: storage });

// Helper to parse Excel serial date or string to yyyy-mm-dd
function parseExcelDate(excelDate) {
  if (!excelDate) return null;
  if (typeof excelDate === 'number') {
    // Excel's epoch starts at 1900-01-01
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(excelEpoch.getTime() + excelDate * 86400000);
    return d.toISOString().slice(0, 10);
  }
  if (typeof excelDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(excelDate)) {
    return excelDate;
  }
  // Try to parse as date string
  const d = new Date(excelDate);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return null;
}

// Bulk student registration from Excel (Upload Many)
app.post('/api/students/upload-many', uploadMany.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No Excel file uploaded' });
    }
    const XLSX = require('xlsx');
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    // Remove header row
    const rows = data.slice(1);
    if (!rows.length) {
      return res.status(400).json({ error: 'Excel file is empty' });
    }
    // Expected columns: Full Name, Sex, Date of Birth, Place of Birth, Father's Name, Mother's Name, Class, Department/Specialty, Contact
    const today = new Date().toISOString().slice(0, 10);
    let created = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row[0]) continue; // skip if no full name
      const [fullName, sex, dob, pob, father, mother, className, dept, contact] = row;
      // Find class_id and specialty_id
      const classResult = await pool.query('SELECT id FROM classes WHERE name = $1', [className]);
      const specialtyResult = await pool.query('SELECT id FROM specialties WHERE name = $1', [dept]);
      const class_id = classResult.rows[0] ? classResult.rows[0].id : null;
      const specialty_id = specialtyResult.rows[0] ? specialtyResult.rows[0].id : null;
      // Generate student ID
      const first = (fullName.split(' ')[0] || '').slice(0, 2).toUpperCase();
      const last = (fullName.split(' ').slice(-1)[0] || '').slice(-2).toUpperCase();
      const year = today.slice(2, 4);
      const seq = (i + 1).toString().padStart(3, '0');
      const studentId = `${year}-VOT-${first}${last}-${seq}`;
      await pool.query(
        `INSERT INTO students (student_id, registration_date, full_name, sex, date_of_birth, place_of_birth, father_name, mother_name, class_id, specialty_id, guardian_contact, photo_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [studentId, today, fullName, sex, parseExcelDate(dob), pob, father, mother, class_id, specialty_id, contact, null]
      );
      created++;
    }
    // Clean up the uploaded file
    const fs = require('fs');
    fs.unlinkSync(req.file.path);
    res.json({ message: `${created} students uploaded successfully` });
  } catch (error) {
    console.error('Error in upload-many:', error);
    res.status(500).json({ error: 'Error uploading students from Excel', details: error.message });
  }
});

// === MESSAGES ENDPOINTS ===
// Send a message
app.post('/api/messages', authenticateToken, async (req, res) => {
  const sender_id = req.user.id;
  const { receiver_id, content } = req.body;
  if (!receiver_id || !content) {
    return res.status(400).json({ error: 'receiver_id and content are required' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1, $2, $3) RETURNING *',
      [sender_id, receiver_id, content]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Get all messages between logged-in user and another user
app.get('/api/messages/:userId', authenticateToken, async (req, res) => {
  const user1 = req.user.id;
  const user2 = parseInt(req.params.userId);
  try {
    const result = await pool.query(
      `SELECT * FROM messages
       WHERE (sender_id = $1 AND receiver_id = $2)
          OR (sender_id = $2 AND receiver_id = $1)
       ORDER BY created_at ASC`,
      [user1, user2]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// All users can retrieve all users for chat
app.get('/api/users/all-chat', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, username, contact, role, suspended FROM users ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Mark all messages from userId to logged-in user as read
app.post('/api/messages/:userId/read', authenticateToken, async (req, res) => {
  const userId = parseInt(req.params.userId);
  const myId = req.user.id;
  try {
    await pool.query(
      'UPDATE messages SET read = TRUE WHERE sender_id = $1 AND receiver_id = $2 AND read = FALSE',
      [userId, myId]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark messages as read' });
  }
});

// Chat list for sidebar: last message, unread count, etc.
app.get('/api/users/chat-list', authenticateToken, async (req, res) => {
  const myId = req.user.id;
  try {
    // Get all users except self
    const usersRes = await pool.query('SELECT id, username, name FROM users WHERE id != $1', [myId]);
    const users = usersRes.rows;
    // For each user, get last message and unread count
    const chatList = await Promise.all(users.map(async (u) => {
      // Last message between me and user
      const lastMsgRes = await pool.query(
        `SELECT * FROM messages WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1) ORDER BY created_at DESC LIMIT 1`,
        [myId, u.id]
      );
      const lastMsg = lastMsgRes.rows[0] || null;
      // Unread count (messages from user to me, not read)
      const unreadRes = await pool.query(
        'SELECT COUNT(*) FROM messages WHERE sender_id = $1 AND receiver_id = $2 AND read = FALSE',
        [u.id, myId]
      );
      const unread = parseInt(unreadRes.rows[0].count, 10);
      return {
        id: u.id,
        username: u.username,
        name: u.name,
        lastMessage: lastMsg ? {
          content: lastMsg.content,
          time: lastMsg.created_at,
          read: lastMsg.read,
          sender_id: lastMsg.sender_id
        } : null,
        unread
      };
    }));
    // Sort by last message time desc
    chatList.sort((a, b) => {
      if (!a.lastMessage && !b.lastMessage) return 0;
      if (!a.lastMessage) return 1;
      if (!b.lastMessage) return -1;
      return new Date(b.lastMessage.time) - new Date(a.lastMessage.time);
    });
    res.json(chatList);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch chat list' });
  }
});

// === Attendance Endpoints ===

// Start a new attendance session for a class
app.post('/api/attendance/start', authenticateToken, async (req, res) => {
  const { class_id } = req.body;
  if (!class_id) return res.status(400).json({ error: 'class_id is required' });
  try {
    const result = await pool.query(
      'INSERT INTO attendance_sessions (class_id, taken_by) VALUES ($1, $2) RETURNING *',
      [class_id, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to start attendance session', details: error.message });
  }
});

// Get all classes (for attendance selection)
app.get('/api/attendance/classes', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name FROM classes ORDER BY name ASC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch classes', details: error.message });
  }
});

// Get all students for a class
app.get('/api/attendance/:classId/students', authenticateToken, async (req, res) => {
  const { classId } = req.params;
  try {
    const result = await pool.query(
      'SELECT id, full_name, student_id FROM students WHERE class_id = $1 ORDER BY full_name ASC',
      [classId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch students', details: error.message });
  }
});

// Mark attendance for a student in a session
app.post('/api/attendance/:sessionId/mark', authenticateToken, async (req, res) => {
  const { sessionId } = req.params;
  const { student_id, status } = req.body;
  if (!student_id || !['present', 'absent'].includes(status)) {
    return res.status(400).json({ error: 'student_id and valid status are required' });
  }
  try {
    // Only one record per student per session
    const existing = await pool.query(
      'SELECT * FROM attendance_records WHERE session_id = $1 AND student_id = $2',
      [sessionId, student_id]
    );
    if (existing.rows.length > 0) {
      // Update status if already exists
      await pool.query(
        'UPDATE attendance_records SET status = $1, marked_at = CURRENT_TIMESTAMP WHERE session_id = $2 AND student_id = $3',
        [status, sessionId, student_id]
      );
    } else {
      await pool.query(
        'INSERT INTO attendance_records (session_id, student_id, status) VALUES ($1, $2, $3)',
        [sessionId, student_id, status]
      );
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark attendance', details: error.message });
  }
});

// Get today's attendance summary (total present/absent)
app.get('/api/attendance/today-summary', authenticateToken, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0,0,0,0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const result = await pool.query(
      `SELECT status, COUNT(*) as count
       FROM attendance_records ar
       JOIN attendance_sessions s ON ar.session_id = s.id
       WHERE s.session_time >= $1 AND s.session_time < $2
       GROUP BY status`,
      [today, tomorrow]
    );
    let present = 0, absent = 0;
    result.rows.forEach(r => {
      if (r.status === 'present') present = parseInt(r.count, 10);
      if (r.status === 'absent') absent = parseInt(r.count, 10);
    });
    res.json({ present, absent });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch today summary', details: error.message });
  }
});

// Get attendance sessions and records for a class by date or week
app.get('/api/attendance/sessions', authenticateToken, async (req, res) => {
  const { classId, date, week } = req.query;
  if (!classId) return res.status(400).json({ error: 'classId is required' });
  try {
    let sessions = [];
    if (date) {
      // Fetch all sessions for the class on the given date
      const start = new Date(date);
      start.setHours(0,0,0,0);
      const end = new Date(start);
      end.setDate(start.getDate() + 1);
      const result = await pool.query(
        'SELECT * FROM attendance_sessions WHERE class_id = $1 AND session_time >= $2 AND session_time < $3 ORDER BY session_time ASC',
        [classId, start, end]
      );
      sessions = result.rows;
    } else if (week) {
      // week format: YYYY-WW (ISO week)
      const [year, weekNum] = week.split('-W');
      const firstDay = new Date(year, 0, 1 + (weekNum - 1) * 7);
      // Adjust to Monday
      const dayOfWeek = firstDay.getDay();
      const monday = new Date(firstDay);
      monday.setDate(firstDay.getDate() - ((dayOfWeek + 6) % 7));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 7);
      const result = await pool.query(
        'SELECT * FROM attendance_sessions WHERE class_id = $1 AND session_time >= $2 AND session_time < $3 ORDER BY session_time ASC',
        [classId, monday, sunday]
      );
      sessions = result.rows;
    } else {
      return res.status(400).json({ error: 'date or week is required' });
    }
    // For each session, fetch records
    for (let session of sessions) {
      const recRes = await pool.query(
        'SELECT student_id, status FROM attendance_records WHERE session_id = $1',
        [session.id]
      );
      session.records = recRes.rows;
    }
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch attendance sessions', details: error.message });
  }
});