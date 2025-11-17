const express = require("express");
const { pool, authenticateToken } = require("./utils");

const { logChanges, ChangeTypes } = require("../src/utils/logChanges.util");

const router = express.Router();

// Middleware to restrict Admin1 to read-only access
const restrictAdmin1ReadOnly = (req, res, next) => {
  if (req.user.role === "Admin1") {
    return res
      .status(403)
      .json({ error: "Admin1 accounts have read-only access to departments" });
  }
  next();
};

// Get all specialties
router.get("/", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM specialties ORDER BY name");
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching specialties:", error);
    res.status(500).json({ error: "Failed to fetch specialties" });
  }
});

// Create new specialty
router.post(
  "/",
  authenticateToken,
  restrictAdmin1ReadOnly,
  async (req, res) => {
    try {
      const { name, abbreviation } = req.body;
      const result = await pool.query(
        "INSERT INTO specialties (name, abbreviation) VALUES ($1, $2) RETURNING *",
        [name, abbreviation]
      );

      await logChanges(
        "specialties",
        result.rows[0].id,
        ChangeTypes.create,
        req.user,
        null
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error("Error creating specialty:", error);
      res.status(500).json({ error: "Failed to create specialty" });
    }
  }
);

// Update specialty
router.put(
  "/:id",
  authenticateToken,
  restrictAdmin1ReadOnly,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { name, abbreviation } = req.body;

      const beforeResult = await pool.query(
        "SELECT * FROM specialties WHERE id = $1",
        [id]
      );
      if (beforeResult.rows.length === 0) {
        return res.status(404).json({ error: "Specialty not found" });
      }
      const beforeState = beforeResult.rows[0];

      const result = await pool.query(
        "UPDATE specialties SET name = $1, abbreviation = $2 WHERE id = $3 RETURNING *",
        [name, abbreviation, id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Specialty not found" });
      }

      const afterState = result.rows[0];
      const fieldsChanged = {
        before: {
          name: beforeState.name,
          abbreviation: beforeState.abbreviation,
        },
        after: {
          name: afterState.name,
          abbreviation: afterState.abbreviation,
        },
      };

      await logChanges(
        "specialties",
        id,
        ChangeTypes.update,
        req.user,
        fieldsChanged
      );

      res.json(result.rows[0]);
    } catch (error) {
      console.error("Error updating specialty:", error);
      res.status(500).json({ error: "Failed to update specialty" });
    }
  }
);

// Delete specialty
router.delete(
  "/:id",
  authenticateToken,
  restrictAdmin1ReadOnly,
  async (req, res) => {
    try {
      const { id } = req.params;

      const beforeResult = await pool.query(
        "SELECT * FROM specialties WHERE id = $1",
        [id]
      );
      if (beforeResult.rows.length === 0) {
        return res.status(404).json({ error: "Specialty not found" });
      }
      const deletedData = beforeResult.rows[0];

      const result = await pool.query(
        "DELETE FROM specialties WHERE id = $1 RETURNING *",
        [id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Specialty not found" });
      }

      await logChanges("specialties", id, ChangeTypes.delete, req.user, {
        deletedData,
      });

      res.json({ message: "Specialty deleted successfully" });
    } catch (error) {
      console.error("Error deleting specialty:", error);
      res.status(500).json({ error: "Failed to delete specialty" });
    }
  }
);

// Add class to specialty
router.post(
  "/:specialty_id/classes",
  authenticateToken,
  restrictAdmin1ReadOnly,
  async (req, res) => {
    try {
      const { specialty_id } = req.params;
      const { class_id } = req.body;
      const result = await pool.query(
        "INSERT INTO specialty_classes (specialty_id, class_id) VALUES ($1, $2) RETURNING *",
        [specialty_id, class_id]
      );

      await logChanges(
        "specialty_classes",
        result.rows[0].id,
        ChangeTypes.create,
        req.user,
        null
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error("Error adding class to specialty:", error);
      res.status(500).json({ error: "Failed to add class to specialty" });
    }
  }
);

// Get classes for specialty
router.get("/:specialty_id/classes", authenticateToken, async (req, res) => {
  try {
    const { specialty_id } = req.params;
    const result = await pool.query(
      "SELECT c.* FROM classes c JOIN specialty_classes sc ON c.id = sc.class_id WHERE sc.specialty_id = $1",
      [specialty_id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching specialty classes:", error);
    res.status(500).json({ error: "Failed to fetch specialty classes" });
  }
});

// Remove class from specialty
router.delete(
  "/:specialty_id/classes/:class_id",
  authenticateToken,
  restrictAdmin1ReadOnly,
  async (req, res) => {
    try {
      const { specialty_id, class_id } = req.params;

      const beforeResult = await pool.query(
        "SELECT * FROM specialty_classes WHERE specialty_id = $1 AND class_id = $2",
        [specialty_id, class_id]
      );
      if (beforeResult.rows.length === 0) {
        return res.status(404).json({ error: "Class not found in specialty" });
      }
      const deletedData = beforeResult.rows[0];

      const result = await pool.query(
        "DELETE FROM specialty_classes WHERE specialty_id = $1 AND class_id = $2 RETURNING *",
        [specialty_id, class_id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Class not found in specialty" });
      }

      await logChanges(
        "specialty_classes",
        deletedData.id,
        ChangeTypes.delete,
        req.user,
        { deletedData }
      );

      res.json({ message: "Class removed from specialty successfully" });
    } catch (error) {
      console.error("Error removing class from specialty:", error);
      res.status(500).json({ error: "Failed to remove class from specialty" });
    }
  }
);

// Update specialty classes
router.put(
  "/:id/classes",
  authenticateToken,
  restrictAdmin1ReadOnly,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { class_ids } = req.body;

      const beforeResult = await pool.query(
        "SELECT * FROM specialty_classes WHERE specialty_id = $1",
        [id]
      );
      const deletedData = beforeResult.rows;

      await pool.query(
        "DELETE FROM specialty_classes WHERE specialty_id = $1",
        [id]
      );

      for (const record of deletedData) {
        await logChanges(
          "specialty_classes",
          record.id,
          ChangeTypes.delete,
          req.user,
          { deletedData: record }
        );
      }

      if (class_ids && class_ids.length > 0) {
        for (const class_id of class_ids) {
          const insertResult = await pool.query(
            "INSERT INTO specialty_classes (specialty_id, class_id) VALUES ($1, $2) RETURNING *",
            [id, class_id]
          );
          await logChanges(
            "specialty_classes",
            insertResult.rows[0].id,
            ChangeTypes.create,
            req.user,
            null
          );
        }
      }

      res.json({ message: "Specialty classes updated successfully" });
    } catch (error) {
      console.error("Error updating specialty classes:", error);
      res.status(500).json({ error: "Failed to update specialty classes" });
    }
  }
);

// Get classes for specialty (alternative endpoint)
router.get("/:id/classes", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "SELECT c.* FROM classes c JOIN specialty_classes sc ON c.id = sc.class_id WHERE sc.specialty_id = $1",
      [id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching specialty classes:", error);
    res.status(500).json({ error: "Failed to fetch specialty classes" });
  }
});

module.exports = router;
