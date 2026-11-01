// Must run inside the same transaction as account insertion.
async function allocateUserId(connection) {
 const [rows] = await connection.execute(
   "SELECT `last_value` FROM user_id_sequences WHERE sequence_name = 'users' FOR UPDATE"
 );
 if (rows.length !== 1) {
   const error = new Error("Run the automatic User ID migration first.");
   error.code = "USER_ID_SEQUENCE_MISSING";
   throw error;
 }
 let value = Number(rows[0].last_value);
 for (;;) {
   value += 1;
   if (!Number.isSafeInteger(value) || value > 4294967295) {
     const error = new Error("User ID sequence exhausted.");
     error.code = "USER_ID_SEQUENCE_EXHAUSTED";
     throw error;
   }
   const userId = "USR" + String(value).padStart(6, "0");
   const [existing] = await connection.execute("SELECT id FROM users WHERE user_id = ?", [userId]);
   if (existing.length) continue;
   await connection.execute(
     "UPDATE user_id_sequences SET `last_value` = ? WHERE sequence_name = 'users'", [value]
   );
   return userId;
 }
}
module.exports = { allocateUserId };
