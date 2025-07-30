const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
require('dotenv').config();

const router = express.Router();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

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
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
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

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '..', 'uploads', 'lesson-plans');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'lesson-plan-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: function (req, file, cb) {
    // Accept PDF, DOC, DOCX files
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, DOC, and DOCX files are allowed!'), false);
    }
  }
});

// Create lesson plans table if it doesn't exist
const initializeLessonPlansTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lesson_plans (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        subject VARCHAR(100),
        class_name VARCHAR(100),
        week VARCHAR(50),
        objectives TEXT,
        content TEXT,
        activities TEXT,
        assessment TEXT,
        resources TEXT,
        file_url VARCHAR(255),
        file_name VARCHAR(255),
        status VARCHAR(20) DEFAULT 'pending',
        admin_comment TEXT,
        period_type VARCHAR(50) DEFAULT 'weekly',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Lesson plans table initialized');
  } catch (error) {
    console.error('Error initializing lesson plans table:', error);
  }
};

// Initialize table on module load
initializeLessonPlansTable();

// Run migrations to add missing columns
const runLessonPlansMigrations = async () => {
  try {
    console.log('Running lesson plans migrations...');
    
    // Check if lesson_plans table has all required columns
    const lessonPlansColumns = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'lesson_plans' AND column_name IN ('subject', 'class_name', 'week', 'objectives', 'content', 'activities', 'assessment', 'resources', 'file_url', 'file_name', 'status', 'admin_comment', 'updated_at', 'created_at', 'period_type')"
    );
    const existingLessonPlansColumns = lessonPlansColumns.rows.map(row => row.column_name);
    
    if (!existingLessonPlansColumns.includes('subject')) {
      console.log('Adding subject column to lesson_plans table...');
      await pool.query('ALTER TABLE lesson_plans ADD COLUMN subject VARCHAR(100)');
    }
    if (!existingLessonPlansColumns.includes('class_name')) {
      console.log('Adding class_name column to lesson_plans table...');
      await pool.query('ALTER TABLE lesson_plans ADD COLUMN class_name VARCHAR(100)');
    }
    if (!existingLessonPlansColumns.includes('week')) {
      console.log('Adding week column to lesson_plans table...');
      await pool.query('ALTER TABLE lesson_plans ADD COLUMN week VARCHAR(50)');
    }
    if (!existingLessonPlansColumns.includes('objectives')) {
      console.log('Adding objectives column to lesson_plans table...');
      await pool.query('ALTER TABLE lesson_plans ADD COLUMN objectives TEXT');
    }
    if (!existingLessonPlansColumns.includes('content')) {
      console.log('Adding content column to lesson_plans table...');
      await pool.query('ALTER TABLE lesson_plans ADD COLUMN content TEXT');
    }
    if (!existingLessonPlansColumns.includes('activities')) {
      console.log('Adding activities column to lesson_plans table...');
      await pool.query('ALTER TABLE lesson_plans ADD COLUMN activities TEXT');
    }
    if (!existingLessonPlansColumns.includes('assessment')) {
      console.log('Adding assessment column to lesson_plans table...');
      await pool.query('ALTER TABLE lesson_plans ADD COLUMN assessment TEXT');
    }
    if (!existingLessonPlansColumns.includes('resources')) {
      console.log('Adding resources column to lesson_plans table...');
      await pool.query('ALTER TABLE lesson_plans ADD COLUMN resources TEXT');
    }
    if (!existingLessonPlansColumns.includes('file_url')) {
      console.log('Adding file_url column to lesson_plans table...');
      await pool.query('ALTER TABLE lesson_plans ADD COLUMN file_url VARCHAR(255)');
    }
    if (!existingLessonPlansColumns.includes('file_name')) {
      console.log('Adding file_name column to lesson_plans table...');
      await pool.query('ALTER TABLE lesson_plans ADD COLUMN file_name VARCHAR(255)');
    }
    if (!existingLessonPlansColumns.includes('status')) {
      console.log('Adding status column to lesson_plans table...');
      await pool.query('ALTER TABLE lesson_plans ADD COLUMN status VARCHAR(20) DEFAULT \'pending\'');
    }
    if (!existingLessonPlansColumns.includes('admin_comment')) {
      console.log('Adding admin_comment column to lesson_plans table...');
      await pool.query('ALTER TABLE lesson_plans ADD COLUMN admin_comment TEXT');
    }
    if (!existingLessonPlansColumns.includes('period_type')) {
      console.log('Adding period_type column to lesson_plans table...');
      await pool.query('ALTER TABLE lesson_plans ADD COLUMN period_type VARCHAR(50) DEFAULT \'weekly\'');
    }
    if (!existingLessonPlansColumns.includes('updated_at')) {
      console.log('Adding updated_at column to lesson_plans table...');
      await pool.query('ALTER TABLE lesson_plans ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    }
    if (!existingLessonPlansColumns.includes('created_at')) {
      console.log('Adding created_at column to lesson_plans table...');
      await pool.query('ALTER TABLE lesson_plans ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    }
    
    console.log('Lesson plans migrations completed');
  } catch (error) {
    console.error('Error running lesson plans migrations:', error);
  }
};

// Run migrations on module load
runLessonPlansMigrations();

// Upload a new lesson plan
router.post('/', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const {
      title,
      subject,
      class_name,
      week,
      objectives,
      content,
      activities,
      assessment,
      resources,
      period_type
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    let fileUrl = null;
    let fileName = null;
    if (req.file) {
      fileUrl = `/uploads/lesson-plans/${req.file.filename}`;
      fileName = req.file.originalname;
    }

    const result = await pool.query(
      `INSERT INTO lesson_plans (
        user_id, title, subject, class_name, week, objectives, content, 
        activities, assessment, resources, file_url, file_name, period_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [
        req.user.id, title, subject, class_name, week, objectives, content,
        activities, assessment, resources, fileUrl, fileName, period_type || 'weekly'
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error uploading lesson plan:', error);
    res.status(500).json({ error: 'Failed to upload lesson plan' });
  }
});

// Get my lesson plans (for teachers)
router.get('/my', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM lesson_plans WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching my lesson plans:', error);
    res.status(500).json({ error: 'Failed to fetch lesson plans' });
  }
});

// Get all lesson plans (for admins)
router.get('/all', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (!['Admin1', 'Admin2', 'Admin3', 'Admin4', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query(
      `SELECT lp.*, u.name as teacher_name, u.username 
       FROM lesson_plans lp 
       JOIN users u ON lp.user_id = u.id 
       ORDER BY lp.created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching all lesson plans:', error);
    res.status(500).json({ error: 'Failed to fetch all lesson plans' });
  }
});

// Update a lesson plan
router.put('/:id', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const lessonPlanId = parseInt(req.params.id);
    const {
      title,
      subject,
      class_name,
      week,
      objectives,
      content,
      activities,
      assessment,
      resources,
      period_type
    } = req.body;

    // Check if lesson plan belongs to user
    const existingPlan = await pool.query(
      'SELECT * FROM lesson_plans WHERE id = $1 AND user_id = $2',
      [lessonPlanId, req.user.id]
    );

    if (existingPlan.rows.length === 0) {
      return res.status(404).json({ error: 'Lesson plan not found' });
    }

    let fileUrl = existingPlan.rows[0].file_url;
    let fileName = existingPlan.rows[0].file_name;

    if (req.file) {
      // Delete old file if exists
      if (fileUrl) {
        const oldFilePath = path.join(__dirname, '..', fileUrl);
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
        }
      }
      fileUrl = `/uploads/lesson-plans/${req.file.filename}`;
      fileName = req.file.originalname;
    }

    const result = await pool.query(
      `UPDATE lesson_plans SET 
        title = $1, subject = $2, class_name = $3, week = $4, 
        objectives = $5, content = $6, activities = $7, 
        assessment = $8, resources = $9, file_url = $10, 
        file_name = $11, period_type = $12, updated_at = CURRENT_TIMESTAMP
       WHERE id = $13 AND user_id = $14 RETURNING *`,
      [
        title, subject, class_name, week, objectives, content,
        activities, assessment, resources, fileUrl, fileName, period_type || 'weekly',
        lessonPlanId, req.user.id
      ]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating lesson plan:', error);
    res.status(500).json({ error: 'Failed to update lesson plan' });
  }
});

// Delete a lesson plan (teacher can delete their own)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const lessonPlanId = parseInt(req.params.id);

    // Check if lesson plan belongs to user
    const existingPlan = await pool.query(
      'SELECT * FROM lesson_plans WHERE id = $1 AND user_id = $2',
      [lessonPlanId, req.user.id]
    );

    if (existingPlan.rows.length === 0) {
      return res.status(404).json({ error: 'Lesson plan not found' });
    }

    // Delete file if exists
    if (existingPlan.rows[0].file_url) {
      const filePath = path.join(__dirname, '..', existingPlan.rows[0].file_url);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await pool.query(
      'DELETE FROM lesson_plans WHERE id = $1 AND user_id = $2',
      [lessonPlanId, req.user.id]
    );

    res.json({ message: 'Lesson plan deleted successfully' });
  } catch (error) {
    console.error('Error deleting lesson plan:', error);
    res.status(500).json({ error: 'Failed to delete lesson plan' });
  }
});

