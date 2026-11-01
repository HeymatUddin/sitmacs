const path = require("path");

require("dotenv").config({
  path: path.join(__dirname, "..", ".env"),
});

const bcrypt = require("bcrypt");
const crypto = require("crypto");
const db = require("../db");
const readline = require("readline/promises");

async function main() {
  const [existingUsers] = await db.execute(
    "SELECT id FROM users LIMIT 1"
  );

  if (existingUsers.length > 0) {
    throw new Error("Setup stopped: users already exist.");
  }

  const [roles] = await db.execute(
    "SELECT id FROM roles WHERE role_name = ?",
    ["Administrator"]
  );

  if (roles.length !== 1) {
    throw new Error("Administrator role was not found.");
  }

  const administratorRoleId = roles[0].id;

  const input = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let userId, fullName, email;

  try {
    userId = (await input.question("Administrator User ID: ")).trim();
    fullName = (await input.question("Full name: ")).trim();
    email = (await input.question("Email: ")).trim().toLowerCase();
  } finally {
    input.close();
  }

  if (!/^[A-Za-z0-9_-]{3,50}$/.test(userId)) {
    throw new Error(
      "User ID must be 3–50 letters, numbers, underscores or hyphens."
    );
  }

  if (!fullName || fullName.length > 150) {
    throw new Error(
      "Full name is required and must not exceed 150 characters."
    );
  }

  if (
    email.length > 255 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new Error("Enter a valid email address.");
  }

  const temporaryPassword = crypto.randomBytes(24).toString("base64url");
  const passwordHash = await bcrypt.hash(temporaryPassword, 12);

  await db.execute(
    `INSERT INTO users
       (user_id, full_name, email, password_hash, role_id,
        account_status, must_change_password, profile_completed)
     VALUES (?, ?, ?, ?, ?, 'active', 1, 0)`,
    [userId, fullName, email, passwordHash, administratorRoleId]
  );

  console.log("First Administrator account created.");
  console.log("User ID:", userId);
  console.log("Temporary password:", temporaryPassword);
  console.log("Keep this password private. It must be changed on first login.");
}

main()
  .catch((error) => {
    console.error(
      "Administrator setup failed:",
      error.code || error.message
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });