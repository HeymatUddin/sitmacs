const router = require("express").Router();
const db = require("../db");
const { audit } = require("../lib/security");
const {
    authenticate,
    ready,
    allow,
} = require("../middleware/auth");

// সব device API-তে login ও first-login completion লাগবে।
router.use(authenticate, ready);
router.get(
    "/",
    allow("Administrator", "IT Support"),
    async (req, res) => {
        const [devices] = await db.execute(
            `SELECT d.id, d.device_name, d.serial_number,
                    d.device_type, d.device_status,
                    d.created_at, d.updated_at,
                    a.id AS assignment_id,
                    a.assigned_at,
                    u.user_id AS assigned_user_id,
                    u.full_name AS assigned_full_name
            FROM devices d
            LEFT JOIN device_assignments a
                ON a.device_id = d.id
                AND a.returned_at IS NULL
            LEFT JOIN users u
                ON u.id = a.user_id
            ORDER BY d.id DESC
            LIMIT 500`
        );

        res.json({ devices });
    }
);
router.post("/", allow("IT Support"), async (req, res) => {
    const { device_name, serial_number, device_type } = req.body || {};

    const fields = [
        [device_name, 100],
        [serial_number, 100],
        [device_type, 50],
    ];

    if (
        fields.some(
            ([value, max]) =>
                typeof value !== "string" ||
                !value.trim() ||
                value.trim().length > max ||
                /[\u0000-\u001f\u007f]/.test(value)
        )
    ) {
        return res.status(400).json({
            message: "Valid device name, serial number and type are required",
        });
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [result] = await connection.execute(
            `INSERT INTO devices
         (device_name, serial_number, device_type, device_status)
       VALUES (?, ?, ?, 'available')`,
            [
                device_name.trim(),
                serial_number.trim(),
                device_type.trim(),
            ]
        );

        await audit(
            connection,
            req.user.id,
            "DEVICE_REGISTERED",
            null,
            { device_id: result.insertId }
        );

        await connection.commit();

        res.status(201).json({
            message: "Device registered",
            device_id: result.insertId,
        });
    } catch (error) {
        await connection.rollback();

        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                message: "A device with this serial number already exists",
            });
        }

        throw error;
    } finally {
        connection.release();
    }
});
router.get(
    "/employees",
    allow("IT Support"),
    async (req, res) => {
        const [employees] = await db.execute(
            `SELECT u.id, u.user_id, u.full_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE r.role_name = ?
         AND u.account_status = ?
       ORDER BY u.full_name, u.id`,
            ["Employee", "active"]
        );

        res.json({ employees });
    }
);
router.post(
    "/:deviceId/assign",
    allow("IT Support"),
    async (req, res) => {
        const deviceId = Number(req.params.deviceId);
        const employeeId = req.body?.employee_id;

        if (
            !Number.isSafeInteger(deviceId) ||
            deviceId < 1 ||
            !Number.isSafeInteger(employeeId) ||
            employeeId < 1
        ) {
            return res.status(400).json({
                message: "Valid device and employee IDs are required",
            });
        }

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const [devices] = await connection.execute(
                `SELECT id, device_status
         FROM devices
         WHERE id = ?
         FOR UPDATE`,
                [deviceId]
            );

            if (!devices.length) {
                await connection.rollback();
                return res.status(404).json({
                    message: "Device not found",
                });
            }

            if (devices[0].device_status !== "available") {
                await connection.rollback();
                return res.status(409).json({
                    message: "Device is not available for assignment",
                });
            }

            const [employees] = await connection.execute(
                `SELECT u.id
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE u.id = ?
           AND r.role_name = ?
           AND u.account_status = ?
         FOR UPDATE`,
                [employeeId, "Employee", "active"]
            );

            if (!employees.length) {
                await connection.rollback();
                return res.status(400).json({
                    message: "Select an active Employee account",
                });
            }

            const [result] = await connection.execute(
                `INSERT INTO device_assignments
           (device_id, user_id, assigned_by)
         VALUES (?, ?, ?)`,
                [deviceId, employeeId, req.user.id]
            );

            await connection.execute(
                `UPDATE devices
         SET device_status = 'assigned'
         WHERE id = ?`,
                [deviceId]
            );

            await audit(
                connection,
                req.user.id,
                "DEVICE_ASSIGNED",
                employeeId,
                {
                    device_id: deviceId,
                    assignment_id: result.insertId,
                }
            );

            await connection.commit();

            res.status(201).json({
                message: "Device assigned",
                assignment_id: result.insertId,
            });
        } catch (error) {
            await connection.rollback();

            if (error.code === "ER_DUP_ENTRY") {
                return res.status(409).json({
                    message: "Device already has an active assignment",
                });
            }

            throw error;
        } finally {
            connection.release();
        }
    }
);
router.post(
    "/:deviceId/return",
    allow("IT Support"),
    async (req, res) => {
        const deviceId = Number(req.params.deviceId);
        const assignmentId = req.body?.assignment_id;

        if (
            !Number.isSafeInteger(deviceId) ||
            deviceId < 1 ||
            !Number.isSafeInteger(assignmentId) ||
            assignmentId < 1
        ) {
            return res.status(400).json({
                message: "Valid device and assignment IDs are required",
            });
        }

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const [devices] = await connection.execute(
                `SELECT id, device_status
                 FROM devices
                 WHERE id = ?
                 FOR UPDATE`,
                [deviceId]
            );

            if (!devices.length) {
                await connection.rollback();

                return res.status(404).json({
                    message: "Device not found",
                });
            }

            const [assignments] = await connection.execute(
                `SELECT id, user_id
                 FROM device_assignments
                 WHERE id = ?
                   AND device_id = ?
                   AND returned_at IS NULL
                 FOR UPDATE`,
                [assignmentId, deviceId]
            );

            if (
                devices[0].device_status !== "assigned" ||
                !assignments.length
            ) {
                await connection.rollback();

                return res.status(409).json({
                    message: "Assignment changed. Refresh the inventory.",
                });
            }

            await connection.execute(
                `UPDATE device_assignments
                 SET returned_at = CURRENT_TIMESTAMP,
                     returned_by = ?
                 WHERE id = ?
                   AND returned_at IS NULL`,
                [req.user.id, assignmentId]
            );

            await connection.execute(
                `UPDATE devices
                 SET device_status = 'available'
                 WHERE id = ?`,
                [deviceId]
            );

            await audit(
                connection,
                req.user.id,
                "DEVICE_RETURNED",
                assignments[0].user_id,
                {
                    device_id: deviceId,
                    assignment_id: assignmentId,
                }
            );

            await connection.commit();

            res.json({
                message: "Device returned",
            });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
);
router.get(
    "/mine",
    allow("Employee"),
    async (req, res) => {
        const [devices] = await db.execute(
            `SELECT d.id, d.device_name, d.serial_number,
                    d.device_type, d.device_status,
                    a.assigned_at
             FROM device_assignments a
             JOIN devices d ON d.id = a.device_id
             WHERE a.user_id = ?
               AND a.returned_at IS NULL
             ORDER BY a.assigned_at DESC, a.id DESC`,
            [req.user.id]
        );

        res.json({ devices });
    }
);
router.get(
    "/:deviceId/history",
    allow("Administrator", "IT Support"),
    async (req, res) => {
        const deviceId = Number(req.params.deviceId);

        if (!Number.isSafeInteger(deviceId) || deviceId < 1) {
            return res.status(400).json({
                message: "Valid device ID is required",
            });
        }

        const [devices] = await db.execute(
            "SELECT id FROM devices WHERE id = ?",
            [deviceId]
        );

        if (!devices.length) {
            return res.status(404).json({
                message: "Device not found",
            });
        }

        const [history] = await db.execute(
            `SELECT a.id, a.assigned_at, a.returned_at,
                    employee.user_id AS employee_user_id,
                    employee.full_name AS employee_name,
                    assigner.user_id AS assigned_by_user_id,
                    receiver.user_id AS returned_by_user_id
             FROM device_assignments a
             JOIN users employee ON employee.id = a.user_id
             JOIN users assigner ON assigner.id = a.assigned_by
             LEFT JOIN users receiver ON receiver.id = a.returned_by
             WHERE a.device_id = ?
             ORDER BY a.assigned_at DESC, a.id DESC
             LIMIT 500`,
            [deviceId]
        );

        res.json({ history });
    }
);
module.exports = router;