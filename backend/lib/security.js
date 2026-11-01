const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const secret = process.env.JWT_SECRET;
if (!secret || Buffer.byteLength(secret, "utf8") < 32 || secret.startsWith("replace_")) {
 throw new Error("Set a random JWT_SECRET of at least 32 bytes in backend/.env");
}
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const jwtOptions = { algorithms: ["HS256"], issuer: "sitmacs", audience: "sitmacs-api" };
async function audit(conn, actor, action, target = null, details = null) {
 await conn.execute("INSERT INTO audit_logs (actor_id, action, target_id, details) VALUES (?, ?, ?, ?)",
   [actor, action, target, details === null ? null : JSON.stringify(details)]);
}
async function session(conn, userId) {
 const jti = crypto.randomBytes(32).toString("hex");
 await conn.execute("INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))", [hash(jti), userId]);
 return jwt.sign({}, secret, { algorithm: "HS256", issuer: "sitmacs", audience: "sitmacs-api",
   subject: String(userId), jwtid: jti, expiresIn: "1h" });
}
module.exports = { audit, session, hash, verify: token => jwt.verify(token, secret, jwtOptions) };
