const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const fs = require("fs");
const db = require("../db");
(async () => {
 await db.query(fs.readFileSync(path.join(__dirname, "../migrations/003_user_id_sequence.sql"), "utf8"));
 const [rows] = await db.execute("SELECT COALESCE(MAX(id), 0) AS last_id FROM users");
 await db.execute("INSERT IGNORE INTO user_id_sequences (sequence_name, `last_value`) VALUES ('users', ?)", [rows[0].last_id]);
 // Never reset a sequence that already exists. Allocation also checks existing user_id values.
 console.log("Automatic User IDs ready. Existing account IDs preserved.");
})().catch(error => {
 console.error("User ID migration failed:", error.code || error.message);
 process.exitCode = 1;
}).finally(() => db.end());
