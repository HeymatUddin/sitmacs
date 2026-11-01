const router = require("express").Router();
const db = require("../db");
const { audit } = require("../lib/security");
const { authenticate, ready, allow } = require("../middleware/auth");
const { ROLES } = require("../lib/policy");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const {
    submitFileForScan,
    getScanAnalysis,
    classifyAnalysis,
} = require("../lib/scan-file");
const storageDirectory = path.join(__dirname, "..", "storage");
fs.mkdirSync(storageDirectory, { recursive: true });

const upload = multer({
    storage: multer.diskStorage({
        destination: storageDirectory,
        filename: (req, file, callback) => {
            callback(null, crypto.randomUUID());
        },
    }),
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 1,
        fields: 0,
        parts: 1,
    },
});
router.use(authenticate, ready, allow(...ROLES));

router.get("/uploads", async (req, res) => {
    const isAdmin = req.user.role_name === "Administrator";

    const [files] = await db.execute(
        `SELECT f.id, f.original_name, f.size_bytes,
                f.approval_status, f.scan_status, f.created_at,
                f.scan_engine, f.scanned_at,
                (f.scan_analysis_id IS NOT NULL) AS scan_submitted,
                u.user_id AS uploader_user_id,
                u.full_name AS uploader_name
         FROM files f
         JOIN users u ON u.id = f.uploaded_by
         ${isAdmin ? "" : "WHERE f.uploaded_by = ?"}
         ORDER BY f.id DESC
         LIMIT 500`,
        isAdmin ? [] : [req.user.id]
    );

    res.json({ files });
});
router.post("/", upload.single("file"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({
            message: "Select a file to upload",
        });
    }

    let connection;
    let committed = false;

    try {
        const originalName = req.file.originalname;

        if (
            !originalName.trim() ||
            originalName.length > 255 ||
            /[\u0000-\u001f\u007f]/.test(originalName) ||
            req.file.size === 0
        ) {
            return res.status(400).json({
                message: "File must have a valid name and cannot be empty",
            });
        }

        const contents = await fs.promises.readFile(req.file.path);
        const fingerprint = crypto
            .createHash("sha256")
            .update(contents)
            .digest("hex");

        connection = await db.getConnection();
        await connection.beginTransaction();

        const [result] = await connection.execute(
            `INSERT INTO files
               (uploaded_by, original_name, storage_name,
                mime_type, size_bytes, sha256)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                req.user.id,
                originalName,
                req.file.filename,
                "application/octet-stream",
                req.file.size,
                fingerprint,
            ]
        );

        await audit(
            connection,
            req.user.id,
            "FILE_UPLOADED",
            null,
            { file_id: result.insertId }
        );

        await connection.commit();
        committed = true;

        res.status(201).json({
            message: "File uploaded. Review and malware scanning are pending.",
            file_id: result.insertId,
            approval_status: "pending",
            scan_status: "pending",
        });
    } catch (error) {
        if (connection) {
            await connection.rollback();
        }

        throw error;
    } finally {
        if (connection) {
            connection.release();
        }

        if (!committed) {
            await fs.promises.unlink(req.file.path).catch(error => {
                if (error.code !== "ENOENT") {
                    console.error("Upload cleanup failed:", error.code);
                }
            });
        }
    }
});
router.get("/requests", async (req, res) => {
    const isAdmin = req.user.role_name === "Administrator";

    const [requests] = await db.execute(
        `SELECT r.id, r.request_details, r.reason,
                r.status, r.review_note,
                r.created_at, r.reviewed_at,
                u.user_id AS requester_user_id,
                u.full_name AS requester_name,
                f.original_name AS fulfilled_file_name,
                f.id AS fulfilled_file_id,
                (r.status = 'approved'
                 AND f.approval_status = 'approved'
                 AND f.scan_status = 'clean'
                 AND EXISTS (
                     SELECT 1 FROM file_access a
                     WHERE a.file_id = f.id AND a.user_id = r.requested_by
                 )) AS can_download
         FROM file_requests r
         JOIN users u ON u.id = r.requested_by
         LEFT JOIN files f ON f.id = r.fulfilled_file_id
         ${isAdmin ? "" : "WHERE r.requested_by = ?"}
         ORDER BY r.id DESC
         LIMIT 500`,
        isAdmin ? [] : [req.user.id]
    );

    res.json({ requests });
});
router.post("/requests", allow("Employee", "IT Support", "IT Security Officer"), async (req, res) => {
    const { request_details, reason } = req.body || {};

    const validText = value =>
        typeof value === "string" &&
        value.trim().length > 0 &&
        value.trim().length <= 1000 &&
        !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);

    if (!validText(request_details) || !validText(reason)) {
        return res.status(400).json({
            message: "Enter the required file/data and reason, each within 1000 characters",
        });
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [result] = await connection.execute(
            `INSERT INTO file_requests
               (requested_by, request_details, reason)
             VALUES (?, ?, ?)`,
            [
                req.user.id,
                request_details.trim(),
                reason.trim(),
            ]
        );

        await audit(
            connection,
            req.user.id,
            "FILE_REQUEST_CREATED",
            null,
            { request_id: result.insertId }
        );

        await connection.commit();

        res.status(201).json({
            message: "File/data request submitted",
            request_id: result.insertId,
            status: "pending",
        });
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
});
router.post(
    "/requests/:requestId/reject",
    allow("Administrator"),
    async (req, res) => {
        const requestId = Number(req.params.requestId);
        const note = req.body?.review_note;

        if (
            !Number.isSafeInteger(requestId) ||
            requestId < 1 ||
            typeof note !== "string" ||
            !note.trim() ||
            note.trim().length > 1000 ||
            /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(note)
        ) {
            return res.status(400).json({
                message: "Valid request ID and rejection reason are required",
            });
        }

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const [result] = await connection.execute(
                `UPDATE file_requests
                 SET status = 'rejected',
                     reviewed_by = ?,
                     review_note = ?,
                     reviewed_at = CURRENT_TIMESTAMP
                 WHERE id = ? AND status = 'pending'`,
                [req.user.id, note.trim(), requestId]
            );

            if (result.affectedRows !== 1) {
                await connection.rollback();

                return res.status(409).json({
                    message: "Request unavailable or already reviewed. Refresh the list.",
                });
            }

            await audit(
                connection,
                req.user.id,
                "FILE_REQUEST_REJECTED",
                null,
                { request_id: requestId, reason: note.trim() }
            );

            await connection.commit();

            res.json({ message: "File/data request rejected" });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
);
router.get(
    "/available-for-approval",
    allow("Administrator"),
    async (req, res) => {
        const [files] = await db.execute(
            `SELECT id, original_name, size_bytes, created_at
             FROM files
             WHERE approval_status = 'approved'
               AND scan_status = 'clean'
             ORDER BY id DESC
             LIMIT 500`
        );

        res.json({ files });
    }
);
router.post(
    "/requests/:requestId/approve",
    allow("Administrator"),
    async (req, res) => {
        const requestId = Number(req.params.requestId);
        const fileId = req.body?.file_id;
        const note = req.body?.review_note;

        if (
            !Number.isSafeInteger(requestId) ||
            requestId < 1 ||
            !Number.isSafeInteger(fileId) ||
            fileId < 1 ||
            typeof note !== "string" ||
            !note.trim() ||
            note.trim().length > 1000 ||
            /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(note)
        ) {
            return res.status(400).json({
                message: "Select a file and enter an approval note",
            });
        }

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const [requests] = await connection.execute(
                `SELECT id, requested_by, status
                 FROM file_requests
                 WHERE id = ?
                 FOR UPDATE`,
                [requestId]
            );

            const request = requests[0];

            if (!request || request.status !== "pending") {
                await connection.rollback();

                return res.status(409).json({
                    message: "Request unavailable or already reviewed. Refresh the list.",
                });
            }

            const [users] = await connection.execute(
                `SELECT id FROM users
                 WHERE id = ? AND account_status = 'active'
                 FOR UPDATE`,
                [request.requested_by]
            );

            if (!users.length) {
                await connection.rollback();

                return res.status(409).json({
                    message: "Requester account is not active",
                });
            }

            const [files] = await connection.execute(
                `SELECT id FROM files
                 WHERE id = ?
                   AND approval_status = 'approved'
                   AND scan_status = 'clean'
                 FOR UPDATE`,
                [fileId]
            );

            if (!files.length) {
                await connection.rollback();

                return res.status(409).json({
                    message: "File must be approved and pass malware scanning",
                });
            }

            await connection.execute(
                `INSERT INTO file_access
                   (file_id, user_id, granted_by)
                 SELECT ?, ?, ?
                 WHERE NOT EXISTS (
                     SELECT 1 FROM file_access
                     WHERE file_id = ? AND user_id = ?
                 )`,
                [
                    fileId,
                    request.requested_by,
                    req.user.id,
                    fileId,
                    request.requested_by,
                ]
            );

            await connection.execute(
                `UPDATE file_requests
                 SET status = 'approved',
                     fulfilled_file_id = ?,
                     reviewed_by = ?,
                     review_note = ?,
                     reviewed_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [fileId, req.user.id, note.trim(), requestId]
            );

            await audit(
                connection,
                req.user.id,
                "FILE_REQUEST_APPROVED",
                request.requested_by,
                {
                    request_id: requestId,
                    file_id: fileId,
                    reason: note.trim(),
                }
            );

            await connection.commit();

            res.json({
                message: "Request approved and file access granted",
            });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
);
router.get("/approved", async (req, res) => {
    const isAdmin = req.user.role_name === "Administrator";

    const [files] = await db.execute(
        `SELECT f.id, f.original_name,
                f.size_bytes, f.created_at
         FROM files f
         WHERE f.approval_status = 'approved'
           AND f.scan_status = 'clean'
           ${isAdmin ? "" : `AND EXISTS (
               SELECT 1
               FROM file_access a
               WHERE a.file_id = f.id
                 AND a.user_id = ?
           )`}
         ORDER BY f.id DESC
         LIMIT 500`,
        isAdmin ? [] : [req.user.id]
    );

    res.json({ files });
});
router.post(
    "/:fileId/scan",
    allow("Administrator"),
    async (req, res) => {
        const fileId = Number(req.params.fileId);

        if (!Number.isSafeInteger(fileId) || fileId < 1) {
            return res.status(400).json({
                message: "Valid file ID is required",
            });
        }

        if (req.body?.confirm_public_submission !== true) {
            return res.status(400).json({
                message: "Confirm this is a non-confidential test file that may be shared with VirusTotal.",
            });
        }

        if (!process.env.VIRUSTOTAL_API_KEY?.trim()) {
            return res.status(503).json({
                message: "VirusTotal is not configured",
            });
        }

        const connection = await db.getConnection();
        let file;

        try {
            await connection.beginTransaction();

            const [files] = await connection.execute(
                `SELECT id, storage_name, sha256,
                        scan_engine, scan_analysis_id, scan_status
                 FROM files
                 WHERE id = ?
                 FOR UPDATE`,
                [fileId]
            );

            file = files[0];

            if (!file) {
                await connection.rollback();
                return res.status(404).json({
                    message: "File not found",
                });
            }

            if (file.scan_engine || file.scan_status !== "pending") {
                await connection.rollback();
                return res.status(409).json({
                    message: "Scan already attempted. Refresh the list; do not submit again.",
                });
            }

            if (
                typeof file.storage_name !== "string" ||
                !/^[0-9a-f-]{36}$/i.test(file.storage_name)
            ) {
                throw new Error("Invalid stored file name");
            }

            const contents = await fs.promises.readFile(
                path.join(storageDirectory, file.storage_name)
            );

            const fingerprint = crypto
                .createHash("sha256")
                .update(contents)
                .digest("hex");

            if (fingerprint !== file.sha256) {
                throw new Error("Stored file integrity check failed");
            }

            await connection.execute(
                `UPDATE files
                 SET scan_engine = 'VirusTotal'
                 WHERE id = ?`,
                [fileId]
            );

            await audit(
                connection,
                req.user.id,
                "FILE_SCAN_SUBMISSION_STARTED",
                null,
                {
                    file_id: fileId,
                    public_submission_confirmed: true,
                }
            );

            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }

        let submission;

        try {
            submission = await submitFileForScan(
                path.join(storageDirectory, file.storage_name)
            );
        } catch (error) {
            await db.execute(
                `UPDATE files
                 SET scan_status = 'error'
                 WHERE id = ? AND scan_analysis_id IS NULL`,
                [fileId]
            );

            console.error(
                "Scan submission failed:",
                error.code || error.name
            );

            return res.status(502).json({
                message: "Scan submission could not be confirmed. File remains blocked; do not automatically resubmit.",
            });
        }

        await db.execute(
            `UPDATE files
             SET scan_analysis_id = ?,
                 scan_status = 'pending'
             WHERE id = ?`,
            [submission.analysisId, fileId]
        );

        res.status(202).json({
            message: "File submitted to VirusTotal. Analysis is pending.",
            scan_status: "pending",
        });
    }
);
router.post(
    "/:fileId/scan-result",
    allow("Administrator"),
    async (req, res) => {
        const fileId = Number(req.params.fileId);

        if (!Number.isSafeInteger(fileId) || fileId < 1) {
            return res.status(400).json({
                message: "Valid file ID is required",
            });
        }

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const [files] = await connection.execute(
                `SELECT id, storage_name, sha256,
                        scan_engine, scan_analysis_id, scan_status
                 FROM files
                 WHERE id = ?
                 FOR UPDATE`,
                [fileId]
            );

            const file = files[0];

            if (!file) {
                await connection.rollback();
                return res.status(404).json({
                    message: "File not found",
                });
            }

            if (
                file.scan_engine !== "VirusTotal" ||
                !file.scan_analysis_id
            ) {
                await connection.rollback();
                return res.status(409).json({
                    message: "No confirmed VirusTotal submission exists",
                });
            }

            if (!["pending", "error"].includes(file.scan_status)) {
                await connection.rollback();
                return res.json({
                    message: `Stored scan status: ${file.scan_status}`,
                    scan_status: file.scan_status,
                });
            }

            const analysis = await getScanAnalysis(
                file.scan_analysis_id
            );

            let status = classifyAnalysis(analysis);

            if (status === "pending") {
                await connection.rollback();
                return res.status(202).json({
                    message: "Analysis is still pending. Check again later.",
                    scan_status: "pending",
                });
            }

            if (
                typeof file.storage_name !== "string" ||
                !/^[0-9a-f-]{36}$/i.test(file.storage_name)
            ) {
                throw new Error("Invalid stored file name");
            }

            try {
                const contents = await fs.promises.readFile(
                    path.join(storageDirectory, file.storage_name)
                );

                const fingerprint = crypto
                    .createHash("sha256")
                    .update(contents)
                    .digest("hex");

                if (fingerprint !== file.sha256) {
                    status = "error";
                }
            } catch {
                status = "error";
            }

            await connection.execute(
                `UPDATE files
                 SET scan_status = ?,
                     scanned_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [status, fileId]
            );

            await audit(
                connection,
                req.user.id,
                "FILE_SCAN_RESULT",
                null,
                {
                    file_id: fileId,
                    engine: "VirusTotal",
                    scan_status: status,
                    stats: analysis.stats || null,
                }
            );

            await connection.commit();

            res.json({
                message:
                    status === "clean"
                        ? "Scan completed with no detections. Administrator approval is still required."
                        : "Scan did not pass. File remains blocked.",
                scan_status: status,
            });
        } catch (error) {
            await connection.rollback();

            console.error(
                "Scan result failed:",
                error.code || error.name,
                error.message
            );

            throw error;
        } finally {
            connection.release();
        }
    }
);
router.post(
    "/:fileId/decision",
    allow("Administrator"),
    async (req, res) => {
        const fileId = Number(req.params.fileId);
        const { decision, review_note: note } = req.body || {};

        if (
            !Number.isSafeInteger(fileId) ||
            fileId < 1 ||
            !["approve", "reject"].includes(decision) ||
            typeof note !== "string" ||
            !note.trim() ||
            note.trim().length > 1000 ||
            /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(note)
        ) {
            return res.status(400).json({
                message: "Valid file, decision and review note are required",
            });
        }

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const [files] = await connection.execute(
                `SELECT id, approval_status, scan_status
                 FROM files
                 WHERE id = ?
                 FOR UPDATE`,
                [fileId]
            );

            const file = files[0];

            if (!file) {
                await connection.rollback();
                return res.status(404).json({
                    message: "File not found",
                });
            }

            if (file.approval_status !== "pending") {
                await connection.rollback();
                return res.status(409).json({
                    message: "File already reviewed. Refresh the list.",
                });
            }

            if (decision === "approve" && file.scan_status !== "clean") {
                await connection.rollback();
                return res.status(409).json({
                    message: "File must pass malware scanning before approval",
                });
            }

            const status =
                decision === "approve" ? "approved" : "rejected";

            await connection.execute(
                `UPDATE files
                 SET approval_status = ?,
                     reviewed_by = ?,
                     review_note = ?,
                     reviewed_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [status, req.user.id, note.trim(), fileId]
            );

            await audit(
                connection,
                req.user.id,
                decision === "approve" ? "FILE_APPROVED" : "FILE_REJECTED",
                null,
                { file_id: fileId, reason: note.trim() }
            );

            await connection.commit();

            res.json({
                message: `File ${status}`,
            });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
);
router.get("/:fileId/download", async (req, res) => {
    const fileId = Number(req.params.fileId);

    if (!Number.isSafeInteger(fileId) || fileId < 1) {
        return res.status(400).json({
            message: "Valid file ID is required",
        });
    }

    const isAdmin = req.user.role_name === "Administrator";

    const [files] = await db.execute(
        `SELECT f.id, f.original_name, f.storage_name,
                f.size_bytes, f.sha256
         FROM files f
         WHERE f.id = ?
           AND f.approval_status = 'approved'
           AND f.scan_status = 'clean'
           ${isAdmin ? "" : `AND EXISTS (
               SELECT 1 FROM file_access a
               WHERE a.file_id = f.id AND a.user_id = ?
           )`}`,
        isAdmin ? [fileId] : [fileId, req.user.id]
    );

    const file = files[0];

    if (!file) {
        return res.status(404).json({
            message: "File unavailable or access not granted",
        });
    }

    if (
        typeof file.storage_name !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(file.storage_name)
    ) {
        throw new Error("Invalid stored file name");
    }

    let contents;

    try {
        contents = await fs.promises.readFile(
            path.join(storageDirectory, file.storage_name)
        );
    } catch (error) {
        if (error.code === "ENOENT") {
            return res.status(404).json({
                message: "Stored file is unavailable",
            });
        }

        throw error;
    }

    const fingerprint = crypto
        .createHash("sha256")
        .update(contents)
        .digest("hex");

    if (
        contents.length !== file.size_bytes ||
        fingerprint !== file.sha256
    ) {
        return res.status(409).json({
            message: "File integrity check failed. Download blocked.",
        });
    }

    await audit(
        db,
        req.user.id,
        "FILE_DOWNLOAD_AUTHORIZED",
        null,
        { file_id: fileId }
    );

    res.attachment(file.original_name);
    res.type("application/octet-stream");
    res.send(contents);
});
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        return res.status(
            error.code === "LIMIT_FILE_SIZE" ? 413 : 400
        ).json({
            message:
                error.code === "LIMIT_FILE_SIZE"
                    ? "File must not exceed 5 MB"
                    : "Upload exactly one file using the file field",
        });
    }

    next(error);
});
module.exports = router;