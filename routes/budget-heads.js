const express = require("express");
const { pool, authenticateToken } = require("./utils");
const { ChangeTypes, logChanges } = require("../src/utils/logChanges.util");

const router = express.Router();

// Get all budget heads
router.get("/", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM budget_heads ORDER BY name");
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching budget heads:", error);
    res.status(500).json({ error: "Failed to fetch budget heads" });
  }
});

router.post("/", authenticateToken, async (req, res) => {
  try {
    const { name, code, category, description, allocated_amount } = req.body;

    if (!name || !category) {
      return res.status(400).json({ error: "Name and category are required" });
    }

    if (!["income", "expenditure", "asset"].includes(category)) {
      return res
        .status(400)
        .json({ error: "Category must be income, expenditure, or asset" });
    }

    if (code) {
      const existingCode = await pool.query(
        "SELECT id FROM budget_heads WHERE code = $1",
        [code]
      );
      if (existingCode.rows.length > 0) {
        return res.status(400).json({
          error:
            "Budget head code already exists. Please use a different code or leave it empty.",
        });
      }
    }

    const existingName = await pool.query(
      "SELECT id FROM budget_heads WHERE name = $1",
      [name]
    );
    if (existingName.rows.length > 0) {
      return res.status(400).json({
        error: "Budget head name already exists. Please use a different name.",
      });
    }

    const result = await pool.query(
      "INSERT INTO budget_heads (name, code, category, description, allocated_amount) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [
        name,
        code || null,
        category,
        description || null,
        allocated_amount ? parseFloat(allocated_amount) : null,
      ]
    );

    await logChanges(
      "budget_heads",
      result.rows[0].id,
      ChangeTypes.create,
      result.rows[0]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating budget head:", error);
    if (error.code === "23505") {
      if (error.constraint === "budget_heads_code_key") {
        return res.status(400).json({
          error:
            "Budget head code already exists. Please use a different code or leave it empty.",
        });
      } else if (error.constraint === "budget_heads_name_key") {
        return res.status(400).json({
          error:
            "Budget head name already exists. Please use a different name.",
        });
      }
    }
    res.status(500).json({ error: "Failed to create budget head" });
  }
});

router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, category, description, allocated_amount } = req.body;

    if (!name || !category) {
      return res.status(400).json({ error: "Name and category are required" });
    }

    if (!["income", "expenditure", "asset"].includes(category)) {
      return res
        .status(400)
        .json({ error: "Category must be income, expenditure, or asset" });
    }

    const oldDataResult = await pool.query(
      "SELECT * FROM budget_heads WHERE id = $1",
      [id]
    );
    if (oldDataResult.rows.length === 0) {
      return res.status(404).json({ error: "Budget head not found" });
    }
    const oldData = oldDataResult.rows[0];

    const result = await pool.query(
      "UPDATE budget_heads SET name = $1, code = $2, category = $3, description = $4, allocated_amount = $5 WHERE id = $6 RETURNING *",
      [
        name,
        code || null,
        category,
        description || null,
        allocated_amount ? parseFloat(allocated_amount) : null,
        id,
      ]
    );

    await logChanges(
      "budget_heads",
      id,
      ChangeTypes.update,
      oldData,
      result.rows[0]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating budget head:", error);
    res.status(500).json({ error: "Failed to update budget head" });
  }
});

router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const oldDataResult = await pool.query(
      "SELECT * FROM budget_heads WHERE id = $1",
      [id]
    );
    if (oldDataResult.rows.length === 0) {
      return res.status(404).json({ error: "Budget head not found" });
    }
    const oldData = oldDataResult.rows[0];

    const result = await pool.query(
      "DELETE FROM budget_heads WHERE id = $1 RETURNING *",
      [id]
    );

    await logChanges("budget_heads", id, ChangeTypes.delete, oldData);

    res.json({ message: "Budget head deleted successfully" });
  } catch (error) {
    console.error("Error deleting budget head:", error);
    res.status(500).json({ error: "Failed to delete budget head" });
  }
});

module.exports = router;
