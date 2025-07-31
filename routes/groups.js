const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const ftpService = require('../ftp-service');
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
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Create a new group
router.post('/', authenticateToken, async (req, res) => {
  const creator_id = req.user.id;
  const { name, participant_ids } = req.body;
  
  if (!name || !participant_ids || participant_ids.length === 0) {
    return res.status(400).json({ error: 'Group name and at least one participant are required' });
  }

  try {
    // Start a transaction
    await pool.query('BEGIN');
    
    // Create the group
    const groupResult = await pool.query(
      'INSERT INTO groups (name, creator_id) VALUES ($1, $2) RETURNING *',
      [name, creator_id]
    );
    const group = groupResult.rows[0];
    
    // Add creator to participants
    const allParticipantIds = [...new Set([creator_id, ...participant_ids])];
    
    // Add all participants to the group
    for (const user_id of allParticipantIds) {
      await pool.query(
        'INSERT INTO group_participants (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [group.id, user_id]
      );
    }
    
    // Send a system message to the group
    const systemMessage = `${req.user.username} added you to ${name}`;
    await pool.query(
      'INSERT INTO messages (sender_id, group_id, content) VALUES ($1, $2, $3)',
      [creator_id, group.id, systemMessage]
    );
    
    await pool.query('COMMIT');
    
    res.status(201).json({
      group,
      message: 'Group created successfully'
    });
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Error creating group:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// Get all groups for the current user
router.get('/', authenticateToken, async (req, res) => {
  const user_id = req.user.id;
  try {
    const result = await pool.query(
      `SELECT g.*, u.username as creator_name 
       FROM groups g 
       JOIN users u ON g.creator_id = u.id 
       WHERE g.id IN (
         SELECT group_id FROM group_participants WHERE user_id = $1
       )
       ORDER BY g.created_at DESC`,
      [user_id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching groups:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// Get group messages
router.get('/:groupId/messages', authenticateToken, async (req, res) => {
  const group_id = parseInt(req.params.groupId);
  const user_id = req.user.id;
  
  try {
    // Check if user is a participant
    const participantCheck = await pool.query(
      'SELECT * FROM group_participants WHERE group_id = $1 AND user_id = $2',
      [group_id, user_id]
    );
    
    if (participantCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }
    
    const result = await pool.query(
      `SELECT m.*, u.username, u.name 
       FROM messages m 
       JOIN users u ON m.sender_id = u.id 
       WHERE m.group_id = $1 
       ORDER BY m.created_at ASC`,
      [group_id]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching group messages:', error);
    res.status(500).json({ error: 'Failed to fetch group messages' });
  }
});

// Send a message to a group
router.post('/:groupId/messages', authenticateToken, async (req, res) => {
  const group_id = parseInt(req.params.groupId);
  const sender_id = req.user.id;
  const { content } = req.body;
  
  if (!content || content.trim() === '') {
    return res.status(400).json({ error: 'Message content is required' });
  }
  
  try {
    // Check if user is a participant
    const participantCheck = await pool.query(
      'SELECT * FROM group_participants WHERE group_id = $1 AND user_id = $2',
      [group_id, sender_id]
    );
    
    if (participantCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }
    
    const result = await pool.query(
      'INSERT INTO messages (sender_id, group_id, content) VALUES ($1, $2, $3) RETURNING *',
      [sender_id, group_id, content.trim()]
    );
    
    // Get the message with sender info
    const messageWithSender = await pool.query(
      `SELECT m.*, u.username, u.name 
       FROM messages m 
       JOIN users u ON m.sender_id = u.id 
       WHERE m.id = $1`,
      [result.rows[0].id]
    );
    
    res.status(201).json(messageWithSender.rows[0]);
  } catch (error) {
    console.error('Error sending group message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Send a message with file to a group
router.post('/:groupId/messages/with-file', authenticateToken, upload.single('file'), async (req, res) => {
  const group_id = parseInt(req.params.groupId);
  const sender_id = req.user.id;
  const { content } = req.body;
  
  if (!req.file) {
    return res.status(400).json({ error: 'File is required' });
  }
  
  try {
    // Check if user is a participant
    const participantCheck = await pool.query(
      'SELECT * FROM group_participants WHERE group_id = $1 AND user_id = $2',
      [group_id, sender_id]
    );
    
    if (participantCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }
    
    // Upload file to FTP
    const fileName = `group_${group_id}_${Date.now()}_${req.file.originalname}`;
    const fileUrl = await ftpService.uploadBuffer(req.file.buffer, fileName);
    
    // Save message with file info
    const result = await pool.query(
      `INSERT INTO messages (sender_id, group_id, content, file_url, file_name, file_type) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [sender_id, group_id, content || '', fileUrl, req.file.originalname, req.file.mimetype]
    );
    
    // Get the message with sender info
    const messageWithSender = await pool.query(
      `SELECT m.*, u.username, u.name 
       FROM messages m 
       JOIN users u ON m.sender_id = u.id 
       WHERE m.id = $1`,
      [result.rows[0].id]
    );
    
    res.status(201).json(messageWithSender.rows[0]);
  } catch (error) {
    console.error('Error sending group message with file:', error);
    res.status(500).json({ error: 'Failed to send message with file' });
  }
});

// Get group participants
router.get('/:groupId/participants', authenticateToken, async (req, res) => {
  const group_id = parseInt(req.params.groupId);
  const user_id = req.user.id;
  
  try {
    // Check if user is a participant
    const participantCheck = await pool.query(
      'SELECT * FROM group_participants WHERE group_id = $1 AND user_id = $2',
      [group_id, user_id]
    );
    
    if (participantCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }
    
    const result = await pool.query(
      `SELECT u.id, u.username, u.name, u.email, gp.joined_at
       FROM group_participants gp
       JOIN users u ON gp.user_id = u.id
       WHERE gp.group_id = $1
       ORDER BY gp.joined_at ASC`,
      [group_id]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching group participants:', error);
    res.status(500).json({ error: 'Failed to fetch group participants' });
  }
});

// Mark group messages as read
router.post('/:groupId/read', authenticateToken, async (req, res) => {
  const group_id = parseInt(req.params.groupId);
  const user_id = req.user.id;
  
  try {
    // Check if user is a participant
    const participantCheck = await pool.query(
      'SELECT * FROM group_participants WHERE group_id = $1 AND user_id = $2',
      [group_id, user_id]
    );
    
    if (participantCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }
    
    // Mark all unread messages in this group as read
    await pool.query(
      `UPDATE messages 
       SET read = true 
       WHERE group_id = $1 AND sender_id != $2 AND read = false`,
      [group_id, user_id]
    );
    
    res.json({ message: 'Messages marked as read' });
  } catch (error) {
    console.error('Error marking messages as read:', error);
    res.status(500).json({ error: 'Failed to mark messages as read' });
  }
});

module.exports = router; 