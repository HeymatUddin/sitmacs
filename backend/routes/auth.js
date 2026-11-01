const router = require("express").Router();
const bcrypt = require("bcrypt");
const db = require("../db");
const { audit, session } = require("../lib/security");
const { publicUser, validPassword } = require("../lib/policy");
const { authenticate, ready } = require("../middleware/auth");
const limit = require("../middleware/rate-limit");
const dummyHash = bcrypt.hashSync(require("crypto").randomBytes(32).toString("hex"), 12);
router.get("/health", (req, res) => res.json({ message: "Authentication routes are working" }));
router.post("/login", limit, async (req, res) => {
  const { user_id, password } = req.body || {};
  if (typeof user_id !== "string" || !user_id.trim() || user_id.trim().length > 50 ||
    typeof password !== "string" || !password || Buffer.byteLength(password) > 72)
    return res.status(400).json({ message: "Valid User ID and password are required" });
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const [rows] = await c.execute(`SELECT u.*, r.role_name FROM users u JOIN roles r ON r.id=u.role_id
     WHERE u.user_id=? FOR UPDATE`, [user_id.trim()]);
    const u = rows[0];
    const matches = await bcrypt.compare(password, u ? u.password_hash : dummyHash);
    if (u && u.account_status === "locked" && u.locked_until) {
      const [expired] = await c.execute("SELECT locked_until <= NOW() AS expired FROM users WHERE id=?", [u.id]);
      if (expired[0].expired) {
        await c.execute("UPDATE users SET account_status='active', failed_login_attempts=0, locked_until=NULL WHERE id=?", [u.id]);
        u.account_status = "active"; u.failed_login_attempts = 0;
        await audit(c, u.id, "ACCOUNT_LOCK_EXPIRED", u.id);
      }
    }
    if (!u || u.account_status !== "active" || !matches) {
      if (u && u.account_status === "active" && !matches) {
        const attempts = u.failed_login_attempts + 1;
        await c.execute(`UPDATE users SET failed_login_attempts=?, account_status=?,
         locked_until=IF(? >= 5, DATE_ADD(NOW(), INTERVAL 15 MINUTE), NULL) WHERE id=?`,
          [attempts, attempts >= 5 ? "locked" : "active", attempts, u.id]);
        if (attempts >= 5) {
          await c.execute("DELETE FROM auth_sessions WHERE user_id=?", [u.id]);
          await audit(c, u.id, "ACCOUNT_LOCKED", u.id);
        }
      }
      await audit(c, u ? u.id : null, "LOGIN_DENIED", u ? u.id : null);
      await c.commit();
      return res.status(401).json({ message: "Invalid credentials or account unavailable" });
    }
    await c.execute("UPDATE users SET failed_login_attempts=0, locked_until=NULL WHERE id=?", [u.id]);
    const token = await session(c, u.id);
    await audit(c, u.id, "LOGIN_SUCCEEDED", u.id);
    await c.commit();
    res.set("Cache-Control", "no-store").json({
      token, token_type: "Bearer", expires_in: 3600,
      idle_timeout_seconds: 900, user: publicUser(u)
    });
  } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
});
router.get("/me", authenticate, (req, res) => res.json({ user: publicUser(req.user) }));
router.post("/logout", authenticate, async (req, res) => {
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    await c.execute("DELETE FROM auth_sessions WHERE id=?", [req.sessionId]);
    await audit(c, req.user.id, "LOGOUT", req.user.id);
    await c.commit(); res.json({ message: "Logged out" });
  } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
});
router.post("/change-password", limit, authenticate, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (typeof current_password !== "string" || Buffer.byteLength(current_password) > 72 || !validPassword(new_password))
    return res.status(400).json({ message: "New password must be at least 12 characters and at most 72 UTF-8 bytes" });
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const [rows] = await c.execute("SELECT * FROM users WHERE id=? FOR UPDATE", [req.user.id]);
    const u = rows[0];
    if (u.account_status !== "active" || !(await bcrypt.compare(current_password, u.password_hash))) {
      await audit(c, u.id, "PASSWORD_CHANGE_DENIED", u.id); await c.commit();
      return res.status(401).json({ message: "Password change denied" });
    }
    if (await bcrypt.compare(new_password, u.password_hash)) {
      await c.rollback(); return res.status(400).json({ message: "Choose a different password" });
    }
    const hash = await bcrypt.hash(new_password, 12);
    await c.execute("UPDATE users SET password_hash=?, must_change_password=0, failed_login_attempts=0 WHERE id=?", [hash, u.id]);
    await c.execute("DELETE FROM auth_sessions WHERE user_id=?", [u.id]);
    await audit(c, u.id, "PASSWORD_CHANGED", u.id); await c.commit();
    res.json({ message: "Password changed. Log in again.", login_required: true });
  } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
});
router.get("/profile", authenticate, ready, async (req, res) => {
  const [rows] = await db.execute(
    `SELECT u.id, u.user_id, u.full_name, u.email, u.phone,
            u.account_status, r.role_name AS role
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.id = ?`,
    [req.user.id]
  );

  if (!rows[0]) {
    return res.status(404).json({ message: "Profile not found" });
  }

  res.set("Cache-Control", "no-store").json({ profile: rows[0] });
});

router.post("/profile", authenticate, ready, async (req, res) => {
  const { phone = "" } = req.body || {};

  if (
    typeof phone !== "string" ||
    phone.length > 30 ||
    (phone.trim() && !/^\+?[0-9 ()-]{5,30}$/.test(phone.trim()))
  ) {
    return res.status(400).json({
      message: "Enter a valid optional phone number",
    });
  }

  const c = await db.getConnection();

  try {
    await c.beginTransaction();

    const [rows] = await c.execute(
      `SELECT id, phone, account_status
       FROM users
       WHERE id = ?
       FOR UPDATE`,
      [req.user.id]
    );

    const current = rows[0];

    if (!current || current.account_status !== "active") {
      await c.rollback();
      return res.status(403).json({ message: "Account unavailable" });
    }

    const nextPhone = phone.trim() || null;
    const changed = (current.phone || null) !== nextPhone;

    if (changed) {
      await c.execute(
        "UPDATE users SET phone = ? WHERE id = ?",
        [nextPhone, req.user.id]
      );

      await audit(
        c,
        req.user.id,
        "PROFILE_UPDATED",
        req.user.id,
        { changed_fields: ["phone"] }
      );
    }

    await c.commit();

    res.json({
      message: changed
        ? "Phone number updated successfully"
        : "No changes to save",
    });
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
});


module.exports = router;
