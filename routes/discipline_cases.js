const express = require('express');

module.exports = function createDisciplineCasesRouter(pool, authenticateToken) {
  const router = express.Router();

  // Get all discipline cases
  router.get('/', authenticateToken, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT 
          dc.id,
          dc.case_description,
          dc.status,
          dc.recorded_at,
          dc.resolved_at,
          dc.resolution_notes,
          s.full_name as student_name,
          s.sex as student_sex,
          c.name as class_name,
          u.username as recorded_by_username
        FROM discipline_cases dc
        LEFT JOIN students s ON dc.student_id = s.id
        LEFT JOIN classes c ON dc.class_id = c.id
        LEFT JOIN users u ON dc.recorded_by = u.id
        ORDER BY dc.recorded_at DESC
      `);
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

  // Create a new discipline case
  router.post('/', authenticateToken, async (req, res) => {
    const { student_id, class_id, case_description } = req.body;
    
    if (!student_id || !class_id || !case_description) {
      return res.status(400).json({ error: 'student_id, class_id, and case_description are required' });
    }

    try {
      const result = await pool.query(`
        INSERT INTO discipline_cases (student_id, class_id, case_description, recorded_by)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [student_id, class_id, case_description, req.user.id]);
      
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Error creating discipline case:', error);
      res.status(500).json({ error: 'Failed to create discipline case' });
    }
  });

  // Update case status
  router.put('/:id/status', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { status, resolution_notes } = req.body;
    
    if (!['resolved', 'not resolved'].includes(status)) {
      return res.status(400).json({ error: 'Status must be "resolved" or "not resolved"' });
    }

    try {
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
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Discipline case not found' });
      }
      
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error updating discipline case:', error);
      res.status(500).json({ error: 'Failed to update discipline case' });
    }
  });

  // Delete a discipline case
  router.delete('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    
    try {
      const result = await pool.query('DELETE FROM discipline_cases WHERE id = $1 RETURNING *', [id]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Discipline case not found' });
      }
      
      res.json({ message: 'Discipline case deleted successfully' });
    } catch (error) {
      console.error('Error deleting discipline case:', error);
      res.status(500).json({ error: 'Failed to delete discipline case' });
    }
  });

  // Delete all discipline cases
  router.delete('/', authenticateToken, async (req, res) => {
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