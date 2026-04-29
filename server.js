const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "timeclock-data.json");

const USERNAME = "admin";
const PASSWORD = "f1mia";
const sessions = new Set();

function generateToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return { employees: [], punches: [] };
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch { return { employees: [], punches: [] }; }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

app.use(express.json());

function requireAuth(req, res, next) {
  const token = req.headers["x-auth-token"];
  if (!token || !sessions.has(token)) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// Public routes
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (username === USERNAME && password === PASSWORD) {
    const token = generateToken();
    sessions.add(token);
    res.json({ success: true, token });
  } else {
    res.status(401).json({ error: "Invalid username or password" });
  }
});

app.post("/api/logout", (req, res) => {
  const token = req.headers["x-auth-token"];
  if (token) sessions.delete(token);
  res.json({ success: true });
});

// Serve login page at root, app at /app
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/app", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// Protected API
app.get("/api/data", requireAuth, (req, res) => res.json(readData()));

app.post("/api/employees", requireAuth, (req, res) => {
  const { key, name } = req.body;
  if (!key || !name) return res.status(400).json({ error: "key and name required" });
  const data = readData();
  if (data.employees.find(e => String(e.key) === String(key))) return res.status(409).json({ error: "Employee # already exists" });
  data.employees.push({ key: String(key), name });
  writeData(data);
  res.json({ success: true });
});

app.post("/api/employees/bulk", requireAuth, (req, res) => {
  const { employees } = req.body;
  if (!Array.isArray(employees)) return res.status(400).json({ error: "employees array required" });
  const data = readData();
  let added = 0, skipped = 0;
  employees.forEach(({ key, name }) => {
    if (!key || !name) return;
    if (data.employees.find(e => String(e.key) === String(key))) { skipped++; return; }
    data.employees.push({ key: String(key), name });
    added++;
  });
  writeData(data);
  res.json({ added, skipped });
});

app.delete("/api/employees/:key", requireAuth, (req, res) => {
  const data = readData();
  data.employees = data.employees.filter(e => e.key !== req.params.key);
  data.punches   = data.punches.filter(p => p.empKey !== req.params.key);
  writeData(data);
  res.json({ success: true });
});

app.post("/api/punches/in", requireAuth, (req, res) => {
  const { empKey, empName } = req.body;
  const data = readData();
  if (data.punches.find(p => p.empKey === empKey && !p.out)) return res.status(409).json({ error: "Already clocked in" });
  const punch = { id: Date.now().toString(), empKey, empName, in: new Date().toISOString(), out: null };
  data.punches.push(punch);
  writeData(data);
  res.json({ success: true, punch });
});

app.post("/api/punches/out", requireAuth, (req, res) => {
  const { empKey } = req.body;
  const data = readData();
  const idx = data.punches.findIndex(p => p.empKey === empKey && !p.out);
  if (idx === -1) return res.status(404).json({ error: "No active punch found" });
  data.punches[idx].out = new Date().toISOString();
  writeData(data);
  res.json({ success: true, punch: data.punches[idx] });
});

app.get("/api/export/isolved", requireAuth, (req, res) => {
  const data = readData();
  const map = {};
  data.punches.filter(p => p.out).forEach(p => {
    const hours = (new Date(p.out) - new Date(p.in)) / 3600000;
    const date  = new Date(p.in).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const k = `${p.empKey}||${date}`;
    if (!map[k]) map[k] = { key: p.empKey, name: p.empName, hours: 0 };
    map[k].hours += hours;
  });
  const rows = Object.values(map);
  const header = "Key,LaborValue2,LaborValue3,#Name,E_Regular_Hours,E_Overtime_Hours,E_Vacation_Hours,E_Sick_Hours,E_Holiday_Hours,E_Training_Hours,E_Regular_ORRate,E_Overtime_ORRate,E_Vacation_ORRate,E_Sick_ORRate,E_Holiday_ORRate,E_Training_ORRate,E_Double_Time_Hours,E_Double_Time_ORRate";
  const lines = rows.map(r => `${r.key},,,${r.name},${Math.min(r.hours,40).toFixed(2)},${Math.max(0,r.hours-40).toFixed(2)},0,0,0,0,,,,,,,0,`);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="payroll_${new Date().toISOString().slice(0,10)}.csv"`);
  res.send([header, ...lines].join("\n"));
});

app.listen(PORT, "0.0.0.0", () => console.log(`ISI TimeClock running on port ${PORT}`));
