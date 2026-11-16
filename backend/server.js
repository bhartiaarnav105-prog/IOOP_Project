import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve DATA_DIR across local dev and cloud environments (Render)
function resolveDataDir() {
  if (process.env.DATA_DIR) {
    return path.resolve(process.env.DATA_DIR);
  }
  // Standard location when server runs from backend/
  const candidate1 = path.resolve(__dirname, '../RESQ/data');
  if (fs.existsSync(candidate1)) return candidate1;

  // If server is started from root repo directory
  const candidate2 = path.resolve(process.cwd(), 'RESQ/data');
  if (fs.existsSync(candidate2)) return candidate2;

  // Fallback to parent
  const candidate3 = path.resolve(process.cwd(), '../RESQ/data');
  if (fs.existsSync(candidate3)) return candidate3;

  return candidate1;
}

const DATA_DIR = resolveDataDir();
const DELIM = '|';

// Ensure data directory and files exist
function ensureFile(filename, defaultContent = '') {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(filePath, defaultContent, 'utf-8');
  }
  return filePath;
}

function readLines(filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  return content
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'));
}

function writeLines(filename, lines) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(filePath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf-8');
}

function appendLine(filename, line) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.appendFileSync(filePath, line + '\n', 'utf-8');
}

function genId(prefix, filename) {
  let maxN = 0;
  const lines = readLines(filename);
  for (const line of lines) {
    const tok = line.split(DELIM);
    if (tok.length > 0 && tok[0].startsWith(prefix)) {
      const n = parseInt(tok[0].slice(prefix.length), 10);
      if (!isNaN(n) && n > maxN) maxN = n;
    }
  }
  return `${prefix}${String(maxN + 1).padStart(3, '0')}`;
}

// C++ 64-bit polynomial hash implementation (DJB2)
function hashPassword(password) {
  let hash = 5381n;
  for (let i = 0; i < password.length; i++) {
    hash = (((hash << 5n) + hash) + BigInt(password.charCodeAt(i))) & 0xFFFFFFFFFFFFFFFFn;
  }
  return hash.toString(16);
}

function nowTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function nowEpoch() {
  return Math.floor(Date.now() / 1000);
}

// Graph and Dijkstra routing
function getGraph() {
  const lines = readLines('cities.txt');
  const cities = {};
  const adj = {};
  for (const line of lines) {
    const tok = line.split(DELIM);
    if (tok[0] === 'CITY' && tok.length >= 3) {
      const id = parseInt(tok[1], 10);
      cities[id] = { id, name: tok[2] };
      if (!adj[id]) adj[id] = [];
    } else if (tok[0] === 'ROAD' && tok.length >= 4) {
      const u = parseInt(tok[1], 10);
      const v = parseInt(tok[2], 10);
      const w = parseInt(tok[3], 10);
      if (!adj[u]) adj[u] = [];
      if (!adj[v]) adj[v] = [];
      adj[u].push({ to: v, weight: w });
      adj[v].push({ to: u, weight: w });
    }
  }
  return { cities, adj };
}

function dijkstra(graph, src) {
  const dist = {};
  const pred = {};
  const visited = new Set();
  for (const id in graph.cities) {
    dist[id] = Infinity;
    pred[id] = null;
  }
  dist[src] = 0;

  while (true) {
    let u = null;
    let minDist = Infinity;
    for (const id in dist) {
      const numId = parseInt(id, 10);
      if (!visited.has(numId) && dist[id] < minDist) {
        minDist = dist[id];
        u = numId;
      }
    }
    if (u === null) break;
    visited.add(u);

    const edges = graph.adj[u] || [];
    for (const edge of edges) {
      const v = edge.to;
      const nd = dist[u] + edge.weight;
      if (nd < dist[v]) {
        dist[v] = nd;
        pred[v] = u;
      }
    }
  }
  return { dist, pred };
}

function shortestPath(graph, src, dst) {
  if (!graph.cities[src] || !graph.cities[dst]) return [];
  const { dist, pred } = dijkstra(graph, src);
  if (dist[dst] === Infinity) return [];
  const path = [];
  let cur = dst;
  while (cur !== null && cur !== undefined) {
    path.push(cur);
    cur = pred[cur];
  }
  path.reverse();
  return path;
}

function formatPath(graph, path) {
  if (!path || path.length === 0) return 'No route available';
  return path.map(id => graph.cities[id]?.name || `City ${id}`).join(' -> ');
}

// Data parser helpers
function parseUsers() {
  const lines = readLines('users.txt');
  return lines.map(line => {
    const tok = line.split(DELIM);
    if (tok[3] === 'ADMIN') {
      return { id: tok[0], username: tok[1], role: 'ADMIN', name: tok[4], hash: tok[2] };
    } else {
      return {
        id: tok[0],
        username: tok[1],
        role: 'PATIENT',
        name: tok[4],
        phone: tok[5],
        address: tok[6],
        cityId: parseInt(tok[7] || '0', 10),
        registeredAt: tok[8],
        hash: tok[2]
      };
    }
  });
}

function parseDoctors() {
  const lines = readLines('doctors.txt');
  return lines.map(line => {
    const tok = line.split(DELIM);
    const slotsObj = {};
    if (tok[9] && tok[9] !== 'NONE') {
      const entries = tok[9].split(';');
      for (const entry of entries) {
        const lastColon = entry.lastIndexOf(':');
        if (lastColon !== -1) {
          slotsObj[entry.slice(0, lastColon)] = entry.slice(lastColon + 1);
        }
      }
    }
    return {
      id: tok[0],
      username: tok[1],
      hash: tok[2],
      role: 'DOCTOR',
      name: tok[4],
      specialization: tok[5],
      type: tok[6], // SPECIALIST or EMERGENCY_PHYSICIAN
      available: tok[7] === '1',
      assignedEmergId: tok[8] === 'NONE' ? '' : tok[8],
      bookedSlots: slotsObj
    };
  });
}

function serializeDoctor(doc) {
  const slotEntries = Object.entries(doc.bookedSlots || {}).map(([k, v]) => `${k}:${v}`);
  const slotsStr = slotEntries.length ? slotEntries.join(';') : 'NONE';
  return [
    doc.id,
    doc.username,
    doc.hash,
    'DOCTOR',
    doc.name,
    doc.specialization,
    doc.type,
    doc.available ? '1' : '0',
    doc.assignedEmergId || 'NONE',
    slotsStr
  ].join(DELIM);
}

function parseAmbulances() {
  const lines = readLines('ambulances.txt');
  return lines.map(line => {
    const tok = line.split(DELIM);
    return {
      id: tok[0],
      status: tok[1], // AVAILABLE or DISPATCHED
      currentCityId: parseInt(tok[2] || '0', 10),
      assignedEmergId: tok[3] === 'NONE' ? '' : tok[3],
      capabilities: tok[4]
    };
  });
}

function serializeAmbulance(a) {
  return [
    a.id,
    a.status,
    a.currentCityId,
    a.assignedEmergId || 'NONE',
    a.capabilities
  ].join(DELIM);
}

const SEVERITY_VALS = { CRITICAL: 1, HIGH: 2, MODERATE: 3, LOW: 4 };

function parseEmergencies() {
  const lines = readLines('emergencies.txt');
  return lines.map(line => {
    const tok = line.split(DELIM);
    return {
      id: tok[0],
      patientId: tok[1],
      cityId: parseInt(tok[2] || '0', 10),
      category: tok[3],
      severity: tok[4],
      severityVal: SEVERITY_VALS[tok[4]] || 4,
      requestTimestamp: tok[5],
      epochTime: parseInt(tok[6] || '0', 10),
      seqNum: parseInt(tok[7] || '0', 10),
      assignedAmbId: tok[8] === 'NONE' ? '' : tok[8],
      physician1Id: tok[9] === 'NONE' ? '' : tok[9],
      physician2Id: tok[10] === 'NONE' ? '' : tok[10],
      status: tok[11], // PENDING, DISPATCHED, COMPLETED, CANCELLED
      outboundRoute: tok[12] === 'NONE' ? '' : tok[12],
      returnRoute: tok[13] === 'NONE' ? '' : tok[13],
      distanceKm: parseInt(tok[14] || '0', 10),
      completedAt: tok[15] === 'NONE' || !tok[15] ? '' : tok[15]
    };
  });
}

function serializeEmergency(e) {
  const val = (s) => (s && s.length ? s : 'NONE');
  return [
    e.id,
    e.patientId,
    e.cityId,
    e.category,
    e.severity,
    e.requestTimestamp,
    e.epochTime,
    e.seqNum,
    val(e.assignedAmbId),
    val(e.physician1Id),
    val(e.physician2Id),
    e.status,
    val(e.outboundRoute),
    val(e.returnRoute),
    e.distanceKm,
    val(e.completedAt)
  ].join(DELIM);
}

function parseAppointments() {
  const lines = readLines('appointments.txt');
  return lines.map(line => {
    const tok = line.split(DELIM);
    return {
      id: tok[0],
      patientId: tok[1],
      doctorId: tok[2],
      specialization: tok[3],
      date: tok[4],
      timeSlot: tok[5],
      reason: tok[6],
      status: tok[7], // PENDING, CONFIRMED, CANCELLED, COMPLETED
      bookedAt: tok[8]
    };
  });
}

function serializeAppointment(a) {
  return [
    a.id,
    a.patientId,
    a.doctorId,
    a.specialization,
    a.date,
    a.timeSlot,
    a.reason,
    a.status,
    a.bookedAt
  ].join(DELIM);
}

// ----------------------------------------------------
// Express Application Setup
// ----------------------------------------------------
const app = express();
const PORT = process.env.PORT || 5000;

// CORS configuration supporting Vercel and local origins
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : null;

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (Postman, curl, server-to-server)
    if (!origin) return callback(null, true);
    
    // Whitelist check if explicitly configured
    if (allowedOrigins && (allowedOrigins.includes('*') || allowedOrigins.includes(origin))) {
      return callback(null, true);
    }

    // By default allow localhost and Vercel preview/production deployments
    if (/^https:\/\/.*\.vercel\.app$/.test(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }

    // Fallback permit for public demo API
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// ----------------------------------------------------
// Health & Root Status
// ----------------------------------------------------
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'RESQ Hospital Emergency & Appointment Management API',
    dataDir: DATA_DIR,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ----------------------------------------------------
// Authentication Routes
// ----------------------------------------------------
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const hash = hashPassword(password);
  const users = parseUsers();
  const matchedUser = users.find(u => u.username === username && u.hash === hash);
  if (matchedUser) {
    const { hash: _, ...safeUser } = matchedUser;
    return res.status(200).json({ user: safeUser });
  }

  const doctors = parseDoctors();
  const matchedDoc = doctors.find(d => d.username === username && d.hash === hash);
  if (matchedDoc) {
    const { hash: _, ...safeDoc } = matchedDoc;
    return res.status(200).json({ user: safeDoc });
  }

  return res.status(401).json({ error: 'Invalid username or password' });
});

app.post('/api/auth/register', (req, res) => {
  const { username, password, name, phone, address, cityId } = req.body;
  if (!username || !password || !name) {
    return res.status(400).json({ error: 'Username, password, and name are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const users = parseUsers();
  if (users.some(u => u.username === username)) {
    return res.status(400).json({ error: `Username '${username}' is already taken` });
  }

  const id = genId('PAT', 'users.txt');
  const hash = hashPassword(password);
  const regAt = nowTimestamp();
  const line = [id, username, hash, 'PATIENT', name, phone || '', address || '', cityId || 0, regAt].join(DELIM);
  appendLine('users.txt', line);

  return res.status(200).json({
    success: true,
    user: {
      id,
      username,
      role: 'PATIENT',
      name,
      phone: phone || '',
      address: address || '',
      cityId: parseInt(cityId || 0, 10),
      registeredAt: regAt
    }
  });
});

// ----------------------------------------------------
// Cities & Route Calculation Routes
// ----------------------------------------------------
app.get('/api/cities', (req, res) => {
  const graph = getGraph();
  return res.status(200).json({
    cities: Object.values(graph.cities),
    roads: graph.adj
  });
});

app.get('/api/route', (req, res) => {
  const from = parseInt(req.query.from, 10);
  const to = parseInt(req.query.to, 10);
  const graph = getGraph();

  if (isNaN(from) || isNaN(to) || !graph.cities[from] || !graph.cities[to]) {
    return res.status(400).json({ error: 'Invalid city IDs' });
  }

  const pathArr = shortestPath(graph, from, to);
  const { dist } = dijkstra(graph, from);
  const distanceKm = dist[to] === Infinity ? -1 : dist[to];

  return res.status(200).json({
    from: graph.cities[from],
    to: graph.cities[to],
    path: pathArr,
    pathFormatted: formatPath(graph, pathArr),
    distanceKm
  });
});

// ----------------------------------------------------
// Doctor Management Routes
// ----------------------------------------------------
app.get('/api/doctors', (req, res) => {
  const doctors = parseDoctors().map(({ hash, ...d }) => d);
  return res.status(200).json({ doctors });
});

app.post('/api/doctors', (req, res) => {
  const { username, password, name, specialization, type } = req.body;
  if (!username || !password || !name) {
    return res.status(400).json({ error: 'Username, password, and name are required' });
  }

  const doctors = parseDoctors();
  if (doctors.some(d => d.username === username)) {
    return res.status(400).json({ error: `Doctor username '${username}' already exists` });
  }

  const id = genId('DOC', 'doctors.txt');
  const hash = hashPassword(password);
  const newDoc = {
    id,
    username,
    hash,
    role: 'DOCTOR',
    name,
    specialization: specialization || 'General Medicine',
    type: type === 'EMERGENCY_PHYSICIAN' ? 'EMERGENCY_PHYSICIAN' : 'SPECIALIST',
    available: true,
    assignedEmergId: '',
    bookedSlots: {}
  };

  appendLine('doctors.txt', serializeDoctor(newDoc));
  const { hash: _, ...safeDoc } = newDoc;
  return res.status(200).json({ success: true, doctor: safeDoc });
});

app.post('/api/doctors/toggle-availability', (req, res) => {
  const { doctorId } = req.body;
  const doctors = parseDoctors();
  const doc = doctors.find(d => d.id === doctorId);
  if (!doc) return res.status(404).json({ error: 'Doctor not found' });

  doc.available = !doc.available;
  writeLines('doctors.txt', doctors.map(serializeDoctor));
  return res.status(200).json({ success: true, available: doc.available });
});

// ----------------------------------------------------
// Ambulance Fleet Routes
// ----------------------------------------------------
app.get('/api/ambulances', (req, res) => {
  const ambulances = parseAmbulances();
  return res.status(200).json({ ambulances });
});

// ----------------------------------------------------
// Appointment Scheduling Routes
// ----------------------------------------------------
app.get('/api/appointments', (req, res) => {
  const appts = parseAppointments();
  return res.status(200).json({ appointments: appts });
});

app.post('/api/appointments', (req, res) => {
  const { patientId, doctorId, date, timeSlot, reason } = req.body;
  if (!patientId || !doctorId || !date || !timeSlot) {
    return res.status(400).json({ error: 'Missing required appointment parameters' });
  }

  const APPT_TIMES = ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00"];
  if (!APPT_TIMES.includes(timeSlot)) {
    return res.status(400).json({ error: 'Invalid time slot' });
  }

  const doctors = parseDoctors();
  const doc = doctors.find(d => d.id === doctorId);
  if (!doc) return res.status(404).json({ error: 'Doctor not found' });
  if (doc.type === 'EMERGENCY_PHYSICIAN') {
    return res.status(400).json({ error: 'Emergency physicians cannot take routine appointments' });
  }

  const slotKey = `${date}|${timeSlot}`;
  if (doc.bookedSlots && doc.bookedSlots[slotKey]) {
    return res.status(400).json({ error: `Slot ${timeSlot} on ${date} is already booked` });
  }

  const appts = parseAppointments();
  // Check patient collision on same date & time
  const patientConflict = appts.find(a =>
    a.patientId === patientId &&
    a.date === date &&
    a.timeSlot === timeSlot &&
    a.status !== 'CANCELLED'
  );
  if (patientConflict) {
    return res.status(400).json({ error: `You already have an appointment at ${timeSlot} on ${date}` });
  }

  const id = genId('APT', 'appointments.txt');
  const bookedAt = nowTimestamp();
  const newAppt = {
    id,
    patientId,
    doctorId: doc.id,
    specialization: doc.specialization,
    date,
    timeSlot,
    reason: reason || 'General Consultation',
    status: 'CONFIRMED',
    bookedAt
  };

  // Add slot to doctor and save
  doc.bookedSlots[slotKey] = id;
  writeLines('doctors.txt', doctors.map(serializeDoctor));
  appendLine('appointments.txt', serializeAppointment(newAppt));

  return res.status(200).json({ success: true, appointment: newAppt });
});

app.post('/api/appointments/:id/cancel', (req, res) => {
  const apptId = req.params.id;
  const appts = parseAppointments();
  const appt = appts.find(a => a.id === apptId);
  if (!appt) return res.status(404).json({ error: 'Appointment not found' });
  if (appt.status === 'CANCELLED') return res.status(400).json({ error: 'Already cancelled' });
  if (appt.status === 'COMPLETED') return res.status(400).json({ error: 'Completed appointments cannot be cancelled' });

  appt.status = 'CANCELLED';
  writeLines('appointments.txt', appts.map(serializeAppointment));

  // Free slot in doctor
  const doctors = parseDoctors();
  const doc = doctors.find(d => d.id === appt.doctorId);
  if (doc && doc.bookedSlots) {
    const slotKey = `${appt.date}|${appt.timeSlot}`;
    delete doc.bookedSlots[slotKey];
    writeLines('doctors.txt', doctors.map(serializeDoctor));
  }

  return res.status(200).json({ success: true, message: 'Appointment cancelled' });
});

app.post('/api/appointments/:id/complete', (req, res) => {
  const apptId = req.params.id;
  const appts = parseAppointments();
  const appt = appts.find(a => a.id === apptId);
  if (!appt) return res.status(404).json({ error: 'Appointment not found' });
  if (appt.status === 'CANCELLED') return res.status(400).json({ error: 'Cannot complete a cancelled appointment' });

  appt.status = 'COMPLETED';
  writeLines('appointments.txt', appts.map(serializeAppointment));
  return res.status(200).json({ success: true, message: 'Appointment marked completed' });
});

// ----------------------------------------------------
// Emergency Dispatch Routes
// ----------------------------------------------------
app.get('/api/emergencies', (req, res) => {
  const emergencies = parseEmergencies();
  return res.status(200).json({ emergencies });
});

app.post('/api/emergencies', (req, res) => {
  const { patientId, cityId, category, severity } = req.body;
  if (!patientId || cityId === undefined || !category || !severity) {
    return res.status(400).json({ error: 'Missing emergency request parameters' });
  }

  const id = genId('EMG', 'emergencies.txt');
  const ep = nowEpoch();
  const existing = parseEmergencies();
  const nextSeq = (existing.reduce((max, e) => Math.max(max, e.seqNum || 0), 0)) + 1;
  const newEmg = {
    id,
    patientId,
    cityId: parseInt(cityId, 10),
    category,
    severity,
    severityVal: SEVERITY_VALS[severity] || 4,
    requestTimestamp: nowTimestamp(),
    epochTime: ep,
    seqNum: nextSeq,
    assignedAmbId: '',
    physician1Id: '',
    physician2Id: '',
    status: 'PENDING',
    outboundRoute: '',
    returnRoute: '',
    distanceKm: 0,
    completedAt: ''
  };

  appendLine('emergencies.txt', serializeEmergency(newEmg));
  return res.status(200).json({ success: true, emergency: newEmg });
});

app.post('/api/emergencies/dispatch-next', (req, res) => {
  const emergencies = parseEmergencies();
  const pending = emergencies.filter(e => e.status === 'PENDING');
  if (pending.length === 0) {
    return res.status(400).json({ error: 'No pending emergencies in the queue' });
  }

  // Priority queue comparator (Severity -> Epoch -> SeqNum)
  pending.sort((a, b) => {
    if (a.severityVal !== b.severityVal) return a.severityVal - b.severityVal;
    if (a.epochTime !== b.epochTime) return a.epochTime - b.epochTime;
    return a.seqNum - b.seqNum;
  });
  const topEmg = pending[0];

  // Check ambulance availability
  const ambulances = parseAmbulances();
  const availableAmb = ambulances.find(a => a.status === 'AVAILABLE');
  if (!availableAmb) {
    return res.status(400).json({ error: 'No ambulances available. Emergency remains pending.' });
  }

  // Check EP availability (requires 2)
  const doctors = parseDoctors();
  const availableEPs = doctors.filter(d => d.type === 'EMERGENCY_PHYSICIAN' && d.available);
  if (availableEPs.length < 2) {
    return res.status(400).json({ error: 'All emergency physicians are occupied. New emergency requests remain pending.' });
  }

  // Calculate route
  const graph = getGraph();
  const HOSPITAL_CITY_ID = 0;
  if (!graph.cities[topEmg.cityId]) {
    return res.status(400).json({ error: `Patient city ID ${topEmg.cityId} not found in road network` });
  }

  const outPath = shortestPath(graph, HOSPITAL_CITY_ID, topEmg.cityId);
  if (outPath.length === 0) {
    return res.status(400).json({ error: `No route found from hospital to city ${graph.cities[topEmg.cityId]?.name}. Emergency remains pending.` });
  }
  const retPath = shortestPath(graph, topEmg.cityId, HOSPITAL_CITY_ID);
  const { dist } = dijkstra(graph, HOSPITAL_CITY_ID);
  const distanceKm = dist[topEmg.cityId];

  // Atomic allocation
  const ep1 = availableEPs[0];
  const ep2 = availableEPs[1];
  ep1.available = false;
  ep1.assignedEmergId = topEmg.id;
  ep2.available = false;
  ep2.assignedEmergId = topEmg.id;

  availableAmb.status = 'DISPATCHED';
  availableAmb.assignedEmergId = topEmg.id;
  availableAmb.currentCityId = topEmg.cityId;

  topEmg.assignedAmbId = availableAmb.id;
  topEmg.physician1Id = ep1.id;
  topEmg.physician2Id = ep2.id;
  topEmg.outboundRoute = formatPath(graph, outPath);
  topEmg.returnRoute = formatPath(graph, retPath);
  topEmg.distanceKm = distanceKm;
  topEmg.status = 'DISPATCHED';

  // Persist all updates
  writeLines('doctors.txt', doctors.map(serializeDoctor));
  writeLines('ambulances.txt', ambulances.map(serializeAmbulance));
  writeLines('emergencies.txt', emergencies.map(serializeEmergency));

  return res.status(200).json({
    success: true,
    dispatchedEmergency: topEmg,
    ambulance: availableAmb,
    physicians: [ep1.name, ep2.name]
  });
});

app.post('/api/emergencies/:id/complete', (req, res) => {
  const emergId = req.params.id;
  const emergencies = parseEmergencies();
  const emg = emergencies.find(e => e.id === emergId);
  if (!emg) return res.status(404).json({ error: 'Emergency not found' });
  if (emg.status !== 'DISPATCHED') {
    return res.status(400).json({ error: `Emergency ${emergId} is not currently DISPATCHED` });
  }

  // Release ambulance back to hospital hub
  const ambulances = parseAmbulances();
  const amb = ambulances.find(a => a.id === emg.assignedAmbId);
  if (amb) {
    amb.status = 'AVAILABLE';
    amb.assignedEmergId = 'NONE';
    amb.currentCityId = 0;
    writeLines('ambulances.txt', ambulances.map(serializeAmbulance));
  }

  // Release emergency physicians
  const doctors = parseDoctors();
  for (const doc of doctors) {
    if (doc.id === emg.physician1Id || doc.id === emg.physician2Id) {
      doc.available = true;
      doc.assignedEmergId = 'NONE';
    }
  }
  writeLines('doctors.txt', doctors.map(serializeDoctor));

  emg.status = 'COMPLETED';
  emg.completedAt = nowTimestamp();
  writeLines('emergencies.txt', emergencies.map(serializeEmergency));

  return res.status(200).json({
    success: true,
    message: `Emergency ${emergId} completed. Resources returned.`
  });
});

// ----------------------------------------------------
// Patients Registry (Admin)
// ----------------------------------------------------
app.get('/api/patients', (req, res) => {
  const users = parseUsers().filter(u => u.role === 'PATIENT').map(({ hash, ...u }) => u);
  return res.status(200).json({ patients: users });
});

// ----------------------------------------------------
// System Aggregate Statistics
// ----------------------------------------------------
app.get('/api/stats', (req, res) => {
  const users = parseUsers();
  const patients = users.filter(u => u.role === 'PATIENT').length;
  const doctors = parseDoctors();
  const specialistDocs = doctors.filter(d => d.type === 'SPECIALIST').length;
  const epDocs = doctors.filter(d => d.type === 'EMERGENCY_PHYSICIAN');
  const epAvail = epDocs.filter(d => d.available).length;
  const epBusy = epDocs.length - epAvail;

  const ambulances = parseAmbulances();
  const ambAvail = ambulances.filter(a => a.status === 'AVAILABLE').length;
  const ambBusy = ambulances.length - ambAvail;

  const emergencies = parseEmergencies();
  const emgPending = emergencies.filter(e => e.status === 'PENDING').length;
  const emgDisp = emergencies.filter(e => e.status === 'DISPATCHED').length;
  const emgComp = emergencies.filter(e => e.status === 'COMPLETED').length;

  const appointments = parseAppointments();
  const apptTotal = appointments.length;
  const apptConfirmed = appointments.filter(a => a.status === 'CONFIRMED').length;
  const apptCompleted = appointments.filter(a => a.status === 'COMPLETED').length;
  const apptCancelled = appointments.filter(a => a.status === 'CANCELLED').length;

  return res.status(200).json({
    patients,
    doctors: doctors.length,
    specialists: specialistDocs,
    ambulances: { total: ambulances.length, available: ambAvail, busy: ambBusy },
    emergencyPhysicians: { total: epDocs.length, available: epAvail, occupied: epBusy },
    emergencies: { total: emergencies.length, pending: emgPending, dispatched: emgDisp, completed: emgComp },
    appointments: { total: apptTotal, confirmed: apptConfirmed, completed: apptCompleted, cancelled: apptCancelled }
  });
});

// Fallback 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.url} not found` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(` RESQ Backend Server running on port ${PORT}`);
  console.log(` Data Directory: ${DATA_DIR}`);
  console.log(`===============================================`);
});
