'use strict';
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
  process.exit(1);
});

const express = require('express'), path = require('path'), crypto = require('crypto');
const { MongoClient, ObjectId } = require('mongodb');
require('dns').setServers(['8.8.8.8', '1.1.1.1']);

const PORT = process.env.PORT || 5050;
const URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const DBN = process.env.MONGODB_DB_NAME || 'medilink_lab_dev';

let db;
const C = {};

class ApiError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fail = (c, m) => { throw new ApiError(c, m); };

// ---------------- constants & helpers ----------------
const PRI = ['Elective', 'Urgent', 'Emergency'], TROLES = ['Surgeon', 'Anesthesiologist', 'Nurse'], ATYPES = ['Available', 'Maintenance', 'Blocked'];
const OPEN_FROM = 7 * 60, OPEN_TO = 19 * 60; 
const INV = { 'C-Arm Imaging': 1, 'Laparoscopic Tower': 2, 'Anesthesia Machine': 3, 'Surgical Microscope': 1, 'Electrosurgical Unit': 3, 'Defibrillator': 2 };
const validTime = t => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const mins = t => { const [h, m] = t.split(':'); return +h * 60 + +m; };
const fmt = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const ov = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;
const todayStr = () => new Date().toISOString().slice(0, 10);
const dstr = d => d.toISOString().slice(0, 10);
const pDate = d => { if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '') || isNaN(new Date(d + 'T00:00:00Z'))) fail(400, 'A valid date (yyyy-MM-dd) is required.'); return new Date(d + 'T00:00:00Z'); };
const oid = s => { try { const o = new ObjectId(String(s)); return o.toString() === String(s) ? o : null; } catch { return null; } };
const blank = s => typeof s !== 'string' || !s.trim();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// ---------------- auth ----------------
const sessions = new Map(); 
const hash = p => { const s = crypto.randomBytes(16); return s.toString('base64') + '$' + crypto.pbkdf2Sync(p, s, 100000, 32, 'sha256').toString('base64'); };
const verify = (p, st) => {
  const [s, h] = String(st).split('$'); if (!h) return false;
  const a = crypto.pbkdf2Sync(p, Buffer.from(s, 'base64'), 100000, 32, 'sha256'), b = Buffer.from(h, 'base64');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
function need(req, ...roles) { 
  const h = req.headers.authorization || '';
  const s = h.startsWith('Bearer ') ? sessions.get(h.slice(7).trim()) : null;
  if (!s || s.expires < Date.now()) fail(401, 'Please sign in again.');
  if (roles.length && !roles.includes(s.role)) fail(403, 'Your role is not allowed to perform this action.');
  return s;
}
const audit = (s, action, entityType, entityId, details, req) =>
  C.audit.insertOne({ userId: s.userId, action, entityType, entityId: entityId || null, details, timestamp: new Date(), ipAddress: req.ip });

// ---------------- scheduling logic ----------------
function validateSlot(start, dur, pr) {
  if (!validTime(start)) fail(400, 'Start time must be in HH:mm (24-hour) format.');
  if (!Number.isInteger(dur) || dur < 15 || dur > 720) fail(400, 'Duration must be between 15 and 720 minutes.');
  if (!PRI.includes(pr)) fail(400, 'Priority must be Elective, Urgent, or Emergency.');
}

async function checkConflicts(room, date, start, dur, priority, team, eq, excludeId) {
  const end = start + dur;
  if (end > 1440) fail(400, 'A procedure must end before midnight.');
  if (room.status !== 'Active') fail(409, `Room ${room.roomCode} is ${room.status.toLowerCase()} and cannot be scheduled.`);
  const av = await C.avail.find({ roomId: room._id, date }).toArray();
  for (const a of av.filter(a => a.availabilityType !== 'Available'))
    if (ov(start, end, mins(a.startTime), mins(a.endTime))) fail(409, `Room ${room.roomCode} has a ${a.availabilityType.toLowerCase()} block from ${a.startTime} to ${a.endTime}.`);
  if (priority !== 'Emergency') {
    const open = av.filter(a => a.availabilityType === 'Available');
    const ok = open.length ? open.some(a => start >= mins(a.startTime) && end <= mins(a.endTime)) : start >= OPEN_FROM && end <= OPEN_TO;
    if (!ok) fail(409, `Room ${room.roomCode} is not available at ${fmt(start)}-${fmt(end)} (outside its operating hours).`);
  }
  const q = { scheduledDate: date, status: { $in: ['Scheduled', 'Rescheduled'] } }; if (excludeId) q._id = { $ne: excludeId };
  const day = (await C.sched.find(q).toArray()).filter(s => ov(start, end, mins(s.startTime), mins(s.startTime) + s.durationMinutes));
  for (const s of day) {
    const span = `${s.startTime}-${fmt(mins(s.startTime) + s.durationMinutes)}`;
    if (s.roomId.equals(room._id)) fail(409, `Room ${room.roomCode} is already booked ${span} (${s.scheduleCode}).`);
    const sh = s.teamMembers.find(m => team.some(t => t.userId.equals(m.userId)));
    if (sh) fail(409, `${sh.name} is already assigned ${span} (${s.scheduleCode}).`);
  }
  for (const it of eq) {
    const total = INV[it.name] ?? 1;
    const used = day.reduce((n, s) => n + s.equipment.filter(e => e.name === it.name).reduce((x, e) => x + e.quantity, 0), 0);
    if (used + it.quantity > total) fail(409, `Equipment "${it.name}" is not available: ${used} of ${total} already in use at that time.`);
  }
}

function openSlots(room, av, booked) {
  if (room.status !== 'Active') return [];
  let windows = av.filter(a => a.availabilityType === 'Available').map(a => [mins(a.startTime), mins(a.endTime)]);
  if (!windows.length) windows = [[OPEN_FROM, OPEN_TO]];
  const blocked = av.filter(a => a.availabilityType !== 'Available').map(a => [mins(a.startTime), mins(a.endTime)])
    .concat(booked.map(s => [mins(s.startTime), mins(s.startTime) + s.durationMinutes])).sort((a, b) => a[0] - b[0]);
  const res = [];
  for (const [ws, we] of windows.sort((a, b) => a[0] - b[0])) {
    let cur = ws;
    for (const [bs, be] of blocked) { if (be <= cur) continue; if (bs >= we) break; if (bs > cur) res.push(`${fmt(cur)}-${fmt(bs)}`); cur = Math.max(cur, be); }
    if (cur < we) res.push(`${fmt(cur)}-${fmt(we)}`);
  }
  return res;
}

async function findRoom(id) {
  if (blank(id)) fail(400, 'A room is required.');
  const o = oid(id);
  const r = await C.rooms.findOne({ $or: [{ roomCode: id }, ...(o ? [{ _id: o }] : [])] });
  return r || fail(404, `Room "${id}" was not found.`);
}
async function buildTeam(req) {
  const team = [];
  for (const m of req || []) {
    if (blank(m.userId)) continue;
    const role = m.role || 'Surgeon'; if (!TROLES.includes(role)) fail(400, 'Team role must be Surgeon, Anesthesiologist, or Nurse.');
    const o = oid(m.userId), u = o && await C.users.findOne({ _id: o, status: 'Active' });
    if (!u) fail(404, 'A selected staff member was not found.');
    if (!team.some(t => t.userId.equals(u._id))) team.push({ userId: u._id, name: u.fullName, role });
  }
  return team;
}
function buildEquipment(req) {
  const map = new Map();
  for (const e of req || []) {
    if (blank(e.name)) continue;
    if (!Number.isInteger(e.quantity) || e.quantity < 1) fail(400, 'Equipment quantity must be at least 1.');
    map.set(e.name.trim(), (map.get(e.name.trim()) || 0) + e.quantity);
  }
  return [...map].map(([name, quantity]) => ({ name, quantity }));
}
async function views(list) {
  const cases = new Map((await C.cases.find({ _id: { $in: [...new Set(list.map(s => String(s.caseId)))].map(x => new ObjectId(x)) } }).toArray()).map(c => [String(c._id), c]));
  const rooms = new Map((await C.rooms.find().toArray()).map(r => [String(r._id), r]));
  const pids = [...new Set([...cases.values()].map(c => String(c.patientId)))].filter(x => /^[0-9a-f]{24}$/.test(x)).map(x => new ObjectId(x));
  const pats = new Map((await C.patients.find({ _id: { $in: pids } }).toArray()).map(p => [String(p._id), p]));
  return list.sort((a, b) => a.scheduledDate - b.scheduledDate || a.startTime.localeCompare(b.startTime)).map(s => {
    const c = cases.get(String(s.caseId)) || {}, r = rooms.get(String(s.roomId)) || {}, pt = pats.get(String(c.patientId)) || {};
    return {
      id: String(s._id), scheduleCode: s.scheduleCode, caseRef: c.caseRef, patientAlias: c.patientAlias, patientName: pt.fullName, patientCode: pt.patientCode, procedureName: c.procedureName,
      roomId: String(s.roomId), room: r.roomCode, roomName: r.roomName, date: dstr(s.scheduledDate), startTime: s.startTime,
      endTime: fmt(mins(s.startTime) + s.durationMinutes), durationMinutes: s.durationMinutes, priority: s.priority, status: s.status,
      teamMembers: s.teamMembers.map(m => ({ userId: String(m.userId), name: m.name, role: m.role })), equipment: s.equipment,
      cancelReason: s.cancelReason, updatedAt: s.updatedAt
    };
  });
}

// ---------------- app ----------------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
const get = (p, fn) => app.get(p, wrap(fn)), post = (p, fn) => app.post(p, wrap(fn)), put = (p, fn) => app.put(p, wrap(fn)), del = (p, fn) => app.delete(p, wrap(fn));
const dropSessions = id => { for (const [tk, s] of sessions) if (String(s.userId) === String(id)) sessions.delete(tk); }; 

get('/api/health', async (req, res) => {
  let ok = true; try { await db.command({ ping: 1 }); } catch { ok = false; }
  res.json({ status: 'ok', databaseConnected: ok, time: new Date() });
});

post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (blank(username) || !password) fail(400, 'Username and password are required.');
  const u = await C.users.findOne({ username: username.trim(), status: 'Active' });
  if (!u || !verify(password, u.passwordHash)) fail(401, 'Invalid username or password.');
  const token = crypto.randomBytes(24).toString('hex');
  const s = { userId: u._id, username: u.username, fullName: u.fullName, role: u.role, expires: Date.now() + 8 * 3600e3 };
  sessions.set(token, s); await audit(s, 'Login', 'users', u._id, 'User signed in', req);
  res.json({ token, role: u.role, fullName: u.fullName, username: u.username });
});

