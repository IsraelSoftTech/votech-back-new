const express = require('express');

module.exports = function createAttendanceRouter(pool, authenticateToken) {
  const router = express.Router();

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

  // Get approved teachers for selection
  router.get('/teachers', authenticateToken, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT 
          a.applicant_id as id,
          a.applicant_name as full_name,
          a.contact
        FROM applications a
        WHERE a.status = 'approved'
        ORDER BY a.applicant_name ASC
      `);
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching teachers:', error);
      res.status(500).json({ error: 'Failed to fetch teachers' });
    }
  });

  // Get students by class
  router.get('/:classId/students', authenticateToken, async (req, res) => {
    const { classId } = req.params;
    try {
      const result = await pool.query(
        'SELECT id, full_name, sex FROM students WHERE class_id = $1 ORDER BY full_name ASC',
        [classId]
      );
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching students for class:', error);
      res.status(500).json({ error: 'Failed to fetch students' });
    }
  });

  // Start attendance session
  router.post('/start', authenticateToken, async (req, res) => {
    const { type, class_id, session_time } = req.body;
    if (!type || !['student', 'teacher'].includes(String(type).toLowerCase())) {
      return res.status(400).json({ error: 'Invalid type. Must be student or teacher' });
    }
    try {
      console.log('Received session_time:', session_time);
      const result = await pool.query(
        `INSERT INTO attendance_sessions (type, class_id, taken_by, session_time)
         VALUES (LOWER($1), $2, $3, COALESCE($4, NOW())) RETURNING *`,
        [type, class_id || null, req.user.id || null, session_time || null]
      );
      console.log('Session created with time:', result.rows[0].session_time);
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Error starting attendance session:', error);
      res.status(500).json({ error: 'Failed to start session' });
    }
  });

  // Bulk mark attendance (supports both students and teachers)
  router.post('/:sessionId/mark-bulk', authenticateToken, async (req, res) => {
    const { sessionId } = req.params;
    const { records } = req.body; // [{student_id, status}] or [{teacher_id, status}]
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'records must be a non-empty array' });
    }
    
    // Get session type to determine if it's student or teacher attendance
    const sessionResult = await pool.query('SELECT type FROM attendance_sessions WHERE id = $1', [sessionId]);
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const sessionType = sessionResult.rows[0].type;
    
    // Validate records based on session type
    const valid = records.every(r => {
      if (sessionType === 'student') {
        return r && r.student_id && ['present', 'absent'].includes(r.status);
      } else {
        return r && r.teacher_id && ['present', 'absent'].includes(r.status);
      }
    });
    
    if (!valid) {
      return res.status(400).json({ error: 'Invalid records data' });
    }
    
    try {
      await pool.query('BEGIN');
      
      if (sessionType === 'student') {
        // Handle student attendance
        const insertText = `
          INSERT INTO attendance_records (session_id, student_id, status)
          VALUES ($1, $2, $3)
          ON CONFLICT (session_id, student_id)
          DO UPDATE SET status = EXCLUDED.status, marked_at = NOW()
        `;
        for (const r of records) {
          await pool.query(insertText, [sessionId, r.student_id, r.status]);
        }
      } else {
        // Handle teacher attendance - store in attendance_records with teacher_id
        const insertText = `
          INSERT INTO attendance_records (session_id, teacher_id, status)
          VALUES ($1, $2, $3)
          ON CONFLICT (session_id, teacher_id)
          DO UPDATE SET status = EXCLUDED.status, marked_at = NOW()
        `;
        for (const r of records) {
          await pool.query(insertText, [sessionId, r.teacher_id, r.status]);
        }
      }
      
      await pool.query('COMMIT');
      res.json({ message: 'Attendance saved' });
    } catch (error) {
      await pool.query('ROLLBACK');
      console.error('Error saving attendance:', error);
      res.status(500).json({ error: 'Failed to save attendance' });
    }
  });

  // Today summary: students and teachers
  router.get('/today-summary', authenticateToken, async (req, res) => {
    try {
      console.log('Fetching attendance summary...');
      const summaryQuery = `
        WITH recent_sessions AS (
          SELECT id, type FROM attendance_sessions
          WHERE session_time >= NOW() - INTERVAL '7 days'
        )
        SELECT
          COALESCE(SUM(CASE WHEN rs.type = 'student' AND ar.status = 'present' THEN 1 ELSE 0 END), 0) AS student_present,
          COALESCE(SUM(CASE WHEN rs.type = 'student' AND ar.status = 'absent' THEN 1 ELSE 0 END), 0) AS student_absent,
          COALESCE(SUM(CASE WHEN rs.type = 'teacher' AND ar.status = 'present' THEN 1 ELSE 0 END), 0) AS teacher_present,
          COALESCE(SUM(CASE WHEN rs.type = 'teacher' AND ar.status = 'absent' THEN 1 ELSE 0 END), 0) AS teacher_absent
        FROM recent_sessions rs
        LEFT JOIN attendance_records ar ON ar.session_id = rs.id
      `;
      const result = await pool.query(summaryQuery);
      const row = result.rows[0] || {};
      const summary = {
        students: { present: Number(row.student_present || 0), absent: Number(row.student_absent || 0) },
        teachers: { present: Number(row.teacher_present || 0), absent: Number(row.teacher_absent || 0) }
      };
      console.log('Attendance summary:', summary);
      res.json(summary);
    } catch (error) {
      console.error('Error fetching today summary:', error);
      res.status(500).json({ error: 'Failed to fetch summary' });
    }
  });

  // Debug endpoint to get all sessions (for debugging)
  router.get('/all-sessions', authenticateToken, async (req, res) => {
    try {
      console.log('Fetching all sessions for debugging...');
      const result = await pool.query(
        `SELECT s.id, LOWER(s.type) as type, s.session_time, c.name as class_name
         FROM attendance_sessions s
         LEFT JOIN classes c ON s.class_id = c.id
         ORDER BY s.session_time DESC
         LIMIT 20`
      );
      console.log(`Found ${result.rows.length} total sessions:`, result.rows);
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching all sessions:', error);
      res.status(500).json({ error: 'Failed to fetch all sessions' });
    }
  });

  // List of today's sessions with type, class and time
  router.get('/today-sessions', authenticateToken, async (req, res) => {
    try {
      console.log('Fetching recent sessions...');
      
      const result = await pool.query(
        `SELECT s.id, LOWER(s.type) as type, s.session_time, c.name as class_name
         FROM attendance_sessions s
         LEFT JOIN classes c ON s.class_id = c.id
         WHERE s.session_time >= NOW() - INTERVAL '7 days'
         ORDER BY s.session_time DESC`
      );
      console.log(`Found ${result.rows.length} recent sessions:`, result.rows);
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching recent sessions:', error);
      res.status(500).json({ error: 'Failed to fetch recent sessions' });
    }
  });

  // Debug endpoint to check stored dates
  router.get('/debug-dates', authenticateToken, async (req, res) => {
    try {
      console.log('Debug: Checking stored dates...');
      const result = await pool.query(`
        SELECT 
          id, 
          type, 
          session_time,
          session_time::date as stored_date,
          session_time AT TIME ZONE 'UTC' as utc_time,
          session_time AT TIME ZONE 'UTC' AT TIME ZONE 'UTC' as double_utc
        FROM attendance_sessions 
        ORDER BY session_time DESC 
        LIMIT 10
      `);
      console.log('Debug dates result:', result.rows);
      res.json(result.rows);
    } catch (error) {
      console.error('Error debugging dates:', error);
      res.status(500).json({ error: 'Failed to debug dates' });
    }
  });

  // Export attendance report
  router.get('/export', authenticateToken, async (req, res) => {
    try {
      const type = String(req.query.type || '').toLowerCase();
      const classId = req.query.classId ? Number(req.query.classId) : null;
      const date = req.query.date; // YYYY-MM-DD
      
      console.log('=== EXPORT REQUEST ===');
      console.log('Type:', type);
      console.log('Class ID:', classId);
      console.log('Date:', date);
      
      if (!['student', 'teacher'].includes(type)) {
        return res.status(400).json({ error: 'Invalid type' });
      }
      if (!date) {
        return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
      }
      if (type === 'student' && !classId) {
        return res.status(400).json({ error: 'classId is required for student attendance' });
      }

      // Step 1: Find all sessions for this date and type
      console.log('Step 1: Finding sessions...');
      const sessionsQuery = `
        SELECT id, session_time, class_id 
        FROM attendance_sessions 
        WHERE type = $1 
        AND session_time >= $2::timestamp 
        AND session_time < $2::timestamp + INTERVAL '1 day'
        ORDER BY session_time ASC
      `;
      const sessionsResult = await pool.query(sessionsQuery, [type, date]);
      const sessions = sessionsResult.rows;
      console.log(`Found ${sessions.length} sessions:`, sessions);

      if (sessions.length === 0) {
        console.log('No sessions found for this date and type');
        return res.json({
          type,
          date,
          className: type === 'student' ? 'N/A' : null,
          sessions: [],
          rows: []
        });
      }

      // Step 2: Filter sessions by class if needed
      let filteredSessions = sessions;
      if (type === 'student' && classId) {
        filteredSessions = sessions.filter(s => s.class_id === classId);
        console.log(`Filtered to class ${classId}:`, filteredSessions);
      }

      // Step 3: Get people (students or teachers)
      console.log('Step 3: Getting people...');
      let people = [];
      let className = null;
      
      if (type === 'student') {
        // Get class name and students
        const classResult = await pool.query('SELECT name FROM classes WHERE id = $1', [classId]);
        className = classResult.rows[0]?.name || 'Unknown Class';
        const studentsResult = await pool.query(
          'SELECT id, full_name, sex FROM students WHERE class_id = $1 ORDER BY full_name ASC',
          [classId]
        );
        people = studentsResult.rows;
        console.log(`Found ${people.length} students for class ${className}:`, people);
      } else {
        // Get all approved teachers
        const teachersResult = await pool.query(`
          SELECT 
            a.applicant_id as id,
            a.applicant_name as full_name,
            'N/A' as sex
          FROM applications a
          WHERE a.status = 'approved'
          ORDER BY a.applicant_name ASC
        `);
        people = teachersResult.rows;
        console.log(`Found ${people.length} approved teachers:`, people);
      }

      // Step 4: Get attendance records for these sessions
      console.log('Step 4: Getting attendance records...');
      const sessionIds = filteredSessions.map(s => s.id);
      const recordsQuery = type === 'student'
        ? `SELECT session_id, student_id, status FROM attendance_records WHERE session_id = ANY($1)`
        : `SELECT session_id, teacher_id, status FROM attendance_records WHERE session_id = ANY($1)`;
      const recordsResult = await pool.query(recordsQuery, [sessionIds]);
      const records = recordsResult.rows;
      console.log(`Found ${records.length} attendance records:`, records);

      // Step 5: Build the report
      console.log('Step 5: Building report...');
      const sessionTimes = filteredSessions.map(s => 
        new Date(s.session_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      );
      
      const rows = people.map(person => {
        const statuses = filteredSessions.map(session => {
          const record = records.find(r => {
            const personId = type === 'student' ? r.student_id : r.teacher_id;
            return personId === person.id && r.session_id === session.id;
          });
          return record ? (record.status === 'present' ? 'P' : 'A') : '';
        });
        
        const total_present = statuses.filter(s => s === 'P').length;
        const total_absent = statuses.filter(s => s === 'A').length;
        
        return {
          id: person.id,
          full_name: person.full_name,
          sex: person.sex,
          statuses,
          total_present,
          total_absent
        };
      });

      const result = {
        type,
        date,
        className,
        sessions: sessionTimes,
        rows
      };

      console.log('=== EXPORT RESULT ===');
      console.log('Final result:', result);
      console.log('Sessions count:', sessionTimes.length);
      console.log('Rows count:', rows.length);
      
      res.json(result);
      
    } catch (error) {
      console.error('Error exporting attendance:', error);
      res.status(500).json({ error: 'Failed to export attendance' });
    }
  });

  // Delete all attendance
  router.delete('/all', authenticateToken, async (req, res) => {
    try {
      await pool.query('BEGIN');
      await pool.query('DELETE FROM attendance_records');
      await pool.query('DELETE FROM attendance_sessions');
      await pool.query('COMMIT');
      res.json({ message: 'All attendance deleted' });
    } catch (error) {
      await pool.query('ROLLBACK');
      console.error('Error deleting all attendance:', error);
      res.status(500).json({ error: 'Failed to delete attendance' });
    }
  });

  return router;
}; 