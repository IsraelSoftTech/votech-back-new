const express = require('express');

module.exports = function createDisciplineCasesRouter(pool, authenticateToken) {
  const router = express.Router();

  // Get all discipline cases (all users can see all cases)
  router.get('/', authenticateToken, async (req, res) => {
    try {
      const query = `
        SELECT 
          dc.id,
          dc.case_description,
          dc.status,
          dc.recorded_at,
          dc.resolved_at,
          dc.resolution_notes,
          dc.case_type,
          s.full_name as student_name,
          s.sex as student_sex,
          c.name as class_name,
          t.name as teacher_name,
          t.role as teacher_role,
          u.username as recorded_by_username,
          u.name as recorded_by_name,
          u.role as recorded_by_role
        FROM discipline_cases dc
        LEFT JOIN students s ON dc.student_id = s.id
        LEFT JOIN classes c ON dc.class_id = c.id
        LEFT JOIN users t ON dc.teacher_id = t.id
        LEFT JOIN users u ON dc.recorded_by = u.id
        ORDER BY dc.recorded_at DESC
      `;
      
      const result = await pool.query(query);
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching discipline cases:', error);
      res.status(500).json({ error: 'Failed to fetch discipline cases' });
    }
  });

  // Get students for selection
  router.get('/students', authenticateToken, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT s.id, s.full_name, s.sex, c.name as class_name
        FROM students s
        LEFT JOIN classes c ON s.class_id = c.id
        ORDER BY s.full_name ASC
      `);
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching students:', error);
      res.status(500).json({ error: 'Failed to fetch students' });
    }
  });

  // Get classes for selection
  router.get('/classes', authenticateToken, async (req, res) => {
    try {
      const result = await pool.query('SELECT id, name FROM classes ORDER BY name ASC');
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching classes:', error);
      res.status(500).json({ error: 'Failed to fetch classes' });
    }
  });

  // Get teachers for selection (users with teacher role)
  router.get('/teachers', authenticateToken, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT u.id, u.username, u.name, u.role
        FROM users u
        WHERE u.role IN ('Teacher', 'Discipline', 'Psychosocialist', 'Admin1')
        ORDER BY u.name ASC
      `);
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching teachers:', error);
      res.status(500).json({ error: 'Failed to fetch teachers' });
    }
  });

  // Create a new discipline case
  router.post('/', authenticateToken, async (req, res) => {
    const { student_id, teacher_id, class_id, case_description, case_type } = req.body;
    
    // Validate that either student_id or teacher_id is provided
    if (!case_description) {
      return res.status(400).json({ error: 'case_description is required' });
    }
    
    if (!student_id && !teacher_id) {
      return res.status(400).json({ error: 'Either student_id or teacher_id is required' });
    }
    
    if (student_id && teacher_id) {
      return res.status(400).json({ error: 'Cannot have both student_id and teacher_id' });
    }

    try {
      let query, params;
      
      if (student_id) {
        // Student case
        if (!class_id) {
          return res.status(400).json({ error: 'class_id is required for student cases' });
        }
        query = `
          INSERT INTO discipline_cases (student_id, class_id, case_description, case_type, recorded_by)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING *
        `;
        params = [student_id, class_id, case_description, case_type || 'student', req.user.id];
      } else {
        // Teacher case
        query = `
          INSERT INTO discipline_cases (teacher_id, case_description, case_type, recorded_by)
          VALUES ($1, $2, $3, $4)
          RETURNING *
        `;
        params = [teacher_id, case_description, case_type || 'teacher', req.user.id];
      }
      
      const result = await pool.query(query, params);
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Error creating discipline case:', error);
      res.status(500).json({ error: 'Failed to create discipline case' });
    }
  });

  // Update case status (only Admin1 or the user who recorded it)
  router.put('/:id/status', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { status, resolution_notes } = req.body;
    
    if (!['resolved', 'not resolved'].includes(status)) {
      return res.status(400).json({ error: 'Status must be "resolved" or "not resolved"' });
    }

    try {
      // Check if user can update this case
      const checkResult = await pool.query(
        'SELECT recorded_by FROM discipline_cases WHERE id = $1',
        [id]
      );
      
      if (checkResult.rows.length === 0) {
        return res.status(404).json({ error: 'Discipline case not found' });
      }
      
      const caseRecord = checkResult.rows[0];
      
      // Only Admin users or the user who recorded the case can update it
      if (!req.user.role.startsWith('Admin') && caseRecord.recorded_by !== req.user.id) {
        return res.status(403).json({ error: 'Access denied. You can only update cases you recorded.' });
      }

      const updateFields = status === 'resolved' 
        ? 'status = $2, resolved_at = NOW(), resolved_by = $3, resolution_notes = $4'
        : 'status = $2, resolved_at = NULL, resolved_by = NULL, resolution_notes = $4';
      
      const params = status === 'resolved' 
        ? [id, status, req.user.id, resolution_notes || null]
        : [id, status, resolution_notes || null];

      const result = await pool.query(`
        UPDATE discipline_cases 
        SET ${updateFields}
        WHERE id = $1
        RETURNING *
      `, params);
      
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error updating discipline case:', error);
      res.status(500).json({ error: 'Failed to update discipline case' });
    }
  });

  // Delete a discipline case (only Admin1 or the user who recorded it)
  router.delete('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    
    try {
      // Check if user can delete this case
      const checkResult = await pool.query(
        'SELECT recorded_by FROM discipline_cases WHERE id = $1',
        [id]
      );
      
      if (checkResult.rows.length === 0) {
        return res.status(404).json({ error: 'Discipline case not found' });
      }
      
      const caseRecord = checkResult.rows[0];
      
      // Only Admin users or the user who recorded the case can delete it
      if (!req.user.role.startsWith('Admin') && caseRecord.recorded_by !== req.user.id) {
        return res.status(403).json({ error: 'Access denied. You can only delete cases you recorded.' });
      }
      
      const result = await pool.query('DELETE FROM discipline_cases WHERE id = $1 RETURNING *', [id]);
      
      res.json({ message: 'Discipline case deleted successfully' });
    } catch (error) {
      console.error('Error deleting discipline case:', error);
      res.status(500).json({ error: 'Failed to delete discipline case' });
    }
  });

  // Get case statistics (Admin users only)
  router.get('/stats', authenticateToken, async (req, res) => {
    if (!req.user.role.startsWith('Admin')) {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }
    
    try {
      const result = await pool.query(`
        SELECT 
          u.username as recorded_by_username,
          u.name as recorded_by_name,
          u.role as recorded_by_role,
          COUNT(*) as total_cases,
          COUNT(CASE WHEN dc.status = 'resolved' THEN 1 END) as resolved_cases,
          COUNT(CASE WHEN dc.status = 'not resolved' THEN 1 END) as pending_cases
        FROM discipline_cases dc
        LEFT JOIN users u ON dc.recorded_by = u.id
        GROUP BY u.id, u.username, u.name, u.role
        ORDER BY total_cases DESC
      `);
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching case statistics:', error);
      res.status(500).json({ error: 'Failed to fetch case statistics' });
    }
  });

  // Delete all discipline cases (Admin users only)
  router.delete('/', authenticateToken, async (req, res) => {
    if (!req.user.role.startsWith('Admin')) {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }
    
    try {
      await pool.query('DELETE FROM discipline_cases');
      res.json({ message: 'All discipline cases deleted successfully' });
    } catch (error) {
      console.error('Error deleting all discipline cases:', error);
      res.status(500).json({ error: 'Failed to delete all discipline cases' });
    }
  });

  return router;
}; 