const express = require("express");
const {
  pool,
  authenticateToken,
  requireAdmin,
} = require("./utils");

const router = express.Router();

// ========== HEADS ==========
// Get all heads (must be before /:id)
router.get("/heads", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM report_inventory_heads ORDER BY name"
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching heads:", error);
    res.status(500).json({ error: "Failed to fetch heads" });
  }
});

router.post("/heads", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Name is required" });
    }
    const result = await pool.query(
      "INSERT INTO report_inventory_heads (name) VALUES ($1) RETURNING *",
      [name.trim()]
    );
    res.status(201).json({ message: "Head added successfully", head: result.rows[0] });
  } catch (error) {
    console.error("Error creating head:", error);
    res.status(500).json({ error: "Failed to add head" });
  }
});

router.put("/heads/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Name is required" });
    }
    const result = await pool.query(
      "UPDATE report_inventory_heads SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
      [name.trim(), id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Head not found" });
    }
    res.json({ message: "Head updated successfully", head: result.rows[0] });
  } catch (error) {
    console.error("Error updating head:", error);
    res.status(500).json({ error: "Failed to update head" });
  }
});

router.delete("/heads/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "DELETE FROM report_inventory_heads WHERE id = $1 RETURNING *",
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Head not found" });
    }
    res.json({ message: "Head deleted successfully" });
  } catch (error) {
    console.error("Error deleting head:", error);
    res.status(500).json({ error: "Failed to delete head" });
  }
});

// ========== ITEMS ==========
// Get all report inventory items
router.get("/", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT i.*, h.name as head_name,
        COALESCE(i.amount, i.unit_cost_price * COALESCE(i.quantity, 1)) as amount
      FROM report_inventory i
      LEFT JOIN report_inventory_heads h ON i.head_id = h.id
      ORDER BY i.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching report inventory:", error);
    res.status(500).json({ error: "Failed to fetch inventory" });
  }
});

// Create report inventory item
router.post("/", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      item_name,
      head_id,
      category,
      uom,
      quantity,
      unit_cost_price,
      amount,
      supplier,
      support_doc,
    } = req.body;

    const amt = amount != null ? parseFloat(amount) : unit_cost_price;
    if (!item_name || !category || !uom || (amt == null && unit_cost_price == null)) {
      return res.status(400).json({
        error: "Item name, category, UOM, and amount are required",
      });
    }

    if (!["income", "expenditure"].includes(category)) {
      return res
        .status(400)
        .json({ error: 'Category must be "income" or "expenditure"' });
    }

    const validUom = ["Pieces", "Kg", "Liters", "Cartons", "Others"];
    if (!validUom.includes(uom)) {
      return res
        .status(400)
        .json({ error: "UOM must be one of: Pieces, Kg, Liters, Cartons, Others" });
    }

    // Generate item_id: first 2 letters of item_name + seq (e.g. Bo001)
    const rawPrefix = (item_name || "XX").slice(0, 2).toUpperCase();
    const prefix = rawPrefix.replace(/[^A-Z]/g, "X") || "XX";
    const { rows: existing } = await pool.query(
      "SELECT item_id FROM report_inventory WHERE item_id LIKE $1 ORDER BY item_id DESC LIMIT 1",
      [prefix + "%"]
    );
    let nextNum = 1;
    if (existing.length && existing[0].item_id) {
      const m = String(existing[0].item_id).match(/(\d+)$/);
      if (m) nextNum = parseInt(m[1], 10) + 1;
    }
    const itemId = prefix + String(nextNum).padStart(3, "0");

    const amountVal = parseFloat(amt != null ? amt : unit_cost_price);
    const result = await pool.query(
      `INSERT INTO report_inventory (
        item_name, head_id, category, uom, quantity, unit_cost_price,
        supplier, support_doc, item_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        item_name,
        head_id ? parseInt(head_id, 10) : null,
        category,
        uom,
        quantity != null && quantity !== '' ? parseInt(quantity, 10) : null,
        amountVal,
        category === "income" ? (supplier || null) : null,
        support_doc || null,
        itemId,
      ]
    );

    res.status(201).json({
      message: "Item registered successfully",
      item: result.rows[0],
    });
  } catch (error) {
    console.error("Error creating report inventory item:", error);
    res.status(500).json({ error: "Failed to register item" });
  }
});

// Update report inventory item
router.put("/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      item_name,
      head_id,
      category,
      uom,
      quantity,
      unit_cost_price,
      amount,
      supplier,
      support_doc,
    } = req.body;

    const amt = amount != null ? parseFloat(amount) : unit_cost_price;
    if (!item_name || !category || !uom || (amt == null && unit_cost_price == null)) {
      return res.status(400).json({
        error: "Item name, category, UOM, and amount are required",
      });
    }

    const validUom = ["Pieces", "Kg", "Liters", "Cartons", "Others"];
    if (!validUom.includes(uom)) {
      return res.status(400).json({ error: "UOM must be one of: Pieces, Kg, Liters, Cartons, Others" });
    }

    const existing = await pool.query(
      "SELECT * FROM report_inventory WHERE id = $1",
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Item not found" });
    }

    const amountVal = parseFloat(amt != null ? amt : unit_cost_price);
    const result = await pool.query(
      `UPDATE report_inventory SET
        item_name = $1, head_id = $2, category = $3, uom = $4, quantity = $5,
        unit_cost_price = $6, supplier = $7, support_doc = $8,
        updated_at = $9
      WHERE id = $10 RETURNING *`,
      [
        item_name,
        head_id ? parseInt(head_id, 10) : null,
        category,
        uom,
        quantity != null && quantity !== '' ? parseInt(quantity, 10) : null,
        amountVal,
        category === "income" ? (supplier || null) : null,
        support_doc || null,
        new Date(),
        id,
      ]
    );

    res.json({
      message: "Item updated successfully",
      item: result.rows[0],
    });
  } catch (error) {
    console.error("Error updating report inventory item:", error);
    res.status(500).json({ error: "Failed to update item" });
  }
});

// Delete report inventory item
router.delete("/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await pool.query(
      "SELECT * FROM report_inventory WHERE id = $1",
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Item not found" });
    }

    await pool.query("DELETE FROM report_inventory WHERE id = $1", [id]);

    res.json({ message: "Item deleted successfully" });
  } catch (error) {
    console.error("Error deleting report inventory item:", error);
    res.status(500).json({ error: "Failed to delete item" });
  }
});

module.exports = router;