get('/api/rooms', async (req, res) => {
  need(req); const d = pDate(req.query.date || todayStr());
  const [rooms, av, sch] = await Promise.all([C.rooms.find().sort({ roomCode: 1 }).toArray(), C.avail.find({ date: d }).toArray(),
    C.sched.find({ scheduledDate: d, status: { $in: ['Scheduled', 'Rescheduled'] } }).toArray()]);
  res.json(rooms.map(r => {
    const ra = av.filter(a => a.roomId.equals(r._id)), rb = sch.filter(s => s.roomId.equals(r._id));
    return { id: String(r._id), roomCode: r.roomCode, roomName: r.roomName, location: r.location, specialty: r.specialty, status: r.status,
      availability: ra.map(a => ({ id: String(a._id), startTime: a.startTime, endTime: a.endTime, availabilityType: a.availabilityType, notes: a.notes })),
      bookings: rb.map(s => ({ scheduleCode: s.scheduleCode, startTime: s.startTime, endTime: fmt(mins(s.startTime) + s.durationMinutes), priority: s.priority })),
      openSlots: openSlots(r, ra, rb) };
  }));
});

post('/api/availability', async (req, res) => {
  const u = need(req, 'Scheduler', 'Administrator'), r = req.body || {};
  const room = await findRoom(r.roomId), d = pDate(r.date);
  if (!validTime(r.startTime) || !validTime(r.endTime) || mins(r.endTime) <= mins(r.startTime)) fail(400, 'Start and end times must be valid HH:mm values with the end after the start.');
  if (!ATYPES.includes(r.availabilityType)) fail(400, 'Type must be Available, Maintenance, or Blocked.');
  const a = { roomId: room._id, date: d, startTime: r.startTime, endTime: r.endTime, availabilityType: r.availabilityType, notes: r.notes || null };
  const ins = await C.avail.insertOne(a);
  await audit(u, 'Create', 'room_availability', ins.insertedId, `${a.availabilityType} ${room.roomCode} ${r.date} ${a.startTime}-${a.endTime}`, req);
  res.json({ id: String(ins.insertedId), message: `${a.availabilityType} entry saved for ${room.roomCode}.` });
});

