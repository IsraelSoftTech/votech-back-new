const express = require("express");
const router = express.Router();
const { pool } = require("./utils");
const { authenticateToken } = require("./utils");

const { ChangeTypes, logChanges } = require("../src/utils/logChanges.util");
const {
  getHodAssignment,
  syncHodUserStatus,
} = require("../src/services/hodStatus.service");

const HOD_MANAGER_ROLES = ["Admin4"];

function assertHodManager(req, res) {
  if (!HOD_MANAGER_ROLES.includes(req.user?.role)) {
    res.status(403).json({ error: "Only Admin4 can manage HODs" });
    return false;
  }
  return true;
}

function decorateHod(row) {
  if (!row) return row;
  const suspended = row.suspended === true || row.suspended === "t";
  return {
    ...row,
    suspended,
    hod_status: suspended ? "suspended" : "active",
  };
}

const HOD_DETAIL_SQL = `
  SELECT
    h.*,
    u.id as hod_user_id,
    u.name as hod_user_name,
    u.username as hod_username,
    s.id as subject_id,
    s.name as subject_name,
    s.code as subject_code,
    sp.id as department_id
  FROM hods h
  LEFT JOIN users u ON h.hod_user_id = u.id
  LEFT JOIN subjects s ON h.subject_id = s.id
  LEFT JOIN specialties sp ON LOWER(TRIM(sp.name)) = LOWER(TRIM(h.department_name))
  WHERE h.id = $1
`;

async function fetchHodDetail(hodId) {
  const result = await pool.query(HOD_DETAIL_SQL, [hodId]);
  return result.rows[0] ? decorateHod(result.rows[0]) : null;
}

router.get("/me", authenticateToken, async (req, res) => {
  try {
    const assignment = await getHodAssignment(pool, req.user.id);
    res.json(assignment);
  } catch (error) {
    console.error("Error fetching current HOD status:", error);
    res.status(500).json({ error: "Failed to fetch HOD status" });
  }
});

