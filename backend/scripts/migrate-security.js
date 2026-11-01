const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const fs = require("fs");
const db = require("../db");
(async () => {
 const sql = fs.readFileSync(path.join(__dirname, "../migrations/001_security.sql"), "utf8");
 for (const statement of sql.replace(/--[^\n]*/g, "").split(";").map(x => x.trim()).filter(Boolean)) {
   if (statement.replace(/--[^\n]*/g, "").trim()) await db.query(statement);
 }
 console.log("Security tables ready. Existing users and roles preserved.");
})().catch(e => { console.error("Migration failed:", e.code || e.message); process.exitCode = 1; })
.finally(() => db.end());
