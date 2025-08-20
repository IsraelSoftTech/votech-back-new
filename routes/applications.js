const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
require('dotenv').config();

// Create pool directly in this file
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Authentication middleware function
function authenticateToken(req, res, next) {
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
    const jwt = require('jsonwebtoken');
    // Use the same JWT_SECRET as the main server
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
    console.log('JWT_SECRET:', JWT_SECRET);
    const user = jwt.verify(token, JWT_SECRET);
    console.log('Token verified for user:', user.username, 'ID:', user.id);
    req.user = user;
    next();
  } catch (err) {
    console.error('Token verification failed:', err.message);
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(403).json({ error: 'Invalid token' });
  }
}

// Get all applications
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        a.*,
        u.name as user_name,
        u.email as user_email,
        u.contact as user_contact
      FROM applications a
      LEFT JOIN users u ON a.applicant_id = u.id
      ORDER BY a.submitted_at DESC
    `);
    
    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching applications:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch applications',
      details: error.message 
    });
  }
});

// Get application by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT 
        a.*,
        u.name as user_name,
        u.email as user_email,
        u.contact as user_contact
      FROM applications a
      LEFT JOIN users u ON a.applicant_id = u.id
      WHERE a.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Application not found' 
      });
    }
    
    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching application:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch application',
      details: error.message 
    });
  }
});

// Get applications by user ID
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        a.*,
        u.name as user_name,
        u.email as user_email,
        u.contact as user_contact
      FROM applications a
      LEFT JOIN users u ON a.applicant_id = u.id
      WHERE a.applicant_id = $1
      ORDER BY a.submitted_at DESC
    `, [userId]);
    
    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching user applications:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch user applications',
      details: error.message 
    });
  }
});

// Create new application
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      applicant_id,
      applicant_name,
      contact,
      classes,
      subjects,
      experience_years,
      education_level,
      current_salary,
      expected_salary,
      availability,
      additional_info,
      certificate_url,
      certificate_name,
      status = 'pending'
    } = req.body;
    
    const result = await pool.query(`
      INSERT INTO applications (
        applicant_id, applicant_name, contact, classes, subjects,
        experience_years, education_level, current_salary, expected_salary,
        availability, additional_info, certificate_url, certificate_name,
        status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
      RETURNING *
    `, [
      applicant_id, applicant_name, contact, classes, subjects,
      experience_years, education_level, current_salary, expected_salary,
      availability, additional_info, certificate_url, certificate_name, status
    ]);
    
    res.status(201).json({
      success: true,
      data: result.rows[0],
      message: 'Application created successfully'
    });
  } catch (error) {
    console.error('Error creating application:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create application',
      details: error.message 
    });
  }
});

// Update application status
router.patch('/:id/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!status) {
      return res.status(400).json({ 
        success: false, 
        error: 'Status is required' 
      });
    }
    
    const result = await pool.query(`
      UPDATE applications 
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [status, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Application not found' 
      });
    }
    
    res.json({
      success: true,
      data: result.rows[0],
      message: 'Application status updated successfully'
    });
  } catch (error) {
    console.error('Error updating application status:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update application status',
      details: error.message 
    });
  }
});

// Update application
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      applicant_name,
      contact,
      classes,
      subjects,
      experience_years,
      education_level,
      current_salary,
      expected_salary,
      availability,
      additional_info,
      certificate_url,
      certificate_name,
      status
    } = req.body;
    
    const result = await pool.query(`
      UPDATE applications 
      SET 
        applicant_name = COALESCE($1, applicant_name),
        contact = COALESCE($2, contact),
        classes = COALESCE($3, classes),
        subjects = COALESCE($4, subjects),
        experience_years = COALESCE($5, experience_years),
        education_level = COALESCE($6, education_level),
        current_salary = COALESCE($7, current_salary),
        expected_salary = COALESCE($8, expected_salary),
        availability = COALESCE($9, availability),
        additional_info = COALESCE($10, additional_info),
        certificate_url = COALESCE($11, certificate_url),
        certificate_name = COALESCE($12, certificate_name),
        status = COALESCE($13, status),
        updated_at = NOW()
      WHERE id = $14
      RETURNING *
    `, [
      applicant_name, contact, classes, subjects, experience_years,
      education_level, current_salary, expected_salary, availability,
      additional_info, certificate_url, certificate_name, status, id
    ]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Application not found' 
      });
    }
    
    res.json({
      success: true,
      data: result.rows[0],
      message: 'Application updated successfully'
    });
  } catch (error) {
    console.error('Error updating application:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update application',
      details: error.message 
    });
  }
});

// Delete application
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      DELETE FROM applications 
      WHERE id = $1
      RETURNING *
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Application not found' 
      });
    }
    
    res.json({
      success: true,
      message: 'Application deleted successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error deleting application:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to delete application',
      details: error.message 
    });
  }
});

module.exports = router; 