get('/api/equipment', async (req, res) => { need(req); res.json(Object.entries(INV).map(([name, total]) => ({ name, total }))); });
get('/api/staff', async (req, res) => {
  need(req); const l = await C.users.find({ status: 'Active', role: 'SurgicalStaff' }).sort({ fullName: 1 }).toArray();
  res.json(l.map(x => ({ id: String(x._id), fullName: x.fullName, username: x.username })));
});

const initKey = s => String(s || '').replace(/[^A-Za-z]/g, '').toUpperCase();
async function newPatient(p, createdBy) {
  const first = p.firstName.trim(), last = p.lastName.trim(), n = (await C.patients.countDocuments()) + 1;
  const doc = { patientCode: `PAT-${String(n).padStart(4, '0')}`, firstName: first, lastName: last, fullName: `${first} ${last}`,
    initials: `${first[0].toUpperCase()}.${last[0].toUpperCase()}.`, age: p.age ?? null, sex: p.sex || null, contactNumber: p.contactNumber || null, createdBy: createdBy || null, createdAt: new Date() };
  const ins = await C.patients.insertOne(doc); return { ...doc, _id: ins.insertedId };
}
get('/api/patients', async (req, res) => {
  need(req); const [pl, cl] = await Promise.all([C.patients.find().sort({ fullName: 1 }).toArray(), C.cases.find().toArray()]);
  res.json(pl.map(p => ({ id: String(p._id), patientCode: p.patientCode, fullName: p.fullName, firstName: p.firstName, lastName: p.lastName, initials: p.initials, age: p.age, sex: p.sex, contactNumber: p.contactNumber,
    cases: cl.filter(c => String(c.patientId) === String(p._id)).map(c => ({ caseRef: c.caseRef, procedureName: c.procedureName, urgency: c.urgency })) })));
});
post('/api/patients', async (req, res) => {
  const u = need(req, 'Scheduler', 'Administrator'), r = req.body || {};
  if (blank(r.firstName) || blank(r.lastName)) fail(400, 'First name and last name are required.');
  if (r.age != null && (!Number.isInteger(r.age) || r.age < 0 || r.age > 120)) fail(400, 'Age must be between 0 and 120.');
  if (r.sex && !['Male', 'Female'].includes(r.sex)) fail(400, 'Sex must be Male or Female.');
  const p = await newPatient(r, u.userId);
  await audit(u, 'Create', 'patients', p._id, `Registered patient ${p.patientCode} (${p.initials})`, req);
  res.json({ id: String(p._id), patientCode: p.patientCode, message: `Patient ${p.fullName} saved (${p.patientCode}).` });
});

