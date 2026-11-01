const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const db = require("./db");
const { authenticate, ready, allow } = require("./middleware/auth");
const { ROLES } = require("./lib/policy");
const app = express();
app.disable("x-powered-by");
const origins = (process.env.FRONTEND_ORIGIN || "http://localhost:5173").split(",").map(x => x.trim());
app.use(cors({ origin: (origin, cb) => cb(null, !origin || origins.includes(origin)) }));
app.use((req, res, next) => {
    res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" }); next();
});
app.use(express.json({ limit: "16kb" }));
app.get("/", (req, res) => res.json({ message: "SITMACS backend is running", status: "OK" }));
app.get("/api/health", (req, res) => res.json({ status: "healthy" }));
app.use("/api/auth", require("./routes/auth"));
app.use("/api/users", require("./routes/users"));
app.use("/api/devices", require("./routes/devices"));
app.use("/api/files", require("./routes/files"));
app.use("/api/software", require("./routes/software"));
app.use("/api/profile", require("./routes/profile"));
app.get("/api/db-test", authenticate, ready, allow("Administrator"), async (req, res) => {
    const [rows] = await db.query("SELECT DATABASE() AS databaseName");
    res.json({ status: "connected", database: rows[0].databaseName });
});
app.get("/api/dashboard", authenticate, ready, allow(...ROLES), (req, res) => {
    res.json({ role: req.user.role_name, message: "Authorised dashboard access. Dashboard metrics are not implemented." });
});
app.get(
    "/api/audit-logs",
    authenticate,
    ready,
    allow("Administrator", "IT Security Officer"),
    async (req, res) => {
        const category = req.query.category ?? "all";

        const filters = {
            all: "1 = 1",
            security: `(
                a.action LIKE 'LOGIN!_%' ESCAPE '!'
                OR a.action = 'LOGOUT'
                OR a.action LIKE 'PASSWORD!_%' ESCAPE '!'
                OR a.action LIKE 'ACCOUNT!_LOCK%' ESCAPE '!'
            )`,
            users: `(
                a.action LIKE 'ACCOUNT!_%' ESCAPE '!'
                AND a.action NOT LIKE 'ACCOUNT!_LOCK%' ESCAPE '!'
            )`,
            files: "a.action LIKE 'FILE!_%' ESCAPE '!'",
            software: "a.action LIKE 'SOFTWARE!_%' ESCAPE '!'",
            profile: "a.action LIKE 'PROFILE!_%' ESCAPE '!'",
        };

        if (
            typeof category !== "string" ||
            !Object.prototype.hasOwnProperty.call(filters, category)
        ) {
            return res.status(400).json({
                message: "Invalid audit category",
            });
        }

        const [logs] = await db.execute(`
            SELECT
                a.id,
                a.actor_id,
                a.action,
                a.target_id,
                a.details,
                a.created_at,
                actor.user_id AS actor_user_id,
                actor.full_name AS actor_name,
                target.user_id AS target_user_id,
                target.full_name AS target_name
            FROM audit_logs a
            LEFT JOIN users actor ON actor.id = a.actor_id
            LEFT JOIN users target ON target.id = a.target_id
            WHERE ${filters[category]}
            ORDER BY a.id DESC
            LIMIT 100
        `);

        res.set("Cache-Control", "no-store").json({ logs });
    }
);
app.get(
    "/api/dashboard/admin-summary",
    authenticate,
    ready,
    allow("Administrator"),
    async (req, res) => {
        const [rows] = await db.execute(`
      SELECT
        (SELECT COUNT(*) FROM users) AS total_users,

        (SELECT COUNT(*) FROM users
         WHERE account_status = 'pending') AS pending_accounts,

        (SELECT COUNT(*) FROM devices) AS total_devices,

        (SELECT COUNT(*) FROM file_requests
         WHERE status = 'pending') AS pending_file_requests
    `);

        const summary = Object.fromEntries(
            Object.entries(rows[0]).map(([key, value]) => [
                key,
                Number(value),
            ])
        );

        res.json({ summary });
    }
);
app.use((req, res) => res.status(404).json({ message: "Endpoint not found" }));
app.use((err, req, res, next) => {
    if (err.type === "entity.parse.failed") return res.status(400).json({ message: "Invalid JSON" });
    if (err.type === "entity.too.large") return res.status(413).json({ message: "Request too large" });
    console.error("Request failed:", err.code || err.name);
    res.status(500).json({ message: "Unable to process request" });
});
if (require.main === module) {
    const server = app.listen(process.env.PORT || 5000, "127.0.0.1", () => console.log("SITMACS backend running on local port", process.env.PORT || 5000));
    const stop = () => server.close(() => db.end().finally(() => process.exit(0)));
    process.on("SIGINT", stop); process.on("SIGTERM", stop);
}
module.exports = app;
