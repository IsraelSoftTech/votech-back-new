const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const {
  pool,
  authenticateToken,
  logUserActivity,
  createUserSession,
  endUserSession,
  getIpAddress,
  getUserAgent,
  JWT_SECRET,
} = require("./utils");

const router = express.Router();

const { ChangeTypes, logChanges } = require("../src/utils/logChanges.util");

// Test endpoint
router.get("/test", (req, res) => {
  res.json({ message: "Auth routes working" });
});

// Setup admin endpoint
router.post("/setup-admin", async (req, res) => {
  try {
    // Check if admin already exists
    const existingAdmin = await pool.query(
      "SELECT * FROM users WHERE role = $1 OR role = $2 OR role = $3 OR role = $4 OR role = $5",
      ["admin", "Admin1", "Admin2", "Admin3", "Admin4"]
    );

    if (existingAdmin.rows.length > 0) {
      return res.status(400).json({ error: "Admin user already exists" });
    }

    // Create admin user
    const hashedPassword = await bcrypt.hash("admin123", 10);
    const result = await pool.query(
      "INSERT INTO users (name, username, password, role, contact, email) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
      [
        "Admin User",
        "admin",
        hashedPassword,
        "admin",
        "admin@school.com",
        "admin@school.com",
      ]
    );

    res.json({
      message: "Admin user created successfully",
      user: result.rows[0],
    });
  } catch (error) {
    console.error("Error setting up admin:", error);
    res.status(500).json({ error: "Failed to setup admin" });
  }
});

// Login endpoint
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "Username and password are required" });
    }

    // Find user by username
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [
      username,
    ]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = result.rows[0];

    // Check if user is suspended
    if (user.suspended) {
      return res.status(401).json({ error: "Account is suspended" });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Create JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    // Log user activity
    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);
    await logUserActivity(
      user.id,
      "login",
      "User logged in successfully",
      null,
      null,
      null,
      ipAddress,
      userAgent
    );

    // Create user session
    await createUserSession(user.id, ipAddress, userAgent);

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        role: user.role,
        contact: user.contact,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

// Logout endpoint
router.post("/logout", authenticateToken, async (req, res) => {
  try {
    // Log user activity
    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);
    await logUserActivity(
      req.user.id,
      "logout",
      "User logged out successfully",
      null,
      null,
      null,
      ipAddress,
      userAgent
    );

    // End user session
    await endUserSession(req.user.id);

    res.json({ message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ error: "Logout failed" });
  }
});

// Register endpoint
router.post("/register", async (req, res) => {
  try {
    const { name, username, password, role, contact, email } = req.body;

    if (!name || !username || !password || !role) {
      return res
        .status(400)
        .json({ error: "Name, username, password, and role are required" });
    }

    if (role === "Admin4") {
      const admin4Count = await pool.query(
        "SELECT COUNT(*) FROM users WHERE role = $1",
        ["Admin4"]
      );
      if (parseInt(admin4Count.rows[0].count) >= 2) {
        return res
          .status(400)
          .json({ error: "Maximum of 2 Admin4 accounts allowed" });
      }
    }

    const existingUser = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: "Username already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      "INSERT INTO users (name, username, password, role, contact, email) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
      [name, username, hashedPassword, role, contact || null, email || null]
    );

    const newUser = result.rows[0];
    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);

    await logUserActivity(
      newUser.id,
      "create",
      `Created user: ${username}`,
      "user",
      newUser.id,
      username,
      ipAddress,
      userAgent
    );
    await logChanges(
      "users",
      newUser.id,
      ChangeTypes.create,
      { id: newUser.id, username },
      req.user || { id: null }
    );

    res.status(201).json({
      message: "User registered successfully",
      user: {
        id: newUser.id,
        name: newUser.name,
        username: newUser.username,
        role: newUser.role,
        contact: newUser.contact,
        email: newUser.email,
      },
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Registration failed" });
  }
});

// Check user endpoint
router.post("/check-user", async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ error: "Username is required" });
    }

    const result = await pool.query(
      "SELECT id, username, name, role FROM users WHERE username = $1",
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error("Check user error:", error);
    res.status(500).json({ error: "Failed to check user" });
  }
});

// Reset password endpoint
router.post("/reset-password", async (req, res) => {
  try {
    const { username, newPassword } = req.body;

    if (!username || !newPassword) {
      return res
        .status(400)
        .json({ error: "Username and new password are required" });
    }

    const userResult = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = userResult.rows[0];
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.query("UPDATE users SET password = $1 WHERE username = $2", [
      hashedPassword,
      username,
    ]);

    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);
    await logUserActivity(
      user.id,
      "update",
      "Password reset",
      "user",
      user.id,
      username,
      ipAddress,
      userAgent
    );
    await logChanges(
      "users",
      user.id,
      ChangeTypes.update,
      { id: user.id, username: user.username },
      { id: user.id }
    );

    res.json({ message: "Password reset successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

// Change password endpoint
router.post("/change-password", authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ error: "Current password and new password are required" });
    }

    const userResult = await pool.query("SELECT * FROM users WHERE id = $1", [
      req.user.id,
    ]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = userResult.rows[0];
    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.query("UPDATE users SET password = $1 WHERE id = $2", [
      hashedPassword,
      req.user.id,
    ]);

    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);
    await logUserActivity(
      req.user.id,
      "update",
      "Password changed",
      "user",
      req.user.id,
      user.username,
      ipAddress,
      userAgent
    );
    await logChanges(
      "users",
      req.user.id,
      ChangeTypes.update,
      { id: req.user.id, username: user.username },
      req.user
    );

    res.json({ message: "Password changed successfully" });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({ error: "Failed to change password" });
  }
});

module.exports = router;
