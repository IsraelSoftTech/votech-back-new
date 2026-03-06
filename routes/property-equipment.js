const express = require("express");
const {
  pool,
  authenticateToken,
  requireAdmin,
} = require("./utils");

const router = express.Router();

const LEGACY_DEPARTMENTS = ["ME", "CE", "EE", "HCE", "TE", "General"];

async function isValidDepartment(department_location) {
  if (!department_location) return false;
  if (LEGACY_DEPARTMENTS.includes(department_location)) return true;
  const id = parseInt(department_location, 10);
  if (isNaN(id)) return false;
  const { rows } = await pool.query(
    "SELECT 1 FROM specialties WHERE id = $1",
    [id]
  );
  return rows.length > 0;
}

// Get all property/equipment
router.get("/", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pe.*, s.name as department_name
       FROM property_equipment pe
       LEFT JOIN specialties s ON s.id::text = pe.department_location
       ORDER BY COALESCE(s.name, pe.department_location), pe.name`
    );
    const rows = result.rows.map((r) => {
      const { department_name, ...rest } = r;
      return {
        ...rest,
        department_display: department_name || rest.department_location,
      };
    });
    res.json(rows);
  } catch (error) {
    console.error("Error fetching property equipment:", error);
    res.status(500).json({ error: "Failed to fetch property & equipment" });
  }
});

// Create
router.post("/", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, cost, department_location } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Equipment/Property name is required" });
    }
    if (cost == null || isNaN(parseFloat(cost))) {
      return res.status(400).json({ error: "Valid cost is required" });
    }
    if (!(await isValidDepartment(department_location))) {
      return res.status(400).json({
        error: "Department must be a valid department from the system",
      });
    }

    const result = await pool.query(
      `INSERT INTO property_equipment (name, cost, department_location)
       VALUES ($1, $2, $3) RETURNING *`,
      [name.trim(), parseFloat(cost), String(department_location)]
    );
    res.status(201).json({
      message: "Property/Equipment registered successfully",
      item: result.rows[0],
    });
  } catch (error) {
    console.error("Error creating property equipment:", error);
    res.status(500).json({ error: "Failed to register" });
  }
});

// Update
router.put("/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, cost, department_location } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Equipment/Property name is required" });
    }
    if (cost == null || isNaN(parseFloat(cost))) {
      return res.status(400).json({ error: "Valid cost is required" });
    }
    if (!(await isValidDepartment(department_location))) {
      return res.status(400).json({
        error: "Department must be a valid department from the system",
      });
    }

    const result = await pool.query(
      `UPDATE property_equipment SET
        name = $1, cost = $2, department_location = $3, updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [name.trim(), parseFloat(cost), String(department_location), id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Not found" });
    }
    res.json({ message: "Updated successfully", item: result.rows[0] });
  } catch (error) {
    console.error("Error updating property equipment:", error);
    res.status(500).json({ error: "Failed to update" });
  }
});

// Delete
router.delete("/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "DELETE FROM property_equipment WHERE id = $1 RETURNING *",
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Not found" });
    }
    res.json({ message: "Deleted successfully" });
  } catch (error) {
    console.error("Error deleting property equipment:", error);
    res.status(500).json({ error: "Failed to delete" });
  }
});

module.exports = router;