post('/api/cases', async (req, res) => {
  const u = need(req, 'Scheduler', 'Administrator'), r = req.body || {};
  if (blank(r.caseRef)) fail(400, 'Case reference is required.');
  if (blank(r.procedureName)) fail(400, 'Procedure name is required.');
  const po = oid(r.patientId), pt = po && await C.patients.findOne({ _id: po });
  if (!pt) fail(400, 'Select a registered patient for this case.');
  const urg = r.urgency || 'Elective'; if (!PRI.includes(urg)) fail(400, 'Urgency must be Elective, Urgent, or Emergency.');
  const cs = { caseRef: r.caseRef.trim().toUpperCase(), patientId: pt._id, patientAlias: pt.initials, age: pt.age, procedureName: r.procedureName.trim(), diagnosis: r.diagnosis || null, urgency: urg, registeredBy: u.userId, createdAt: new Date() };
  const ins = await C.cases.insertOne(cs);
  await audit(u, 'Create', 'surgical_cases', ins.insertedId, `Registered case ${cs.caseRef} for ${pt.patientCode}: ${cs.procedureName}`, req);
  res.json({ id: String(ins.insertedId), caseRef: cs.caseRef, message: 'Case saved to the database successfully.' });
});
get('/api/cases', async (req, res) => {
  need(req); const l = await C.cases.find().sort({ createdAt: -1 }).limit(200).toArray();
  const pats = new Map((await C.patients.find().toArray()).map(p => [String(p._id), p]));
  res.json(l.map(x => { const p = pats.get(String(x.patientId)) || {}; return { id: String(x._id), caseRef: x.caseRef, patientId: x.patientId ? String(x.patientId) : null, patientName: p.fullName, patientCode: p.patientCode, patientAlias: x.patientAlias, age: x.age, procedureName: x.procedureName, diagnosis: x.diagnosis, urgency: x.urgency, createdAt: x.createdAt }; }));
});

