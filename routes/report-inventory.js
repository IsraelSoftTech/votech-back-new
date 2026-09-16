const express = require("express");
const {
  pool,
  authenticateToken,
  requireAdmin,
} = require("./utils");

const router = express.Router();

const MIN_TRANSACTION_DATE = "2000-01-01";

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

/**
 * Transactions are often recorded days or weeks after they happen, so any past
 * date is accepted. A future date is nearly always a typo; one day of slack
 * absorbs clock and timezone skew between the client and the server.
 */
function parseTransactionDate(value) {
  if (value == null || value === "") return null;

  const raw = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw badRequest("Transaction date must be in YYYY-MM-DD format");
  }

  const parsed = new Date(`${raw}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== raw
  ) {
    throw badRequest("That transaction date does not exist");
  }

  const latest = new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  if (raw > latest) {
    throw badRequest("Transaction date cannot be in the future");
  }
  if (raw < MIN_TRANSACTION_DATE) {
    throw badRequest(`Transaction date cannot be before ${MIN_TRANSACTION_DATE}`);
  }

  return raw;
}

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
    // transaction_date is sent as a plain YYYY-MM-DD string so the day cannot
    // shift when it crosses timezones on its way to the browser.
    const result = await pool.query(`
      SELECT i.*, h.name as head_name,
        COALESCE(i.amount, i.unit_cost_price) as amount,
        to_char(COALESCE(i.transaction_date, i.created_at::date), 'YYYY-MM-DD') as transaction_date
      FROM report_inventory i
      LEFT JOIN report_inventory_heads h ON i.head_id = h.id
      ORDER BY COALESCE(i.transaction_date, i.created_at::date) DESC, i.created_at DESC
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
      transaction_date,
    } = req.body;

    const amt = amount != null ? parseFloat(amount) : unit_cost_price;
    if (!item_name || !category || !uom || (amt == null && unit_cost_price == null)) {
      return res.status(400).json({
        error: "Item name, category, UOM, and amount are required",
      });
    }

    const txDate = parseTransactionDate(transaction_date);

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
      // amount is the total for the line exactly as entered. unit_cost_price
      // is the legacy NOT NULL column and carries the same figure.
      `INSERT INTO report_inventory (
        item_name, head_id, category, uom, quantity, unit_cost_price, amount,
        supplier, support_doc, item_id, transaction_date
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $6, $7, $8, $9,
        COALESCE($10::date, (NOW() AT TIME ZONE 'Africa/Douala')::date)
      )
      RETURNING *, to_char(transaction_date, 'YYYY-MM-DD') as transaction_date`,
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
        txDate,
      ]
    );

    res.status(201).json({
      message: "Item registered successfully",
      item: result.rows[0],
    });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ error: error.message });
    }
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
      transaction_date,
    } = req.body;

    const amt = amount != null ? parseFloat(amount) : unit_cost_price;
    if (!item_name || !category || !uom || (amt == null && unit_cost_price == null)) {
      return res.status(400).json({
        error: "Item name, category, UOM, and amount are required",
      });
    }

    const txDate = parseTransactionDate(transaction_date);

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
        unit_cost_price = $6, amount = $6, supplier = $7, support_doc = $8,
        transaction_date = COALESCE($9::date, transaction_date, created_at::date),
        updated_at = $10
      WHERE id = $11
      RETURNING *, to_char(transaction_date, 'YYYY-MM-DD') as transaction_date`,
      [
        item_name,
        head_id ? parseInt(head_id, 10) : null,
        category,
        uom,
        quantity != null && quantity !== '' ? parseInt(quantity, 10) : null,
        amountVal,
        category === "income" ? (supplier || null) : null,
        support_doc || null,
        txDate,
        new Date(),
        id,
      ]
    );

    res.json({
      message: "Item updated successfully",
      item: result.rows[0],
    });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ error: error.message });
    }
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
