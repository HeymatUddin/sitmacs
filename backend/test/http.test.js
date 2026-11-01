const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
const bcrypt = require('bcrypt');
const db = require('../db');
let pending = {id:2, account_status:'pending'}, user, sessions = new Map(), events = [];
const original = { execute: db.execute, getConnection: db.getConnection };
async function execute(sql, args = []) {
 if (sql.includes('FROM auth_sessions s')) {
   return [[sessions.has(args[0]) && user.account_status === 'active' ? {...user} : null].filter(Boolean)];
 }
 if (sql.startsWith('UPDATE auth_sessions SET last_seen_at')) return [{}];
 if (sql.includes('SELECT u.*') && sql.includes('FOR UPDATE')) return [[args[0] === user.user_id ? {...user} : undefined].filter(Boolean)];
 if (sql.includes('SELECT locked_until <= NOW()')) return [[{expired: user.locked_until <= new Date()}]];
 if (sql.startsWith('SELECT * FROM users')) return [[{...user}]];
 if (sql === 'SELECT id,account_status FROM users WHERE id=? FOR UPDATE') return [[{...pending}]];
 if (sql === 'UPDATE users SET account_status=? WHERE id=?') {pending.account_status=args[0];return [{}];}
 if (sql.startsWith('UPDATE users SET account_status=')) { user.account_status='active'; user.failed_login_attempts=0; user.locked_until=null; return [{}]; }
 if (sql.startsWith('UPDATE users SET failed_login_attempts=?')) {
   user.failed_login_attempts=args[0]; user.account_status=args[1];
   user.locked_until=args[2]>=5?new Date(Date.now()+900000):null; return [{}];
 }
 if (sql.startsWith('UPDATE users SET failed_login_attempts=0')) { user.failed_login_attempts=0;return [{}]; }
 if (sql.startsWith('UPDATE users SET password_hash=')) {user.password_hash=args[0];user.must_change_password=0;return [{}];}
 if (sql.startsWith('INSERT INTO auth_sessions')) { sessions.set(args[0], args[1]); return [{}]; }
 if (sql.startsWith('DELETE FROM auth_sessions WHERE user_id')) {sessions.clear();return [{}];}
 if (sql.startsWith('DELETE FROM auth_sessions WHERE id')) {sessions.delete(args[0]);return [{}];}
 if (sql.startsWith('INSERT INTO audit_logs')) { events.push(args[1]);return [{}]; }
 if (sql.startsWith('SELECT id,actor_id')) return [[]];
 if (sql.includes('SELECT u.id,u.user_id')) return [[{user_id:user.user_id}]];
 throw new Error('Unexpected test SQL: '+sql);
}
db.execute = execute;
db.getConnection = async()=>({execute,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{}});
const app = require('../server');
test('HTTP authentication, onboarding and role boundaries (database double)',async t=>{
 const password='A-private-test-password';
 const passwordHash=await bcrypt.hash(password,12);
 const server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 async function call(path,body,token,method) {
   const response=await fetch(base+path,{method:method || (body?'POST':'GET'),
     headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
     ...(body?{body:JSON.stringify(body)}:{})});
   return {status:response.status,body:await response.json()};
 }
 function reset(role='Administrator',change=0,profile=1) {
   user={id:1,user_id:'test001',full_name:'Test',password_hash:passwordHash,role_id:1,
     role_name:role,account_status:'active',must_change_password:change,
     profile_completed:profile,failed_login_attempts:0,locked_until:null};sessions.clear();events=[];
 }
 async function login(pw=password){return call('/api/auth/login',{user_id:'test001',password:pw});}
 try {
   await t.test('empty input and forged token rejected',async()=>{
     reset();assert.equal((await call('/api/auth/login',{})).status,400);
     assert.equal((await call('/api/dashboard',null,'fake')).status,401);
   });
   await t.test('successful login never exposes hash and logout revokes token',async()=>{
     reset();const r=await login();assert.equal(r.status,200);assert.ok(r.body.token);
     assert.equal('password_hash' in r.body.user,false);
     assert.equal((await call('/api/dashboard',null,r.body.token)).status,200);
     assert.equal((await call('/api/auth/logout',{},r.body.token)).status,200);
     assert.equal((await call('/api/dashboard',null,r.body.token)).status,401);
   });
   await t.test('each non-active status denies even correct password',async()=>{
     for(const status of ['pending','suspended','disabled','locked']) {
       reset();user.account_status=status;user.locked_until=new Date(Date.now()+900000);
       assert.equal((await login()).status,401);assert.equal(sessions.size,0);
     }
   });
   await t.test('five failures lock account and expired lock allows retry',async()=>{
     reset();for(let i=0;i<5;i++)assert.equal((await login('wrong')).status,401);
     assert.equal(user.account_status,'locked');assert.ok(events.includes('ACCOUNT_LOCKED'));
     assert.equal((await login()).status,401);
     user.locked_until=new Date(Date.now()-1000);
     assert.equal((await login()).status,200);assert.equal(user.failed_login_attempts,0);
   });
   await t.test('employee profile gate survives correct password and token',async()=>{
     reset('Employee',0,0);const r=await login();
     assert.equal((await call('/api/dashboard',null,r.body.token)).status,403);
     assert.equal((await call('/api/auth/me',null,r.body.token)).status,200);
   });
   await t.test('first password change blocks dashboard and revokes old session',async()=>{
     reset('Administrator',1,0);const r=await login();
     assert.equal((await call('/api/dashboard',null,r.body.token)).status,403);
     const changed=await call('/api/auth/change-password',{current_password:password,new_password:'A-new-private-password'},r.body.token);
     assert.equal(changed.status,200);assert.equal(user.must_change_password,0);
     assert.equal((await call('/api/auth/me',null,r.body.token)).status,401);
   });
   await t.test('administrator can approve or reject only pending accounts',async()=>{
     reset();const r=await login();
     pending={id:2,account_status:'pending'};
     assert.equal((await call('/api/users/2/decision',{decision:'approve',reason:'Identity checked'},r.body.token)).status,200);
     assert.equal(pending.account_status,'active');assert.ok(events.includes('ACCOUNT_APPROVED'));
     assert.equal((await call('/api/users/2/decision',{decision:'approve',reason:'Again'},r.body.token)).status,409);
     pending={id:2,account_status:'pending'};
     assert.equal((await call('/api/users/2/decision',{decision:'reject',reason:'Identity not verified'},r.body.token)).status,200);
     assert.equal(pending.account_status,'disabled');assert.ok(events.includes('ACCOUNT_REJECTED'));
   });
   await t.test('support cannot approve accounts or provision an administrator',async()=>{
     reset('IT Support');const r=await login();
     assert.equal((await call('/api/users/2/decision',{decision:'approve',reason:'Test'},r.body.token)).status,403);
     assert.equal((await call('/api/users',{user_id:'badadmin',full_name:'Test',email:'test@sitmacs.example',role_name:'Administrator'},r.body.token)).status,400);
   });
   await t.test('live account suspension invalidates an existing session',async()=>{
     reset();const r=await login();user.account_status='suspended';
     assert.equal((await call('/api/dashboard',null,r.body.token)).status,401);
   });
   await t.test('four roles enforce admin list and security audit permissions',async()=>{
     for(const role of ['Administrator','Employee','IT Support','IT Security Officer']) {
       reset(role);const r=await login();
       assert.equal((await call('/api/users',null,r.body.token)).status,role==='Administrator'?200:403);
       assert.equal((await call('/api/audit-logs',null,r.body.token)).status,
         ['Administrator','IT Security Officer'].includes(role)?200:403);
     }
   });
 } finally { await new Promise(resolve=>server.close(resolve));db.execute=original.execute;db.getConnection=original.getConnection;await db.end(); }
});
