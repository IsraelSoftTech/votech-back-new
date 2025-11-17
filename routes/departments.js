const express = require("express");
const { pool, authenticateToken } = require("./utils");

const router = express.Router();

const { ChangeTypes, logChanges } = require("../src/utils/logChanges.util");

// Get all departments
router.get("/", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM departments ORDER BY name");
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching departments:", error);
    res.status(500).json({ error: "Failed to fetch departments" });
  }
});

// Create new department
router.post("/", authenticateToken, async (req, res) => {
  try {
    const { name, description, head_teacher_id, budget } = req.body;
    const result = await pool.query(
      "INSERT INTO departments (name, description, head_teacher_id, budget) VALUES ($1, $2, $3, $4) RETURNING *",
      [name, description, head_teacher_id, budget]
    );
    await logChanges(
      "departments",
      result.rows[0].id,
      ChangeTypes.create,
      req.user
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating department:", error);
    res.status(500).json({ error: "Failed to create department" });
  }
});

// Update department
router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, head_teacher_id, budget } = req.body;
    const oldRecord = await pool.query(
      "SELECT * FROM departments WHERE id = $1",
      [id]
    );
    if (oldRecord.rows.length === 0) {
      return res.status(404).json({ error: "Department not found" });
    }
    const result = await pool.query(
      "UPDATE departments SET name = $1, description = $2, head_teacher_id = $3, budget = $4 WHERE id = $5 RETURNING *",
      [name, description, head_teacher_id, budget, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Department not found" });
    }
    const fieldsChanged = {};
    const old = oldRecord.rows[0];
    const updated = result.rows[0];
    if (old.name !== updated.name)
      fieldsChanged.name = { before: old.name, after: updated.name };
    if (old.description !== updated.description)
      fieldsChanged.description = {
        before: old.description,
        after: updated.description,
      };
    if (old.head_teacher_id !== updated.head_teacher_id)
      fieldsChanged.head_teacher_id = {
        before: old.head_teacher_id,
        after: updated.head_teacher_id,
      };
    if (old.budget !== updated.budget)
      fieldsChanged.budget = { before: old.budget, after: updated.budget };
    await logChanges(
      "departments",
      id,
      ChangeTypes.update,
      req.user,
      fieldsChanged
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating department:", error);
    res.status(500).json({ error: "Failed to update department" });
  }
});

// Delete department
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "DELETE FROM departments WHERE id = $1 RETURNING *",
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Department not found" });
    }
    await logChanges("departments", id, ChangeTypes.delete, req.user);
    res.json({ message: "Department deleted successfully" });
  } catch (error) {
    console.error("Error deleting department:", error);
    res.status(500).json({ error: "Failed to delete department" });
  }
});

module.exports = router;
