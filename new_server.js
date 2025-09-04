const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
require('dotenv').config();


const createAttendanceRouter = require('./routes/attendance');
const createStaffAttendanceRouter = require('./routes/staff-attendance');
const createDisciplineCasesRouter = require('./routes/discipline_cases');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const PORT = process.env.NEW_PORT || 5001;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'https://votechs7academygroup.com',
      'https://votech-latest-front.onrender.com',
      'http://localhost:3000',
      'http://localhost:3004'
    ];
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) callback(null, true);
    else callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));


const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: 'No authorization header' });
  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  // Special handling for Admin3 hardcoded token
  if (token === 'admin3-special-token-2024') {
    // Create a mock user object for Admin3
    req.user = {
      id: 999,
      username: 'Admin3',
      role: 'Admin3',
      name: 'System Administrator'
    };
    return next();
  }

  try {
    const user = jwt.verify(token, JWT_SECRET);
    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expired' });
    return res.status(403).json({ error: 'Invalid token' });
  }
};


app.use('/api/attendance', createAttendanceRouter(pool, authenticateToken));
app.use('/api/staff-attendance', createStaffAttendanceRouter(pool, authenticateToken));
app.use('/api/discipline-cases', createDisciplineCasesRouter(pool, authenticateToken));

// Health
app.get('/api/test-new', (req, res) => res.json({ message: 'New server running' }));

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

app.listen(PORT, () => {
  console.log(`New server running on port ${PORT}`);
}); 