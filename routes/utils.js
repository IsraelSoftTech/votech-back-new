const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Optimize connection pool to prevent resource exhaustion
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
  maxUses: 7500, // Close (and replace) a connection after it has been used 7500 times
  allowExitOnIdle: true // Allow the pool to exit if all connections are idle
});

// Handle pool errors to prevent crashes
pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
});

// Graceful shutdown
process.on('SIGINT', () => {
  pool.end();
  process.exit(0);
});

process.on('SIGTERM', () => {
  pool.end();
  process.exit(0);
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: 'No authorization header' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }



  try {
    const user = jwt.verify(token, JWT_SECRET);
    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// Admin authorization middleware
const requireAdmin = (req, res, next) => {
  if (!['Admin1', 'Admin2', 'Admin3', 'Admin4', 'admin', 'Dean'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
  }
  next();
};

// Activity logging function
const logUserActivity = async (userId, activityType, activityDescription, entityType = null, entityId = null, entityName = null, ipAddress = null, userAgent = null) => {
  try {
    await pool.query(`
      INSERT INTO user_activities (user_id, activity_type, activity_description, entity_type, entity_id, entity_name, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [userId, activityType, activityDescription, entityType, entityId, entityName, ipAddress, userAgent]);
  } catch (error) {
    console.error('Error logging user activity:', error);
  }
};

// Helper function to create user session
const createUserSession = async (userId, ipAddress = null, userAgent = null) => {
  try {
    const result = await pool.query(`
      INSERT INTO user_sessions (user_id, ip_address, user_agent)
      VALUES ($1, $2, $3)
      RETURNING id
    `, [userId, ipAddress, userAgent]);
    return result.rows[0].id;
  } catch (error) {
    console.error('Error creating user session:', error);
    return null;
  }
};

// Helper function to end user session
const endUserSession = async (userId) => {
  try {
    await pool.query(`
      UPDATE user_sessions 
      SET session_end = CURRENT_TIMESTAMP, status = 'ended'
      WHERE user_id = $1 AND session_end IS NULL
    `, [userId]);
  } catch (error) {
    console.error('Error ending user session:', error);
  }
};

// Helper function to get IP address
const getIpAddress = (req) => {
  return req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
};

// Helper function to get user agent
const getUserAgent = (req) => {
  return req.headers['user-agent'] || 'unknown';
};

// Helper function to check if user is admin-like
const isAdminLike = (userRole) => {
  return userRole === 'admin' || ['Admin1', 'Admin2', 'Admin3', 'Admin4'].includes(userRole);
};

module.exports = {
  pool,
  authenticateToken,
  requireAdmin,
  logUserActivity,
  createUserSession,
  endUserSession,
  getIpAddress,
  getUserAgent,
  isAdminLike,
  JWT_SECRET
};