router.get("/stats/overview", authenticateToken, async (req, res) => {
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
    console.error("Error fetching HOD stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/", authenticateToken, async (req, res) => {
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
        sp.id as department_id,
        COUNT(ht.teacher_id) as teacher_count
      FROM hods h
      LEFT JOIN users u ON h.hod_user_id = u.id
      LEFT JOIN subjects s ON h.subject_id = s.id
      LEFT JOIN specialties sp ON LOWER(TRIM(sp.name)) = LOWER(TRIM(h.department_name))
      LEFT JOIN hod_teachers ht ON h.id = ht.hod_id
      GROUP BY h.id, u.id, u.name, u.username, s.id, s.name, s.code, sp.id
      ORDER BY h.created_at DESC
    `;
    const result = await pool.query(query);
    res.json(result.rows.map(decorateHod));
  } catch (error) {
    console.error("Error fetching HODs:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^\d+$/.test(String(id))) {
      return res.status(400).json({ error: "Invalid HOD id" });
    }

    const hod = await fetchHodDetail(id);
    if (!hod) {
      return res.status(404).json({ error: "HOD not found" });
    }

    const teachersResult = await pool.query(
      `
      SELECT
        u.id,
        u.name,
        u.username,
        u.email,
        u.role
      FROM hod_teachers ht
      JOIN users u ON ht.teacher_id = u.id
      WHERE ht.hod_id = $1
      `,
      [id]
    );

    hod.teachers = teachersResult.rows;
    res.json(hod);
  } catch (error) {
    console.error("Error fetching HOD:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!assertHodManager(req, res)) return;

    await client.query("BEGIN");

    const { department_name, hod_user_id, subject_id, teacher_ids } = req.body;

    if (!department_name || !hod_user_id) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "Department name and HOD user are required" });
    }

    const existingDept = await client.query(
      "SELECT id FROM hods WHERE LOWER(TRIM(department_name)) = LOWER(TRIM($1))",
      [department_name]
    );
    if (existingDept.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Department already has an HOD" });
    }

    const existingUser = await client.query(
      "SELECT id FROM hods WHERE hod_user_id = $1",
      [hod_user_id]
    );
    if (existingUser.rows.length > 0) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "This user is already assigned as an HOD" });
    }

    const hodResult = await client.query(
      `INSERT INTO hods (department_name, hod_user_id, subject_id, suspended)
       VALUES ($1, $2, $3, false) RETURNING *`,
      [department_name, hod_user_id, subject_id || null]
    );

    const hod = hodResult.rows[0];

    if (teacher_ids && teacher_ids.length > 0) {
      for (const teacher_id of teacher_ids) {
        await client.query(
          "INSERT INTO hod_teachers (hod_id, teacher_id) VALUES ($1, $2)",
          [hod.id, teacher_id]
        );
      }
    }

    await client.query("COMMIT");

    const fullHod = await fetchHodDetail(hod.id);
    await logChanges("hods", hod.id, ChangeTypes.create, req.user);
    await syncHodUserStatus(pool, hod_user_id);
    res.status(201).json(fullHod);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error creating HOD:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

router.put("/:id", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!assertHodManager(req, res)) return;

    await client.query("BEGIN");

    const { id } = req.params;
    const { department_name, hod_user_id, subject_id, teacher_ids } = req.body;

    const existingHod = await client.query("SELECT * FROM hods WHERE id = $1", [
      id,
    ]);
    if (existingHod.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "HOD not found" });
    }

    const oldHod = existingHod.rows[0];

    if (department_name) {
      const existingDept = await client.query(
        "SELECT id FROM hods WHERE LOWER(TRIM(department_name)) = LOWER(TRIM($1)) AND id <> $2",
        [department_name, id]
      );
      if (existingDept.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Department already has an HOD" });
      }
    }

    if (hod_user_id && String(hod_user_id) !== String(oldHod.hod_user_id)) {
      const existingUser = await client.query(
        "SELECT id FROM hods WHERE hod_user_id = $1 AND id <> $2",
        [hod_user_id, id]
      );
      if (existingUser.rows.length > 0) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({ error: "This user is already assigned as an HOD" });
      }
    }

    const updateResult = await client.query(
      `UPDATE hods
       SET department_name = $1, hod_user_id = $2, subject_id = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 RETURNING *`,
      [department_name, hod_user_id, subject_id || null, id]
    );

    await client.query("DELETE FROM hod_teachers WHERE hod_id = $1", [id]);

    if (teacher_ids && teacher_ids.length > 0) {
      for (const teacher_id of teacher_ids) {
        await client.query(
          "INSERT INTO hod_teachers (hod_id, teacher_id) VALUES ($1, $2)",
          [id, teacher_id]
        );
      }
    }

    await client.query("COMMIT");

    const fullHod = await fetchHodDetail(id);
    const fieldsChanged = {};
    const updated = updateResult.rows[0];
    if (oldHod.department_name !== updated.department_name)
      fieldsChanged.department_name = {
        before: oldHod.department_name,
        after: updated.department_name,
      };
    if (oldHod.hod_user_id !== updated.hod_user_id)
      fieldsChanged.hod_user_id = {
        before: oldHod.hod_user_id,
        after: updated.hod_user_id,
      };
    if (oldHod.subject_id !== updated.subject_id)
      fieldsChanged.subject_id = {
        before: oldHod.subject_id,
        after: updated.subject_id,
      };
    await logChanges("hods", id, ChangeTypes.update, req.user, fieldsChanged);

    if (String(oldHod.hod_user_id) !== String(hod_user_id)) {
      await syncHodUserStatus(pool, oldHod.hod_user_id);
    }
    await syncHodUserStatus(pool, hod_user_id);

    res.json(fullHod);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error updating HOD:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

router.patch("/:id/toggle-suspension", authenticateToken, async (req, res) => {
  try {
    if (!assertHodManager(req, res)) return;

    const { id } = req.params;
    const oldRecord = await pool.query("SELECT * FROM hods WHERE id = $1", [
      id,
    ]);
    if (oldRecord.rows.length === 0) {
      return res.status(404).json({ error: "HOD not found" });
    }

    const result = await pool.query(
      `UPDATE hods
       SET suspended = NOT suspended, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "HOD not found" });
    }

    const fieldsChanged = {};
    const old = oldRecord.rows[0];
    const updated = result.rows[0];
    if (old.suspended !== updated.suspended)
      fieldsChanged.suspended = {
        before: old.suspended,
        after: updated.suspended,
      };
    await logChanges("hods", id, ChangeTypes.update, req.user, fieldsChanged);

    const assignment = await syncHodUserStatus(pool, updated.hod_user_id);
    const fullHod = await fetchHodDetail(id);
    res.json({ ...fullHod, ...assignment });
  } catch (error) {
    console.error("Error toggling HOD suspension:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!assertHodManager(req, res)) return;

    await client.query("BEGIN");

    const { id } = req.params;
    const existingHod = await client.query(
      "SELECT * FROM hods WHERE id = $1",
      [id]
    );
    if (existingHod.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "HOD not found" });
    }

    const hodUserId = existingHod.rows[0].hod_user_id;

    await client.query("DELETE FROM hod_teachers WHERE hod_id = $1", [id]);
    await client.query("DELETE FROM hods WHERE id = $1", [id]);

    await client.query("COMMIT");
    await logChanges("hods", id, ChangeTypes.delete, req.user);
    await syncHodUserStatus(pool, hodUserId);
    res.json({
      message: "HOD deleted successfully",
      hod_status: "none",
      hod_user_id: hodUserId,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error deleting HOD:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

module.exports = router;
