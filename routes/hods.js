const express = require('express');
const router = express.Router();
const { pool } = require('./utils');
const { authenticateToken } = require('./utils');

// Get all HODs with related data
router.get('/', authenticateToken, async (req, res) => {
    try {
        const query = `
            SELECT 
                h.id,
                h.department_name,
                h.suspended,
                h.created_at,
                h.updated_at,
                u.id as hod_user_id,
                u.name as hod_user_name,
                u.username as hod_username,
                s.id as subject_id,
                s.name as subject_name,
                s.code as subject_code,
                COUNT(ht.teacher_id) as teacher_count
            FROM hods h
            LEFT JOIN users u ON h.hod_user_id = u.id
            LEFT JOIN subjects s ON h.subject_id = s.id
            LEFT JOIN hod_teachers ht ON h.id = ht.hod_id
            GROUP BY h.id, u.id, u.name, u.username, s.id, s.name, s.code
            ORDER BY h.created_at DESC
        `;
        
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching HODs:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get HOD by ID with teachers
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Get HOD details
        const hodQuery = `
            SELECT 
                h.*,
                u.name as hod_user_name,
                u.username as hod_username,
                s.name as subject_name,
                s.code as subject_code
            FROM hods h
            LEFT JOIN users u ON h.hod_user_id = u.id
            LEFT JOIN subjects s ON h.subject_id = s.id
            WHERE h.id = $1
        `;
        
        const hodResult = await pool.query(hodQuery, [id]);
        
        if (hodResult.rows.length === 0) {
            return res.status(404).json({ error: 'HOD not found' });
        }
        
        // Get teachers under this HOD
        const teachersQuery = `
            SELECT 
                u.id,
                u.name,
                u.username,
                u.email,
                u.role
            FROM hod_teachers ht
            JOIN users u ON ht.teacher_id = u.id
            WHERE ht.hod_id = $1
        `;
        
        const teachersResult = await pool.query(teachersQuery, [id]);
        
        const hod = hodResult.rows[0];
        hod.teachers = teachersResult.rows;
        
        res.json(hod);
    } catch (error) {
        console.error('Error fetching HOD:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create new HOD
router.post('/', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const { department_name, hod_user_id, subject_id, teacher_ids } = req.body;
        
        // Validate required fields (subject now optional)
        if (!department_name || !hod_user_id) {
            return res.status(400).json({ error: 'Department name and HOD user are required' });
        }
        
        // Check if department already exists
        const existingDept = await client.query(
            'SELECT id FROM hods WHERE department_name = $1',
            [department_name]
        );
        
        if (existingDept.rows.length > 0) {
            return res.status(400).json({ error: 'Department already exists' });
        }
        
        // Create HOD
        const hodResult = await client.query(
            `INSERT INTO hods (department_name, hod_user_id, subject_id) 
             VALUES ($1, $2, $3) RETURNING *`,
            [department_name, hod_user_id, subject_id || null]
        );
        
        const hod = hodResult.rows[0];
        
        // Add teachers if provided
        if (teacher_ids && teacher_ids.length > 0) {
            for (const teacher_id of teacher_ids) {
                await client.query(
                    'INSERT INTO hod_teachers (hod_id, teacher_id) VALUES ($1, $2)',
                    [hod.id, teacher_id]
                );
            }
        }
        
        await client.query('COMMIT');
        
        // Return the created HOD with full details
        const fullHodQuery = `
            SELECT 
                h.*,
                u.name as hod_user_name,
                u.username as hod_username,
                s.name as subject_name,
                s.code as subject_code
            FROM hods h
            LEFT JOIN users u ON h.hod_user_id = u.id
            LEFT JOIN subjects s ON h.subject_id = s.id
            WHERE h.id = $1
        `;
        
        const fullHodResult = await pool.query(fullHodQuery, [hod.id]);
        res.status(201).json(fullHodResult.rows[0]);
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error creating HOD:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// Update HOD
router.put('/:id', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const { id } = req.params;
        const { department_name, hod_user_id, subject_id, teacher_ids } = req.body;
        
        // Check if HOD exists
        const existingHod = await client.query('SELECT id FROM hods WHERE id = $1', [id]);
        if (existingHod.rows.length === 0) {
            return res.status(404).json({ error: 'HOD not found' });
        }
        
        // Update HOD
        const updateResult = await client.query(
            `UPDATE hods 
             SET department_name = $1, hod_user_id = $2, subject_id = $3, updated_at = CURRENT_TIMESTAMP
             WHERE id = $4 RETURNING *`,
            [department_name, hod_user_id, subject_id || null, id]
        );
        
        // Remove existing teachers
        await client.query('DELETE FROM hod_teachers WHERE hod_id = $1', [id]);
        
        // Add new teachers if provided
        if (teacher_ids && teacher_ids.length > 0) {
            for (const teacher_id of teacher_ids) {
                await client.query(
                    'INSERT INTO hod_teachers (hod_id, teacher_id) VALUES ($1, $2)',
                    [id, teacher_id]
                );
            }
        }
        
        await client.query('COMMIT');
        
        // Return updated HOD with full details
        const fullHodQuery = `
            SELECT 
                h.*,
                u.name as hod_user_name,
                u.username as hod_username,
                s.name as subject_name,
                s.code as subject_code
            FROM hods h
            LEFT JOIN users u ON h.hod_user_id = u.id
            LEFT JOIN subjects s ON h.subject_id = s.id
            WHERE h.id = $1
        `;
        
        const fullHodResult = await pool.query(fullHodQuery, [id]);
        res.json(fullHodResult.rows[0]);
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating HOD:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// Toggle HOD suspension status
router.patch('/:id/toggle-suspension', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(
            `UPDATE hods 
             SET suspended = NOT suspended, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 RETURNING *`,
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'HOD not found' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error toggling HOD suspension:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete HOD
router.delete('/:id', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const { id } = req.params;
        
        // Check if HOD exists
        const existingHod = await client.query('SELECT id FROM hods WHERE id = $1', [id]);
        if (existingHod.rows.length === 0) {
            return res.status(404).json({ error: 'HOD not found' });
        }
        
        // Delete teachers first (due to foreign key constraint)
        await client.query('DELETE FROM hod_teachers WHERE hod_id = $1', [id]);
        
        // Delete HOD
        await client.query('DELETE FROM hods WHERE id = $1', [id]);
        
        await client.query('COMMIT');
        res.json({ message: 'HOD deleted successfully' });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error deleting HOD:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// Get HOD statistics
router.get('/stats/overview', authenticateToken, async (req, res) => {
    try {
        const statsQuery = `
            SELECT 
                COUNT(*) as total_hods,
                COUNT(CASE WHEN suspended = true THEN 1 END) as suspended_hods,
                COUNT(CASE WHEN suspended = false THEN 1 END) as active_hods
            FROM hods
        `;
        
        const statsResult = await pool.query(statsQuery);
        res.json(statsResult.rows[0]);
        
    } catch (error) {
        console.error('Error fetching HOD stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
