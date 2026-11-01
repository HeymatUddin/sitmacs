const router = require("express").Router();
const db = require("../db");
const { authenticate, allow } = require("../middleware/auth");
const { publicUser } = require("../lib/policy");
const { audit } = require("../lib/security");
const { validateProfile } = require("../lib/profile-validation");
const limit = require("../middleware/rate-limit");

// Onboarding users need this route, so ready() is deliberately not applied here.
router.use(authenticate, allow("Employee"));
router.get("/", async (req, res) => {
 const [profiles] = await db.execute(
   "SELECT contact_phone FROM employee_profiles WHERE user_id = ?", [req.user.id]
 );
 res.json({ profile: {
   user_id: req.user.user_id,
   email: req.user.email,
   full_name: req.user.full_name,
   contact_phone: profiles[0]?.contact_phone || "",
 } });
});
router.post("/", limit, async (req, res) => {
 const result = validateProfile(req.body);
 if (result.error) return res.status(400).json({ message: result.error });
 const { full_name, contact_phone } = result.value;
 const connection = await db.getConnection();
 try {
   await connection.beginTransaction();
   const [users] = await connection.execute(`SELECT u.*, r.role_name
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? FOR UPDATE`, [req.user.id]);
   const user = users[0];
   if (!user || user.account_status !== "active" || user.role_name !== "Employee") {
     await connection.rollback();
     return res.status(403).json({ message: "Profile completion is unavailable for this account." });
   }
   const [sessions] = await connection.execute(`SELECT id FROM auth_sessions
     WHERE id = ? AND user_id = ? AND expires_at > NOW()
       AND last_seen_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE) FOR UPDATE`,
     [req.sessionId, user.id]);
   if (!sessions.length) {
     await connection.rollback();
     return res.status(401).json({ message: "Login required" });
   }
   if (user.must_change_password) {
     await connection.rollback();
     return res.status(403).json({ message: "Change your temporary password before completing your profile." });
   }
   if (user.profile_completed) {
     await connection.rollback();
     return res.status(409).json({ message: "Your profile is already complete." });
   }
   await connection.execute(
     "INSERT INTO employee_profiles (user_id, contact_phone) VALUES (?, ?)",
     [user.id, contact_phone]
   );
   await connection.execute(
     "UPDATE users SET full_name = ?, profile_completed = 1 WHERE id = ?",
     [full_name, user.id]
   );
   await audit(connection, user.id, "PROFILE_COMPLETED", user.id);
   await connection.commit();
   res.json({ message: "Profile completed", user: publicUser({ ...user, full_name, profile_completed: 1 }) });
 } catch (error) {
   await connection.rollback();
   throw error;
 } finally {
   connection.release();
 }
});
module.exports = router;