get('/api/schedules', async (req, res) => {
  need(req); const d = pDate(req.query.date || todayStr());
  res.json(await views(await C.sched.find({ scheduledDate: d }).toArray()));
});

post('/api/schedules', async (req, res) => {
  const u = need(req, 'Scheduler', 'Administrator'), r = req.body || {};
  if (blank(r.caseRef)) fail(400, 'Case reference is required.');
  const cref = r.caseRef.trim().toUpperCase();
  const cs = await C.cases.findOne({ caseRef: cref }) || fail(404, `Case ${cref} was not found. Register the case first.`);
  const room = await findRoom(r.roomId), date = pDate(r.date);
  const dur = r.durationMinutes ?? 0, pr = blank(r.priority) ? cs.urgency : r.priority;
  validateSlot(r.startTime, dur, pr);
  const team = await buildTeam(r.teamMembers), eq = buildEquipment(r.equipment);
  await checkConflicts(room, date, mins(r.startTime), dur, pr, team, eq, null);
  const n = (await C.sched.countDocuments()) + 1, now = new Date();
  const s = { scheduleCode: `SCH-${date.getUTCFullYear()}-${String(n).padStart(4, '0')}`, caseId: cs._id, roomId: room._id, scheduledBy: u.userId, scheduledDate: date, startTime: r.startTime, durationMinutes: dur, priority: pr, status: 'Scheduled', teamMembers: team, equipment: eq, cancelReason: null, createdAt: now, updatedAt: now };
  const ins = await C.sched.insertOne(s);
  await audit(u, 'Create', 'surgical_schedules', ins.insertedId, `Scheduled ${cs.caseRef} in ${room.roomCode} on ${r.date} ${s.startTime} (${dur} min)`, req);
  res.json({ id: String(ins.insertedId), scheduleId: s.scheduleCode, caseRef: cs.caseRef, room: room.roomCode, status: s.status, message: 'Schedule saved to the database successfully.' });
});

put('/api/schedules/:id', async (req, res) => {
  const u = need(req, 'Scheduler', 'Administrator'), r = req.body || {}, id = req.params.id, o = oid(id);
  const s = await C.sched.findOne({ $or: [{ scheduleCode: id }, ...(o ? [{ _id: o }] : [])] }) || fail(404, 'Schedule not found.');
  const action = (r.action || 'update').toLowerCase();
  if (!['update', 'reschedule', 'cancel', 'complete'].includes(action)) fail(400, 'Action must be update, reschedule, cancel, or complete.');
  if (['Cancelled', 'Completed'].includes(s.status)) fail(409, `A ${s.status.toLowerCase()} schedule cannot be changed.`);
  const room = r.roomId ? await findRoom(r.roomId) : await C.rooms.findOne({ _id: s.roomId });
  if (action === 'cancel') {
    if (blank(r.cancelReason)) fail(400, 'A cancellation reason is required.');
    s.status = 'Cancelled'; s.cancelReason = r.cancelReason;
  } else if (action === 'complete') s.status = 'Completed';
  else {
    const date = r.date ? pDate(r.date) : s.scheduledDate, start = r.startTime || s.startTime, dur = r.durationMinutes ?? s.durationMinutes;
    const pr = blank(r.priority) ? s.priority : r.priority; validateSlot(start, dur, pr);
    const team = r.teamMembers ? await buildTeam(r.teamMembers) : s.teamMembers, eq = r.equipment ? buildEquipment(r.equipment) : s.equipment;
    await checkConflicts(room, date, mins(start), dur, pr, team, eq, s._id);
    Object.assign(s, { roomId: room._id, scheduledDate: date, startTime: start, durationMinutes: dur, priority: pr, teamMembers: team, equipment: eq });
    if (action === 'reschedule') { s.status = 'Rescheduled'; s.cancelReason = r.cancelReason || null; }
  }
  s.updatedAt = new Date(); await C.sched.replaceOne({ _id: s._id }, s);
  const cs = await C.cases.findOne({ _id: s.caseId });
  const label = { cancel: 'Cancel', reschedule: 'Reschedule' }[action] || 'Update';
  await audit(u, label, 'surgical_schedules', s._id, `${label} ${s.scheduleCode}: ${room.roomCode} ${dstr(s.scheduledDate)} ${s.startTime} ${s.cancelReason || ''}`.trim(), req);
  res.json({ id: String(s._id), scheduleId: s.scheduleCode, caseRef: cs?.caseRef, room: room.roomCode, status: s.status, message: `Schedule ${s.scheduleCode} updated: ${s.status}.` });
});

