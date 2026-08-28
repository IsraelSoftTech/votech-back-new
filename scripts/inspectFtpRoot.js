"use strict";
// Read-only FTP root inspection — figure out what directory structure
// actually exists on the remote server so FTP_UPLOAD_DIR can be set
// correctly instead of guessed. Lists root, and one level into any
// directory that looks relevant. No writes, no deletes.
require("dotenv").config();
const Client = require("ftp");

const client = new Client();

function list(dir) {
  return new Promise((resolve, reject) => {
    client.list(dir, (err, entries) => {
      if (err) return reject(err);
      resolve(entries);
    });
  });
}

client.on("ready", async () => {
  try {
    console.log(`Connected as ${process.env.FTP_USER}`);
    const root = await list("/");
    console.log("\n=== / ===");
    for (const e of root) {
      console.log(`${e.type === "d" ? "DIR " : "file"}  ${e.name}`);
    }

    for (const e of root) {
      if (e.type === "d" && !e.name.startsWith(".")) {
        try {
          const sub = await list(`/${e.name}`);
          console.log(`\n=== /${e.name} ===`);
          for (const s of sub) {
            console.log(`${s.type === "d" ? "DIR " : "file"}  ${s.name}`);
          }
        } catch (subErr) {
          console.log(`\n=== /${e.name} === (list failed: ${subErr.message})`);
        }
      }
    }
  } catch (err) {
    console.error("LIST_FAILED", err.message);
  } finally {
    client.end();
  }
});

client.on("error", (err) => {
  console.error("FTP_ERROR", err.message);
  process.exit(1);
});

client.connect({
  host: process.env.FTP_HOST,
  port: Number(process.env.FTP_PORT) || 21,
  user: process.env.FTP_USER,
  password: process.env.FTP_PASS,
  connTimeout: 15000,
  pasvTimeout: 15000,
});
