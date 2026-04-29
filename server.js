const express = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "timeclock-data.json");

// ── Data helpers ──────────────────────────────────────────────────────────────
function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return { employees: [], punches: [] };
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch { return { employees: [], punches: [] }; }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── API Routes ────────────────────────────────────────────────────────────────

// Get all data
app.get("/api/data", (req, res) => {
  res.json(readData());
});

// Add employee
app.post("/api/employees", (req, res) => {
  const { key, name } = req.body;
  if (!key || !name) return res.status(400).json({ error: "key and name required" });
  const data = readData();
  if (data.employees.find(e => String(e.key) === String(key))) {
    return res.status(409).json({ error: "Employee # already exists" });
  }
  data.employees.push({ key: String(key), name });
  writeData(data);
  res.json({ success: true });
});

// Bulk import employees
app.post("/api/employees/bulk", (req, res) => {
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

// Remove employee
app.delete("/api/employees/:key", (req, res) => {
  const data = readData();
  data.employees = data.employees.filter(e => e.key !== req.params.key);
  data.punches   = data.punches.filter(p => p.empKey !== req.params.key);
  writeData(data);
  res.json({ success: true });
});

// Clock in
app.post("/api/punches/in", (req, res) => {
  const { empKey, empName } = req.body;
  const data = readData();
  // Check not already clocked in
  const active = data.punches.find(p => p.empKey === empKey && !p.out);
  if (active) return res.status(409).json({ error: "Already clocked in" });
  const punch = { id: Date.now().toString(), empKey, empName, in: new Date().toISOString(), out: null };
  data.punches.push(punch);
  writeData(data);
  res.json({ success: true, punch });
});

// Clock out
app.post("/api/punches/out", (req, res) => {
  const { empKey } = req.body;
  const data = readData();
  const idx = data.punches.findIndex(p => p.empKey === empKey && !p.out);
  if (idx === -1) return res.status(404).json({ error: "No active punch found" });
  data.punches[idx].out = new Date().toISOString();
  writeData(data);
  res.json({ success: true, punch: data.punches[idx] });
});

// Export iSolved CSV
app.get("/api/export/isolved", (req, res) => {
  const data = readData();
  const map = {};
  data.punches.filter(p => p.out).forEach(p => {
    const hours = (new Date(p.out) - new Date(p.in)) / 3600000;
    const date  = new Date(p.in).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const k     = `${p.empKey}||${date}`;
    if (!map[k]) map[k] = { key: p.empKey, name: p.empName, hours: 0 };
    map[k].hours += hours;
  });
  const rows = Object.values(map);
  const header = "Key,LaborValue2,LaborValue3,#Name,E_Regular_Hours,E_Overtime_Hours,E_Vacation_Hours,E_Sick_Hours,E_Holiday_Hours,E_Training_Hours,E_Regular_ORRate,E_Overtime_ORRate,E_Vacation_ORRate,E_Sick_ORRate,E_Holiday_ORRate,E_Training_ORRate,E_Double_Time_Hours,E_Double_Time_ORRate";
  const lines = rows.map(r => {
    const reg = Math.min(r.hours, 40).toFixed(2);
    const ot  = Math.max(0, r.hours - 40).toFixed(2);
    return `${r.key},,,${r.name},${reg},${ot},0,0,0,0,,,,,,,0,`;
  });
  const csv = [header, ...lines].join("\n");
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="payroll_${date}.csv"`);
  res.send(csv);
});

// ── Show network IP on start ──────────────────────────────────────────────────
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "localhost";
}

app.listen(PORT, "0.0.0.0", () => {
  const ip = getLocalIP();
  console.log("\n==========================================");
  console.log("  TIMECLOCK SERVER RUNNING");
  console.log("==========================================");
  console.log(`  This laptop:   http://localhost:${PORT}`);
  console.log(`  Other laptops: http://${ip}:${PORT}`);
  console.log("==========================================");
  console.log("  Share the 'Other laptops' address");
  console.log("  with your other 2 laptops on the");
  console.log("  same Wi-Fi hotspot.");
  console.log("==========================================\n");
});