get('/api/admin/records', async (req, res) => {
  const u = need(req, 'Administrator'), d = pDate(req.query.date || todayStr());
  if (req.query.review === '1') await audit(u, 'Review', 'surgical_schedules', null, 'Reviewed admin records', req);
  const [rooms, day, changed, av, users, logs] = await Promise.all([C.rooms.find().sort({ roomCode: 1 }).toArray(), C.sched.find({ scheduledDate: d }).toArray(),
    C.sched.find({ status: { $in: ['Rescheduled', 'Cancelled'] } }).sort({ updatedAt: -1 }).limit(100).toArray(),
    C.avail.find({ date: d, availabilityType: { $ne: 'Available' } }).toArray(), C.users.find().toArray(), C.audit.find().sort({ timestamp: -1 }).limit(100).toArray()]);
  const active = day.filter(s => ['Scheduled', 'Rescheduled', 'Completed'].includes(s.status));
  const code = id => rooms.find(r => r.roomId === id || r._id.equals(id))?.roomCode;
  const alerts = [...rooms.filter(r => r.status !== 'Active').map(r => `${r.roomCode} is ${r.status.toLowerCase()}.`),
    ...av.map(a => `${code(a.roomId)}: ${a.availabilityType.toLowerCase()} ${a.startTime}-${a.endTime} ${a.notes || ''}`.trim()),
    ...active.filter(s => s.priority !== 'Elective' && s.status !== 'Completed').map(s => `${s.priority} case ${s.scheduleCode} at ${s.startTime}.`)];
  const uMap = new Map(users.map(x => [String(x._id), x]));
  res.json({
    date: dstr(d),
    stats: { totalSchedules: await C.sched.countDocuments(), today: active.length, cancelled: changed.filter(s => s.status === 'Cancelled').length, rescheduled: changed.filter(s => s.status === 'Rescheduled').length, totalCases: await C.cases.countDocuments() },
    dailySchedule: await views(day),
    roomUse: rooms.map(r => { const l = active.filter(s => s.roomId.equals(r._id)); const m = l.reduce((n, s) => n + s.durationMinutes, 0); return { roomCode: r.roomCode, roomName: r.roomName, status: r.status, procedures: l.length, bookedMinutes: m, utilization: Math.min(100, Math.round(m * 100 / (OPEN_TO - OPEN_FROM))) }; }),
    changes: await views(changed), alerts,
    audit: logs.map(a => { const x = uMap.get(String(a.userId)); return { id: String(a._id), user: x ? `${x.username} (${x.role})` : 'unknown', action: a.action, entityType: a.entityType, details: a.details, timestamp: a.timestamp, ipAddress: a.ipAddress }; })
  });
});
get('/api/admin/users', async (req, res) => {
  need(req, 'Administrator'); const l = await C.users.find().sort({ username: 1 }).toArray();
  res.json(l.map(x => ({ id: String(x._id), username: x.username, fullName: x.fullName, role: x.role, status: x.status, createdAt: x.createdAt })));
});
post('/api/admin/users', async (req, res) => {
  const s = need(req, 'Administrator'), r = req.body || {};
  if (blank(r.username) || blank(r.fullName)) fail(400, 'Username and full name are required.');
  if (!r.password || r.password.length < 6) fail(400, 'Password must be at least 6 characters.');
  if (!['Administrator', 'Scheduler', 'SurgicalStaff'].includes(r.role)) fail(400, 'Role must be Administrator, Scheduler, or SurgicalStaff.');
  const ins = await C.users.insertOne({ username: r.username.trim(), passwordHash: hash(r.password), fullName: r.fullName.trim(), role: r.role, status: 'Active', createdAt: new Date() });
  await audit(s, 'Create', 'users', ins.insertedId, `Created ${r.role} account ${r.username.trim()}`, req);
  res.json({ id: String(ins.insertedId), message: `Account ${r.username.trim()} created.` });
});

