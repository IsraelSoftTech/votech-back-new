const express = require("express");
const multer = require("multer");
const ftpService = require("../ftp-service");
const { pool, authenticateToken } = require("./utils");

const { logChanges, ChangeTypes } = require("../src/utils/logChanges.util");

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

// Create vocational item
router.post(
  "/",
  authenticateToken,
  upload.fields([
    { name: "picture1", maxCount: 1 },
    { name: "picture2", maxCount: 1 },
    { name: "picture3", maxCount: 1 },
    { name: "picture4", maxCount: 1 },
  ]),
  async (req, res) => {
    const { title, description, year } = req.body;
    const userId = req.user.id;

    let picture1, picture2, picture3, picture4;
    try {
      if (req.files.picture1 && req.files.picture1[0]) {
        picture1 = await ftpService.uploadBuffer(
          req.files.picture1[0].buffer,
          `vocational/${Date.now()}_${req.files.picture1[0].originalname}`
        );
      }
      if (req.files.picture2 && req.files.picture2[0]) {
        picture2 = await ftpService.uploadBuffer(
          req.files.picture2[0].buffer,
          `vocational/${Date.now()}_${req.files.picture2[0].originalname}`
        );
      }
      if (req.files.picture3 && req.files.picture3[0]) {
        picture3 = await ftpService.uploadBuffer(
          req.files.picture3[0].buffer,
          `vocational/${Date.now()}_${req.files.picture3[0].originalname}`
        );
      }
      if (req.files.picture4 && req.files.picture4[0]) {
        picture4 = await ftpService.uploadBuffer(
          req.files.picture4[0].buffer,
          `vocational/${Date.now()}_${req.files.picture4[0].originalname}`
        );
      }
    } catch (e) {
      console.error("Failed to upload vocational pictures to FTP:", e);
      return res
        .status(500)
        .json({ error: "Failed to upload vocational pictures" });
    }

    try {
      const result = await pool.query(
        `INSERT INTO vocational (user_id, name, description, picture1, picture2, picture3, picture4, year)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          userId,
          title,
          description,
          picture1,
          picture2,
          picture3,
          picture4,
          year,
        ]
      );

      await logChanges(
        "vocational",
        result.rows[0].id,
        ChangeTypes.create,
        req.user,
        null
      );

      res.status(201).json({ id: result.rows[0].id });
    } catch (error) {
      console.error("Error creating vocational department:", error);
      res.status(500).json({ error: "Error creating vocational department" });
    }
  }
);

// List vocational items
router.get("/", authenticateToken, async (req, res) => {
  const year = req.query.year ? parseInt(req.query.year) : null;
  try {
    let query = `SELECT id, user_id, name as title, description, picture1, picture2, picture3, picture4, year, created_at, updated_at FROM vocational`;
    const params = [];
    if (year) {
      query += " WHERE year = $1";
      params.push(year);
    }
    query += " ORDER BY created_at DESC";
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching vocational departments:", error);
    res.status(500).json({ error: "Error fetching vocational departments" });
  }
});

// Update vocational item
router.put(
  "/:id",
  authenticateToken,
  upload.fields([
    { name: "picture1", maxCount: 1 },
    { name: "picture2", maxCount: 1 },
    { name: "picture3", maxCount: 1 },
    { name: "picture4", maxCount: 1 },
  ]),
  async (req, res) => {
    const { title, description, year } = req.body;
    const userId = req.user.id;
    const vocationalId = req.params.id;

    try {
      const resultVocPut = await pool.query(
        "SELECT * FROM vocational WHERE id = $1 AND user_id = $2",
        [vocationalId, userId]
      );
      if (resultVocPut.rows.length === 0) {
        return res
          .status(404)
          .json({ error: "Vocational department not found" });
      }

      const beforeState = resultVocPut.rows[0];

      const updateParts = ["name = $1", "description = $2", "year = $3"];
      const values = [title, description, year];
      let paramIndex = 4;

      const addFile = async (fieldName) => {
        if (req.files[fieldName] && req.files[fieldName][0]) {
          const remotePath = await ftpService.uploadBuffer(
            req.files[fieldName][0].buffer,
            `vocational/${Date.now()}_${req.files[fieldName][0].originalname}`
          );
          updateParts.push(`${fieldName} = $${paramIndex}`);
          values.push(remotePath);
          paramIndex++;
        }
      };

      await addFile("picture1");
      await addFile("picture2");
      await addFile("picture3");
      await addFile("picture4");

      const updateQuery = `UPDATE vocational SET ${updateParts.join(
        ", "
      )} WHERE id = $${paramIndex} AND user_id = $${
        paramIndex + 1
      } RETURNING *`;
      values.push(vocationalId, userId);
      const updateResult = await pool.query(updateQuery, values);

      const afterState = updateResult.rows[0];
      const fieldsChanged = {
        before: {
          name: beforeState.name,
          description: beforeState.description,
          year: beforeState.year,
          picture1: beforeState.picture1,
          picture2: beforeState.picture2,
          picture3: beforeState.picture3,
          picture4: beforeState.picture4,
        },
        after: {
          name: afterState.name,
          description: afterState.description,
          year: afterState.year,
          picture1: afterState.picture1,
          picture2: afterState.picture2,
          picture3: afterState.picture3,
          picture4: afterState.picture4,
        },
      };

      await logChanges(
        "vocational",
        vocationalId,
        ChangeTypes.update,
        req.user,
        fieldsChanged
      );

      res.json({ message: "Vocational department updated successfully" });
    } catch (error) {
      console.error("Error updating vocational department:", error);
      res.status(500).json({ error: "Error updating vocational department" });
    }
  }
);

// Delete vocational item
router.delete("/:id", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const vocationalId = req.params.id;
  try {
    const resultVocDel = await pool.query(
      "SELECT * FROM vocational WHERE id = $1 AND user_id = $2",
      [vocationalId, userId]
    );
    if (resultVocDel.rows.length === 0) {
      return res.status(404).json({ error: "Vocational department not found" });
    }

    const deletedData = resultVocDel.rows[0];

    await pool.query("DELETE FROM vocational WHERE id = $1 AND user_id = $2", [
      vocationalId,
      userId,
    ]);

    await logChanges("vocational", vocationalId, ChangeTypes.delete, req.user, {
      deletedData,
    });

    res.json({ message: "Vocational department deleted successfully" });
  } catch (error) {
    console.error("Error deleting vocational department:", error);
    res.status(500).json({ error: "Error deleting vocational department" });
  }
});

module.exports = router;
