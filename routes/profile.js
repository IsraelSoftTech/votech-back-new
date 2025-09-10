const express = require('express');
const multer = require('multer');
const path = require('path');
const { pool, authenticateToken } = require('./utils');
const ftpService = require('../ftp-service');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Update current user's profile (username and optional profile image)
router.put('/', authenticateToken, upload.single('profile'), async (req, res) => {
  try {
    const userId = req.user.id;
    const { username } = req.body || {};

    // Ensure column exists for persistence
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_url VARCHAR(255)");

    let profileUrl = null;
    if (req.file) {
      const ext = path.extname(req.file.originalname || '.jpg') || '.jpg';
      const remotePath = `users/profile/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      profileUrl = await ftpService.uploadBuffer(req.file.buffer, remotePath);
    }

    // Build update query dynamically
    const updates = [];
    const values = [];
    let idx = 1;
    if (username && username.trim()) { updates.push(`username = $${idx++}`); values.push(username.trim()); }
    if (profileUrl) { updates.push(`profile_image_url = $${idx++}`); values.push(profileUrl); }

    if (updates.length) {
      values.push(userId);
      await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`, values);
    }

    const result = await pool.query('SELECT id, name, username, role, contact, email, profile_image_url FROM users WHERE id = $1', [userId]);
    const user = result.rows[0];

    res.json({
      message: 'Profile updated successfully',
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        role: user.role,
        contact: user.contact,
        email: user.email,
        profileImageUrl: user.profile_image_url || null,
        profile_image_url: user.profile_image_url || null,
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

module.exports = router;


