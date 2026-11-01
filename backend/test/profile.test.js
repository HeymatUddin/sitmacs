const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const express = require('express');
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
const db = require('../db');
const { validateProfile } = require('../lib/profile-validation');
const { authenticate, ready } = require('../middleware/auth');
let user, phone = null, events = [], auditFails = false, revokeDuringSave = false;
const jti = crypto.randomBytes(32).toString('hex');
const sessionId = crypto.createHash('sha256').update(jti).digest('hex');
const token = jwt.sign({}, process.env.JWT_SECRET, { algorithm: 'HS256', issuer: 'sitmacs', audience: 'sitmacs-api', subject: '4', jwtid: jti, expiresIn: '1h' });
function reset() {
 user = { id: 4, user_id: 'employee001', full_name: 'Test Employee', email: 'employee001@sitmacs.example',
   role_name: 'Employee', role_id: 2, account_status: 'active', must_change_password: 0, profile_completed: 0 };
 phone = null; events = []; auditFails = false; revokeDuringSave = false;
}
db.execute = async (sql, args) => {
 if (sql.includes('FROM auth_sessions s')) return [[args[0] === sessionId ? { ...user } : null].filter(Boolean)];
 if (sql.startsWith('UPDATE auth_sessions SET last_seen_at')) return [{}];
 if (sql.startsWith('SELECT contact_phone')) return [phone === null ? [] : [{ contact_phone: phone }]];
 throw new Error('Unexpected SQL: ' + sql);
};
db.getConnection = async () => {
 let draft, draftPhone, draftEvents;
 return {
   async beginTransaction() { draft = { ...user }; draftPhone = phone; draftEvents = [...events]; },
   async execute(sql, args) {
     if (sql.includes('FROM users u JOIN roles')) return [[{ ...draft }]];
     if (sql.includes('SELECT id FROM auth_sessions')) return [revokeDuringSave ? [] : [{ id: sessionId }]];
     if (sql.startsWith('INSERT INTO employee_profiles')) { draftPhone = args[1]; return [{}]; }
     if (sql.startsWith('UPDATE users SET full_name')) { draft.full_name = args[0]; draft.profile_completed = 1; return [{}]; }
     if (sql.startsWith('INSERT INTO audit_logs')) {
       if (auditFails) throw new Error('Simulated audit write failure');
       draftEvents.push(args); return [{}];
     }
     throw new Error('Unexpected transaction SQL: ' + sql);
   },
   async commit() { user = draft; phone = draftPhone; events = draftEvents; },
   async rollback() {}, release() {},
 };
};
const app = express();
app.use(express.json());
app.use('/api/profile', require('../routes/profile'));
app.get('/api/dashboard', authenticate, ready, (req, res) => res.json({ role: req.user.role_name }));
app.use((err, req, res, next) => res.status(500).json({ message: 'Unable to process request' }));

test('profile input accepts normal names and international phone punctuation', () => {
 const result = validateProfile({ full_name: "  O'Connor  ", contact_phone: '+61 (412) 345-678' });
 assert.deepEqual(result.value, { full_name: "O'Connor", contact_phone: '+61412345678' });
 for (const body of [null, [], {}, {full_name:' ',contact_phone:'1234567'},
   {full_name:'Valid',contact_phone:'123'}, {full_name:'Valid',contact_phone:'1234567890123456'},
   {full_name:'Valid',contact_phone:'+61<script>'}, {full_name:'Valid',contact_phone:1234567},
   {full_name:'Name\nInjected',contact_phone:'1234567'},
   {full_name:'Valid',contact_phone:'1234567',profile_completed:1},
   {full_name:'Valid',contact_phone:'1234567',role_id:1}]) assert.ok(validateProfile(body).error);
});

test('profile HTTP permissions and atomic completion (database double)', async t => {
 const server = app.listen(0, '127.0.0.1');
 await new Promise(resolve => server.once('listening', resolve));
 const base = `http://127.0.0.1:${server.address().port}`;
 const valid = { full_name: 'Updated Employee', contact_phone: '+61 412 345 678' };
 async function call(path, body, useToken = true) {
   const response = await fetch(base + path, { method: body ? 'POST' : 'GET',
     headers: { 'Content-Type': 'application/json', ...(useToken ? {Authorization:'Bearer ' + token} : {}) },
     ...(body ? {body: JSON.stringify(body)} : {}) });
   return { status: response.status, data: await response.json() };
 }
 try {
   await t.test('anonymous and other roles cannot read or complete employee profiles', async () => {
     reset(); assert.equal((await call('/api/profile',null,false)).status,401);
     assert.equal((await call('/api/profile',valid,false)).status,401);
     for (const role of ['Administrator','IT Support','IT Security Officer']) {
       reset();user.role_name=role;
       assert.equal((await call('/api/profile')).status,403);
       assert.equal((await call('/api/profile',valid)).status,403);
     }
   });
   await t.test('read-only values come from authenticated account and phone starts empty',async()=>{
     reset();const result=await call('/api/profile');assert.equal(result.status,200);
     assert.deepEqual(result.data.profile,{user_id:user.user_id,email:user.email,full_name:user.full_name,contact_phone:''});
   });
   await t.test('missing phone and mass-assignment are rejected without changing data',async()=>{
     reset();
     for(const body of [{full_name:'Valid'}, {...valid,email:'other@sitmacs.example'}, {...valid,user_id:'admin001'}, {...valid,account_status:'active'}, {...valid,must_change_password:0}]) {
       assert.equal((await call('/api/profile',body)).status,400);
     }
     assert.equal(user.profile_completed,0);assert.equal(phone,null);assert.equal(events.length,0);
   });
   await t.test('password must be changed first',async()=>{
     reset();user.must_change_password=1;
     assert.equal((await call('/api/profile',valid)).status,403);assert.equal(user.profile_completed,0);assert.equal(phone,null);
   });
   await t.test('revoked session is rechecked inside transaction',async()=>{
     reset();revokeDuringSave=true;
     assert.equal((await call('/api/profile',valid)).status,401);assert.equal(user.profile_completed,0);assert.equal(phone,null);
   });
   await t.test('audit failure rolls back name, phone and completion flag',async()=>{
     reset();auditFails=true;
     assert.equal((await call('/api/profile',valid)).status,500);
     assert.equal(user.full_name,'Test Employee');assert.equal(user.profile_completed,0);assert.equal(phone,null);
   });
   await t.test('saving valid profile unlocks dashboard with same session and preserves identity and role',async()=>{
     reset();const original={id:user.id,user_id:user.user_id,email:user.email,role_name:user.role_name};
     assert.equal((await call('/api/dashboard')).status,403);
     const result=await call('/api/profile',valid);assert.equal(result.status,200);
     assert.equal(result.data.user.requirements.profile_completion,false);
     assert.equal(user.profile_completed,1);assert.equal(phone,'+61412345678');assert.equal(user.full_name,valid.full_name);
     for(const [key,value] of Object.entries(original))assert.equal(user[key],value);
     assert.equal(events.length,1);assert.equal(events[0][1],'PROFILE_COMPLETED');
     assert.equal(events[0][3],null); // Phone is not copied into audit details.
     assert.equal((await call('/api/dashboard')).status,200);
     assert.equal((await call('/api/profile',valid)).status,409);
   });
 } finally {await new Promise(resolve=>server.close(resolve));await db.end();}
});
