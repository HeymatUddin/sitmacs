const ROLES = ["Administrator", "Employee", "IT Support", "IT Security Officer"];
function requirements(user) {
 return {
   password_change: Boolean(user.must_change_password),
   profile_completion: user.role_name === "Employee" && !user.profile_completed,
 };
}
function isReady(user) { return !Object.values(requirements(user)).some(Boolean); }
function validPassword(value) {
 return typeof value === "string" && value.length >= 12 && Buffer.byteLength(value, "utf8") <= 72;
}
function publicUser(u) {
 return { id: u.id, user_id: u.user_id, full_name: u.full_name, role: u.role_name,
   account_status: u.account_status, requirements: requirements(u) };
}
module.exports = { ROLES, requirements, isReady, validPassword, publicUser };