put('/api/admin/users/:id', async (req, res) => {
  const me = need(req, 'Administrator'), r = req.body || {}, o = oid(req.params.id);
  const u = o && await C.users.findOne({ _id: o }); if (!u) fail(404, 'Account not found.');
  const self = String(u._id) === String(me.userId), set = {};
  if (r.fullName !== undefined) { if (blank(r.fullName)) fail(400, 'Full name is required.'); if (r.fullName.trim() !== u.fullName) set.fullName = r.fullName.trim(); }
  if (r.role !== undefined && r.role !== u.role) {
    if (!['Administrator', 'Scheduler', 'SurgicalStaff'].includes(r.role)) fail(400, 'Role must be Administrator, Scheduler, or SurgicalStaff.');
    if (self) fail(409, 'You cannot change your own role.'); set.role = r.role;
  }
  if (r.status !== undefined && r.status !== u.status) {
    if (!['Active', 'Inactive'].includes(r.status)) fail(400, 'Status must be Active or Inactive.');
    if (self) fail(409, 'You cannot deactivate your own account.'); set.status = r.status;
  }
  if (r.password) { if (r.password.length < 6) fail(400, 'Password must be at least 6 characters.'); set.passwordHash = hash(r.password); }
  if (!Object.keys(set).length) fail(400, 'No changes were provided.');
  await C.users.updateOne({ _id: u._id }, { $set: set });
  if (!self && (set.role || set.status || set.passwordHash)) dropSessions(u._id);
  const what = Object.keys(set).map(k => k === 'passwordHash' ? 'password reset' : `${k} -> ${set[k]}`).join(', ');
  await audit(me, 'Update', 'users', u._id, `Updated account ${u.username}: ${what}`, req);
  res.json({ id: String(u._id), message: `Account ${u.username} updated.` });
});
del('/api/admin/users/:id', async (req, res) => {
  const me = need(req, 'Administrator'), o = oid(req.params.id);
  const u = o && await C.users.findOne({ _id: o }); if (!u) fail(404, 'Account not found.');
  if (String(u._id) === String(me.userId)) fail(409, 'You cannot delete your own account.');
  const linked = await C.cases.countDocuments({ registeredBy: u._id }) + await C.sched.countDocuments({ $or: [{ scheduledBy: u._id }, { 'teamMembers.userId': u._id }] });
  if (linked) fail(409, 'This account is linked to cases or schedules. Set it to Inactive instead of deleting it.');
  await C.users.deleteOne({ _id: u._id }); dropSessions(u._id);
  await audit(me, 'Delete', 'users', u._id, `Deleted ${u.role} account ${u.username}`, req);
  res.json({ message: `Account ${u.username} deleted.` });
});

app.use('/api', (req, res) => res.status(404).json({ message: 'API route not found.' }));
app.use((err, req, res, next) => { 
  let code = 500, msg = 'Unexpected server error. Please try again or contact the administrator.';
  if (err instanceof ApiError) { code = err.code; msg = err.message; }
  else if (err.type === 'entity.parse.failed') { code = 400; msg = 'Invalid or missing request information.'; }
  else if (err.code === 11000) { code = 409; msg = 'A record with the same unique reference already exists.'; }
  else if (/^Mongo/.test(err.name || '')) { code = 503; msg = 'The database is unavailable. Check the MongoDB service and /api/health.'; console.error(err); }
  else console.error(err);
  res.status(code).json({ message: msg });
});

async function startServer() {
  // 1. Start listening FIRST so Render detects the port immediately
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
  });

  // 2. Connect to MongoDB AFTER the port is open
  try {
    console.log("Connecting to MongoDB...");
    const client = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    db = client.db(DBN);

    C.users = db.collection('users');
    C.patients = db.collection('patients');
    C.cases = db.collection('surgical_cases');
    C.rooms = db.collection('rooms');
    C.avail = db.collection('room_availability');
    C.sched = db.collection('surgical_schedules');
    C.audit = db.collection('audit_logs');

    console.log("Successfully connected to MongoDB.");

    process.on('SIGTERM', () => {
      server.close(() => {
        client.close(false).then(() => process.exit(0));
      });
    });

  } catch (err) {
    console.error("FATAL: Could not connect to MongoDB. Check your MONGODB_URI and Atlas Network Access settings.");
    console.error(err);
    process.exit(1); 
  }
}

startServer();