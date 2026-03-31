#!/usr/bin/env node
/**
 * Script to delete the user with username "Tester" from the database.
 * Run from backnew folder: node scripts/delete-user-tester.js
 */
require("dotenv").config();
const { Pool } = require("pg");

const isDesktop = process.env.NODE_ENV === "desktop";
const isDevelopment = process.env.NODE_ENV === "development";
const dbUrl =
  isDesktop || isDevelopment
    ? process.env.DATABASE_URL_LOCAL || process.env.DATABASE_URL
    : process.env.DATABASE_URL;

if (!dbUrl) {
  console.error("❌ DATABASE_URL or DATABASE_URL_LOCAL not set in .env");
  process.exit(1);
}

const pool = new Pool({ connectionString: dbUrl });

async function deleteUserTester() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const res = await client.query(
      "SELECT id, username, name FROM users WHERE username = $1",
      ["Tester"]
    );

    if (res.rows.length === 0) {
      console.log("No user with username 'Tester' found.");
      await client.query("ROLLBACK");
      return;
    }

    const user = res.rows[0];
    const id = user.id;
    console.log(`Found user: id=${id}, username=${user.username}, name=${user.name}`);

    const safeDelete = async (table, condition) => {
      try {
        await client.query("SAVEPOINT delete_op");
        await client.query(`DELETE FROM ${table} WHERE ${condition}`, [id]);
        await client.query("RELEASE SAVEPOINT delete_op");
      } catch (e) {
        await client.query("ROLLBACK TO SAVEPOINT delete_op").catch(() => {});
        if (e.code !== "42P01") console.warn(`  Warning deleting from ${table}:`, e.message);
      }
    };

    console.log("Deleting related records...");
    await safeDelete("teacher_discipline_cases", "teacher_id = $1 OR created_by = $1");
    await safeDelete("teacher_assignments", "teacher_id = $1");
    await safeDelete("salaries", "user_id = $1");
    await safeDelete("lesson_plans", "user_id = $1 OR reviewed_by = $1");
    await safeDelete("lessons", "user_id = $1 OR reviewed_by = $1");
    await safeDelete("hod_teachers", "teacher_id = $1");
    await safeDelete("hods", "hod_user_id = $1");
    await safeDelete("events", "created_by = $1");
    await safeDelete("discipline_cases", "recorded_by = $1 OR resolved_by = $1");
    await safeDelete("counselling_cases", "assigned_to = $1 OR created_by = $1");
    await safeDelete("counselling_sessions", "created_by = $1");
    await safeDelete("attendance_sessions", "taken_by = $1");
    await safeDelete("group_participants", "user_id = $1");
    await safeDelete("groups", "creator_id = $1");
    await safeDelete("messages", "sender_id = $1 OR receiver_id = $1");
    await safeDelete("user_activities", "user_id = $1");
    await safeDelete("user_sessions", "user_id = $1");
    await safeDelete("change_logs", "changed_by = $1");

    await client.query("DELETE FROM users WHERE id = $1", [id]);
    await client.query("COMMIT");

    console.log("✅ User 'Tester' deleted successfully.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error:", error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

deleteUserTester();
