const { test } = require("node:test");
const assert = require("node:assert/strict");
const { requirements, isReady, validPassword, publicUser } = require("../lib/policy");
test("employee cannot bypass either first-login requirement",()=>{
 for(const must_change_password of [0,1]) for(const profile_completed of [0,1]) {
   const u={role_name:"Employee",must_change_password,profile_completed};
   assert.equal(isReady(u),!must_change_password && Boolean(profile_completed));
 }
});
test("administrator profile flag does not introduce unagreed profile fields",()=>{
 assert.equal(isReady({role_name:"Administrator",must_change_password:0,profile_completed:0}),true);
 assert.equal(requirements({role_name:"Administrator",must_change_password:1}).password_change,true);
});
test("bcrypt byte limit includes Unicode",()=>{
 assert.equal(validPassword("a".repeat(12)),true);
 assert.equal(validPassword("a".repeat(73)),false);
 assert.equal(validPassword("🔒".repeat(20)),false);
 assert.equal(validPassword("short"),false);
});
test("public account response never leaks password hash",()=>{
 assert.equal("password_hash" in publicUser({password_hash:"SECRET"}),false);
});
