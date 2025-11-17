const express = require("express");
const { pool, authenticateToken } = require("./utils");
const { ChangeTypes, logChanges } = require("../src/utils/logChanges.util");

const router = express.Router();

// Get all asset categories
router.get("/", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM asset_categories ORDER BY name"
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching asset categories:", error);
    res.status(500).json({ error: "Failed to fetch asset categories" });
  }
});

// Create new asset category
router.post("/", authenticateToken, async (req, res) => {
  try {
    const { name, description, default_depreciation_rate, useful_life_years } =
      req.body;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    const result = await pool.query(
      "INSERT INTO asset_categories (name, description, default_depreciation_rate, useful_life_years) VALUES ($1, $2, $3, $4) RETURNING *",
      [
        name,
        description || null,
        default_depreciation_rate
          ? parseFloat(default_depreciation_rate)
          : null,
        useful_life_years ? parseInt(useful_life_years) : null,
      ]
    );

    const inserted = result.rows[0];
    await logChanges(
      "asset_categories",
      inserted.id,
      ChangeTypes.create,
      req.user,
      inserted
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating asset category:", error);
    res.status(500).json({ error: "Failed to create asset category" });
  }
});

// Update asset category
router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, default_depreciation_rate, useful_life_years } =
      req.body;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    const result = await pool.query(
      "UPDATE asset_categories SET name = $1, description = $2, default_depreciation_rate = $3, useful_life_years = $4 WHERE id = $5 RETURNING *",
      [
        name,
        description || null,
        default_depreciation_rate
          ? parseFloat(default_depreciation_rate)
          : null,
        useful_life_years ? parseInt(useful_life_years) : null,
        id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Asset category not found" });
    }

    const updated = result.rows[0];

    await logChanges(
      "asset_categories",
      updated.id,
      ChangeTypes.update,
      req.user,
      {
        name: updated.name,
        description: updated.description,
        default_depreciation_rate: updated.default_depreciation_rate,
        useful_life_years: updated.useful_life_years,
      }
    );

    res.json(updated);
  } catch (error) {
    console.error("Error updating asset category:", error);
    res.status(500).json({ error: "Failed to update asset category" });
  }
});

// Delete asset category
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "DELETE FROM asset_categories WHERE id = $1 RETURNING *",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Asset category not found" });
    }

    const deleted = result.rows[0];

    await logChanges(
      "asset_categories",
      deleted.id,
      ChangeTypes.delete,
      req.user,
      deleted
    );

    res.json({ message: "Asset category deleted successfully" });
  } catch (error) {
    console.error("Error deleting asset category:", error);
    res.status(500).json({ error: "Failed to delete asset category" });
  }
});

module.exports = router;