// Review lesson plan (admin only)
router.put('/:id/review', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (!['Admin1', 'Admin2', 'Admin3', 'Admin4', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const lessonPlanId = parseInt(req.params.id);
    const { status, admin_comment } = req.body;

    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const result = await pool.query(
      `UPDATE lesson_plans SET 
        status = $1, admin_comment = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 RETURNING *`,
      [status, admin_comment, lessonPlanId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lesson plan not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error reviewing lesson plan:', error);
    res.status(500).json({ error: 'Failed to review lesson plan' });
  }
});

// Delete lesson plan (admin only)
router.delete('/:id/admin', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (!['Admin1', 'Admin2', 'Admin3', 'Admin4', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const lessonPlanId = parseInt(req.params.id);

    // Get lesson plan details
    const existingPlan = await pool.query(
      'SELECT * FROM lesson_plans WHERE id = $1',
      [lessonPlanId]
    );

    if (existingPlan.rows.length === 0) {
      return res.status(404).json({ error: 'Lesson plan not found' });
    }

    // Delete file if exists
    if (existingPlan.rows[0].file_url) {
      const filePath = path.join(__dirname, '..', existingPlan.rows[0].file_url);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await pool.query('DELETE FROM lesson_plans WHERE id = $1', [lessonPlanId]);

    res.json({ message: 'Lesson plan deleted successfully' });
  } catch (error) {
    console.error('Error deleting lesson plan:', error);
    res.status(500).json({ error: 'Failed to delete lesson plan' });
  }
});

module.exports = router; 