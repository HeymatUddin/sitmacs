const db = require("../db");
const { verify, hash } = require("../lib/security");
const { isReady } = require("../lib/policy");
async function authenticate(req, res, next) {
 const header = req.get("Authorization") || "";
 let claims;
 try {
   if (!header.startsWith("Bearer ")) throw new Error();
   claims = verify(header.slice(7));
   if (!claims.jti || !/^\d+$/.test(claims.sub)) throw new Error();
 } catch { return res.status(401).json({ message: "Login required" }); }
 const sessionId = hash(claims.jti);
 const [rows] = await db.execute(`SELECT u.*, r.role_name FROM auth_sessions s
   JOIN users u ON u.id = s.user_id JOIN roles r ON r.id = u.role_id
   WHERE s.id = ? AND u.id = ? AND s.expires_at > NOW()
   AND s.last_seen_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)`, [sessionId, claims.sub]);
 const user = rows[0];
 if (!user || user.account_status !== "active") return res.status(401).json({ message: "Session expired or account unavailable" });
 await db.execute("UPDATE auth_sessions SET last_seen_at = NOW() WHERE id = ?", [sessionId]);
 req.user = user; req.sessionId = sessionId;
 next();
}
function ready(req, res, next) {
 if (!isReady(req.user)) return res.status(403).json({ message: "Complete first-login requirements", code: "ONBOARDING_REQUIRED" });
 next();
}
const allow = (...roles) => (req, res, next) => {
 if (!roles.includes(req.user.role_name)) return res.status(403).json({ message: "Permission denied" });
 next();
};
module.exports = { authenticate, ready, allow };
