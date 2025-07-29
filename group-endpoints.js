// === GROUP CHAT ENDPOINTS ===

// Create a new group
app.post('/api/groups', authenticateToken, async (req, res) => {
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
app.get('/api/groups', authenticateToken, async (req, res) => {
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
app.get('/api/groups/:groupId/messages', authenticateToken, async (req, res) => {
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
app.post('/api/groups/:groupId/messages', authenticateToken, async (req, res) => {
  const group_id = parseInt(req.params.groupId);
  const sender_id = req.user.id;
  const { content } = req.body;
  
  if (!content) {
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
      [sender_id, group_id, content]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error sending group message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Send a file message to a group
app.post('/api/groups/:groupId/messages/with-file', authenticateToken, upload.single('file'), async (req, res) => {
  const group_id = parseInt(req.params.groupId);
  const sender_id = req.user.id;
  const { content } = req.body;
  const file = req.file;
  
  if (!content && !file) {
    return res.status(400).json({ error: 'Message content or file is required' });
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
    
    let fileUrl = null;
    let fileName = null;
    let fileType = null;

    if (file) {
      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'application/pdf'];
      if (!allowedTypes.includes(file.mimetype)) {
        return res.status(400).json({ error: 'Only images (JPEG, PNG, GIF) and PDF files are allowed' });
      }

      // Validate file size (5MB limit)
      if (file.size > 5 * 1024 * 1024) {
        return res.status(400).json({ error: 'File size must be less than 5MB' });
      }

      // Generate unique filename
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const fileExtension = path.extname(file.originalname);
      fileName = `group_message_${uniqueSuffix}${fileExtension}`;
      
      // Save file to uploads directory
      const fs = require('fs');
      const uploadPath = path.join(__dirname, 'uploads', fileName);
      fs.writeFileSync(uploadPath, file.buffer);
      
      fileUrl = `/uploads/${fileName}`;
      fileType = file.mimetype;
    }
    
    const result = await pool.query(
      'INSERT INTO messages (sender_id, group_id, content, file_url, file_name, file_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [sender_id, group_id, content || '', fileUrl, fileName, fileType]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error sending group message with file:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Get group participants
app.get('/api/groups/:groupId/participants', authenticateToken, async (req, res) => {
  const group_id = parseInt(req.params.groupId);
  
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.name, gp.joined_at 
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