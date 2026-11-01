const router = require("express").Router();
const db = require("../db");
const { authenticate, ready, allow } = require("../middleware/auth");
const { audit } = require("../lib/security");

router.use(authenticate, ready);

router.get(
  "/",
  allow("Administrator", "Employee", "IT Support", "IT Security Officer"),
  async (req, res) => {
    const isAdmin = req.user.role_name === "Administrator";

    const [requests] = await db.execute(
      `SELECT
         s.id, s.software_name, s.software_version,
         s.reason, s.status, s.review_note,
         s.created_at, s.reviewed_at,
         u.user_id AS requester_user_id,
         u.full_name AS requester_name,
         reviewer.user_id AS reviewer_user_id
       FROM software_requests s
       JOIN users u ON u.id = s.requested_by
       LEFT JOIN users reviewer ON reviewer.id = s.reviewed_by
       ${isAdmin ? "" : "WHERE s.requested_by = ?"}
       ORDER BY s.id DESC
       LIMIT 500`,
      isAdmin ? [] : [req.user.id]
    );

    res.json({ requests });
  }
);

router.post(
  "/",
  allow("Employee", "IT Support", "IT Security Officer"),
  async (req, res) => {
    const {
      software_name,
      software_version = "",
      reason,
    } = req.body || {};

    const validText = (value, max, required = true) =>
      typeof value === "string" &&
      (!required || value.trim().length > 0) &&
      value.length <= max &&
      !/[\u0000-\u001f\u007f]/.test(value);

    if (
      !validText(software_name, 150) ||
      !validText(software_version, 100, false) ||
      !validText(reason, 1000)
    ) {
      return res.status(400).json({
        message: "Valid software name, optional version and reason are required",
      });
    }

    const c = await db.getConnection();

    try {
      await c.beginTransaction();

      const [result] = await c.execute(
        `INSERT INTO software_requests
           (requested_by, software_name, software_version, reason)
         VALUES (?, ?, ?, ?)`,
        [
          req.user.id,
          software_name.trim(),
          software_version.trim() || null,
          reason.trim(),
        ]
      );

      await audit(
        c,
        req.user.id,
        "SOFTWARE_REQUEST_CREATED",
        req.user.id,
        {
          request_id: result.insertId,
          software_name: software_name.trim(),
        }
      );

      await c.commit();

      res.status(201).json({
        message: "Software request submitted for Administrator approval",
        request_id: result.insertId,
      });
    } catch (error) {
      await c.rollback();
      throw error;
    } finally {
      c.release();
    }
  }
);
router.post(
  "/:id/decision",
  allow("Administrator"),
  async (req, res) => {
    const id = Number(req.params.id);
    const { decision, review_note } = req.body || {};

    if (
      !/^[1-9]\d*$/.test(req.params.id) ||
      !Number.isSafeInteger(id) ||
      !["approve", "reject"].includes(decision) ||
      typeof review_note !== "string" ||
      !review_note.trim() ||
      review_note.length > 1000 ||
      /[\u0000-\u001f\u007f]/.test(review_note)
    ) {
      return res.status(400).json({
        message: "Valid request ID, decision and review note are required",
      });
    }

    const c = await db.getConnection();

    try {
      await c.beginTransaction();

      const [rows] = await c.execute(
        `SELECT id, requested_by, status
         FROM software_requests
         WHERE id = ?
         FOR UPDATE`,
        [id]
      );

      const request = rows[0];

      if (!request) {
        await c.rollback();
        return res.status(404).json({
          message: "Software permission request not found",
        });
      }

      if (request.status !== "pending") {
        await c.rollback();
        return res.status(409).json({
          message: "This request has already been reviewed",
        });
      }

      if (decision === "approve") {
        const [users] = await c.execute(
          `SELECT account_status
           FROM users
           WHERE id = ?
           FOR UPDATE`,
          [request.requested_by]
        );

        if (users[0]?.account_status !== "active") {
          await c.rollback();
          return res.status(409).json({
            message: "Only an active user's request can be approved",
          });
        }
      }

      const status = decision === "approve" ? "approved" : "rejected";

      await c.execute(
        `UPDATE software_requests
         SET status = ?, reviewed_by = ?,
             review_note = ?, reviewed_at = NOW()
         WHERE id = ?`,
        [status, req.user.id, review_note.trim(), id]
      );

      await audit(
        c,
        req.user.id,
        decision === "approve"
          ? "SOFTWARE_PERMISSION_APPROVED"
          : "SOFTWARE_PERMISSION_REJECTED",
        request.requested_by,
        { request_id: id, review_note: review_note.trim() }
      );

      await c.commit();

      res.json({
        message: `Software installation permission ${status}`,
      });
    } catch (error) {
      await c.rollback();
      throw error;
    } finally {
      c.release();
    }
  }
);


module.exports = router;