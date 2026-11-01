const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const fs = require("fs");
const db = require("../db");
(async () => {
 const sql = fs.readFileSync(path.join(__dirname, "../migrations/002_employee_profiles.sql"), "utf8");
 await db.query(sql);
 console.log("Employee profile table ready. Existing accounts preserved.");
})().catch(error => {
 console.error("Profile migration failed:", error.code || error.message);
 process.exitCode = 1;
}).finally(() => db.end());
