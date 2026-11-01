const path = require("path");

require("dotenv").config({
    path: path.join(__dirname, "..", ".env"),
});

const bcrypt = require("bcrypt");
const crypto = require("crypto");
const db = require("../db");

async function main() {
    const initialUsers = [
        {
            userId: "employee001",
            fullName: "Test Employee",
            email: "employee001@sitmacs.example",
            roleName: "Employee",
        },
        {
            userId: "support001",
            fullName: "Test IT Support",
            email: "support001@sitmacs.example",
            roleName: "IT Support",
        },
        {
            userId: "security001",
            fullName: "Test Security Officer",
            email: "security001@sitmacs.example",
            roleName: "IT Security Officer",
        },
    ];
    for (const account of initialUsers) {
        const [existing] = await db.execute(
            "SELECT id FROM users WHERE user_id = ? OR email = ?",
            [account.userId, account.email]
        );

        if (existing.length > 0) {
            console.log("Skipped existing account:", account.userId);
            continue;
        }

        const [roles] = await db.execute(
            "SELECT id FROM roles WHERE role_name = ?",
            [account.roleName]
        );

        if (roles.length !== 1) {
            throw new Error("Role not found: " + account.roleName);
        }

        const temporaryPassword = crypto.randomBytes(24).toString("base64url");
        const passwordHash = await bcrypt.hash(temporaryPassword, 12);

        await db.execute(
            `INSERT INTO users
         (user_id, full_name, email, password_hash, role_id,
          account_status, must_change_password, profile_completed)
       VALUES (?, ?, ?, ?, ?, 'pending', 1, 0)`,
            [
                account.userId,
                account.fullName,
                account.email,
                passwordHash,
                roles[0].id,
            ]
        );

        console.log("Created pending account:", account.userId);
        console.log("Temporary password:", temporaryPassword);
    }
}

main()
    .catch((error) => {
        console.error("User setup failed:", error.code || error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.end();
    });