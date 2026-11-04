/**
 * A4 GODAGAMA - AVISSAWELLA WIDENING (FEASIBILITY STUDY) - ROADSIDE O-D SURVEY
 * APPS SCRIPT BACKEND
 *
 * No login for recorders: every recorder's interviews go to the one
 * Google Sheet this script is attached to. One row per vehicle interviewed,
 * with the station, direction and the GPS position recorded when it was saved.
 * The last columns hold the Value of Time (VOT) data: monthly household
 * income (passenger vehicle owners) and the value of the goods carried
 * (freight vehicles).
 *
 * HOW TO DEPLOY:
 * 1. Create a new Google Sheet (e.g. "A4 Roadside OD Survey Data").
 * 2. In that sheet: Extensions > Apps Script.
 * 3. Delete the sample code, paste ALL of this file, press Ctrl+S.
 * 4. Select the function "setup" in the toolbar and click Run once
 *    (approve the permissions). This creates the data tab and headers.
 * 5. Deploy > New deployment > type "Web app":
 *      Execute as: Me
 *      Who has access: Anyone
 *    Click Deploy and copy the Web app URL (ends in /exec).
 * 6. Paste that URL into config.js in the app (appsScriptUrl).
 *
 * UPDATING THE CODE LATER:
 *    Deploy > Manage deployments > Edit (pencil) > Version: "New version"
 *    > Deploy. The URL stays the same.
 *
 * ADMIN DASHBOARD (admin.html in the app): live progress against the
 * targets in the "Targets" tab, plus the answers analysed. Set the password
 * once: Project Settings (gear) > Script properties > Add script property >
 * ADMIN_PASSWORD = the password. It is not written in this file.
 *
 * SUMMARY + O-D MATRIX: open the sheet, menu "A4 O-D Survey" > Build / refresh
 * summary. It writes a "Summary" tab (counts per answer and survey date) and
 * an "OD Matrix (District)" tab (origin district x destination district,
 * all vehicles, passenger and freight).
 */

const DATA_SHEET_NAME = "a4-roadside-od";
const SUMMARY_SHEET_NAME = "Summary";
const OD_SHEET_NAME = "OD Matrix (District)";

// [sheet header, record field, type]
const COLUMNS = [
  ["Form No", "interviewId", "text"],
  ["Recorder", "name", "text"],
  ["Survey Location", "surveyLocation", "text"],
  ["Direction", "direction", "text"],
  ["Shift Start", "shiftStart", "text"],
  ["Date", "date", "text"],
  ["Time", "time", "text"],
  ["GPS Lat", "gpsLat", "num"],
  ["GPS Lon", "gpsLon", "num"],
  ["GPS Accuracy (m)", "gpsAccuracyM", "num"],
  ["GPS Fix Time", "gpsFixTime", "text"],
  ["GPS Status", "gpsStatus", "text"],
  ["Interview Location Map Link", "locationMapLink", "long"],
  ["Vehicle Category", "vehicleCategory", "text"],
  ["Vehicle Type", "vehicleType", "text"],
  ["Occupancy", "occupancy", "numtext"],
  ["Origin (Village / Town)", "origin", "text"],
  ["Origin Lat", "originLat", "num"],
  ["Origin Lon", "originLon", "num"],
  ["Origin District", "originDistrict", "text"],
  ["Origin Type", "originType", "text"],
  ["Destination (Village / Town)", "destination", "text"],
  ["Destination Lat", "destinationLat", "num"],
  ["Destination Lon", "destinationLon", "num"],
  ["Destination District", "destinationDistrict", "text"],
  ["Destination Type", "destinationType", "text"],
  ["Trip Frequency", "frequency", "text"],
  ["Commodity", "commodity", "text"],
  ["Commodity Detail", "commodityDetail", "text"],
  ["Load Condition", "load", "text"],
  ["Trip Purpose", "tripPurpose", "text"],
  ["Future Use of Kahathuduwa-Ingiriya Expressway", "expressway", "text"],
  ["Respondent Is Vehicle Owner", "isOwner", "text"],
  ["Monthly Household Income", "income", "text"],
  ["Commodity Value (Rs.)", "commodityValue", "numtext"],
  ["Approx. Load", "loadQty", "numtext"],
  ["Load Unit", "loadUnit", "text"],
  ["EventID", "eventId", "text"]
];
const HEADERS = COLUMNS.map(function (c) { return c[0]; });
const EVENT_ID_COL = HEADERS.indexOf("EventID") + 1; // 1-based

// Categorical columns counted on the Summary tab (per survey date).
const SUMMARY_FIELDS = [
  "Survey Location", "Direction", "Vehicle Category", "Vehicle Type", "Occupancy", "Origin District", "Destination District",
  "Origin Type", "Destination Type", "Trip Frequency", "Commodity", "Load Condition", "Trip Purpose",
  "Future Use of Kahathuduwa-Ingiriya Expressway", "Load Unit", "Respondent Is Vehicle Owner", "Monthly Household Income", "GPS Status"
];
const MULTI_FIELDS = []; // no multi-answer questions in this survey
const SEGMENT_COLUMN = "Date"; // Summary columns: one per survey date

const MAX_BATCH_SIZE = 200;
const GLOBAL_RATE_LIMIT_PER_MIN = 300;
const LOCK_WAIT_MS = 30000;

// ---------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------
function doPost(e) { return handleRequest(e); }
function doGet(e) { return handleRequest(e); }

function handleRequest(e) {
  if (!checkGlobalRateLimit()) {
    return responseJson({ status: "error", message: "Too many requests. Please try again shortly." });
  }
  try {
    let data = {};
    if (e && e.postData && e.postData.contents) {
      try { data = JSON.parse(e.postData.contents); } catch (err) {}
    }
    const params = (e && e.parameter) || {};
    for (const key in params) data[key] = params[key];

    const action = data.action;
    // v3 = current app (commodity groups + details, load amount + unit).
    // v1 / v2 records are still accepted; their retired fields are ignored.
    if (/^submit_a4od_v[1-3]$/.test(action || "")) return handleSubmitBatch(data);
    if (action === "admin_stats" || action === "admin_set_targets") return handleAdmin(data);
    if (!action) return responseJson({ status: "success", message: "A4 roadside O-D survey backend is running." });
    return responseJson({ status: "error", message: "Invalid action" });
  } catch (error) {
    return responseJson({ status: "error", message: error.toString() });
  }
}

// ---------------------------------------------------------------------
// Batch write
// ---------------------------------------------------------------------
function handleSubmitBatch(data) {
  const payload = Array.isArray(data.payload) ? data.payload : [];
  if (payload.length === 0) return responseJson({ status: "success", count: 0, duplicatesSkipped: 0 });
  if (payload.length > MAX_BATCH_SIZE) {
    return responseJson({ status: "error", message: "Batch too large (max " + MAX_BATCH_SIZE + ")." });
  }

  // One writer at a time, so concurrent recorders never overwrite each
  // other's rows and the duplicate check sees every committed row.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    return responseJson({ status: "error", message: "Server busy. The app will retry automatically." });
  }

  try {
    const sheet = getDataSheet();
    // Idempotency: an eventId already in the sheet is skipped (a batch
    // re-sent after a lost response is not written twice).
    const existing = getExistingEventIds(sheet);

    const rows = [];
    let duplicatesSkipped = 0;
    for (let i = 0; i < payload.length; i++) {
      const item = payload[i];
      if (!item || typeof item !== "object") continue;
      const id = item.eventId ? String(item.eventId) : "";
      if (id && existing[id]) { duplicatesSkipped++; continue; }
      if (id) existing[id] = true;
      rows.push(toRow(item));
    }

    if (rows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
      SpreadsheetApp.flush();
    }
    return responseJson({ status: "success", count: rows.length, duplicatesSkipped: duplicatesSkipped });
  } finally {
    lock.releaseLock();
  }
}

function toRow(item) {
  return COLUMNS.map(function (c) {
    const v = item[c[1]];
    if (c[2] === "num") return num(v);
    if (c[2] === "numtext") return v !== "" && v !== null && v !== undefined && isFinite(Number(v)) ? Number(v) : text(v, 300);
    return text(v, c[2] === "long" ? 2000 : 300);
  });
}

// Plain text only: trims, caps length, and stops a typed value such as
// "=IMPORTXML(...)" from being run as a formula in the sheet.
function text(v, maxLen) {
  if (v === undefined || v === null) return "";
  let s = String(v).trim().slice(0, maxLen || 300);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function num(v) {
  if (v === "" || v === null || v === undefined) return "";
  const n = Number(v);
  return isFinite(n) ? n : "";
}

// ---------------------------------------------------------------------
// Sheet helpers
// ---------------------------------------------------------------------
function getSpreadsheet() {
  const active = SpreadsheetApp.getActiveSpreadsheet(); // set when attached to a sheet
  if (active) return active;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty("SHEET_ID");
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) {}
  }
  const ss = SpreadsheetApp.create("A4 Roadside OD Survey Data");
  props.setProperty("SHEET_ID", ss.getId());
  return ss;
}

function getDataSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(DATA_SHEET_NAME);
  if (sheet && !hasCurrentHeaders(sheet)) {
    if (sheet.getLastRow() <= 1) {
      sheet.clear();
    } else {
      // Rows in an older column layout: keep them untouched under a new name.
      sheet.setName(DATA_SHEET_NAME + " (old " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HHmm") + ")");
      sheet = null;
    }
  }
  if (!sheet) sheet = ss.insertSheet(DATA_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function hasCurrentHeaders(sheet) {
  if (sheet.getLastRow() === 0) return true;
  if (sheet.getLastColumn() !== HEADERS.length) return false;
  const row = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  return row.every(function (v, i) { return String(v) === HEADERS[i]; });
}

function getExistingEventIds(sheet) {
  const seen = {};
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return seen;
  const values = sheet.getRange(2, EVENT_ID_COL, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0]) seen[String(values[i][0])] = true;
  }
  return seen;
}

function responseJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function checkGlobalRateLimit() {
  const cache = CacheService.getScriptCache();
  const key = "global_rate_limit";
  const count = parseInt(cache.get(key) || "0", 10);
  if (count >= GLOBAL_RATE_LIMIT_PER_MIN) return false;
  cache.put(key, String(count + 1), 60);
  return true;
}

// ---------------------------------------------------------------------
// Admin dashboard (admin.html): progress against the targets + analysis.
// The password is NOT kept in this file (the code is on GitHub): set it once
// in the Apps Script editor, Project Settings (gear) > Script properties >
// Add property: ADMIN_PASSWORD = your password.
// ---------------------------------------------------------------------
const TARGETS_SHEET_NAME = "Targets";
const SURVEY_HOURS_DEFAULT = 12;
const ADMIN_MAX_FAILS = 10; // wrong passwords allowed per 10 minutes

// Vehicle classes of the sampling plan, and the app's vehicle types counted in each.
const VEHICLE_CLASSES = [
  ["Motor Cycles", "Passenger", ["Motorcycle"]],
  ["Three Wheeler", "Passenger", ["3-wheeler"]],
  ["Car/Jeep/SUV/Double Cab", "Passenger", ["Taxi", "Car / Jeep"]],
  ["Van", "Passenger", ["Passenger van", "Office van", "School van"]],
  ["Mini Bus", "Passenger", ["Minibus"]],
  ["Large Bus", "Passenger", ["Large bus"]],
  ["Small Truck", "Freight", ["Delivery van", "Small lorry"]],
  ["Medium Truck", "Freight", ["Medium truck (2 axle)", "Truck (2 axle)"]], // "Truck (2 axle)": records made before the split
  ["Heavy Truck", "Freight", ["Heavy truck (2 axle)", "Container (20 ft / 3 axle)"]],
  ["Container", "Freight", ["Multi-axle container (40 ft)"]],
  ["Other freight", "Freight", ["Other"]]
];
// Targets filled in when the Targets tab is first made (OD 2 from the sampling
// plan). Change them in the Targets tab or on the dashboard.
const DEFAULT_TARGETS = {
  "OD 2": { "Motor Cycles": 800, "Three Wheeler": 550, "Car/Jeep/SUV/Double Cab": 525, "Van": 125, "Mini Bus": 25,
            "Small Truck": 300, "Medium Truck": 300, "Heavy Truck": 200, "Container": 50 }
};
const STATIONS = ["OD 1", "OD 2", "OD 3", "OD 4", "OD 5", "OD 6", "OD 7"];

// Answers counted on the dashboard: [key, sheet header].
const ADMIN_FIELDS = [
  ["direction", "Direction"], ["type", "Vehicle Type"], ["originDistrict", "Origin District"],
  ["destinationDistrict", "Destination District"], ["tripPurpose", "Trip Purpose"], ["frequency", "Trip Frequency"],
  ["expressway", "Future Use of Kahathuduwa-Ingiriya Expressway"], ["commodity", "Commodity"], ["load", "Load Condition"],
  ["income", "Monthly Household Income"]
];

function vehicleClass(category, type) {
  const t = String(type || "").trim();
  for (let i = 0; i < VEHICLE_CLASSES.length; i++) {
    if (VEHICLE_CLASSES[i][2].indexOf(t) >= 0) return VEHICLE_CLASSES[i][0];
  }
  if (/^Other/.test(t) && /Freight/.test(category)) return "Other freight";
  return t ? "Other (" + t + ")" : "(no type)";
}
function classGroup(name) {
  for (let i = 0; i < VEHICLE_CLASSES.length; i++) if (VEHICLE_CLASSES[i][0] === name) return VEHICLE_CLASSES[i][1];
  return "Other";
}

function checkAdmin(password) {
  const expected = PropertiesService.getScriptProperties().getProperty("ADMIN_PASSWORD");
  if (!expected) return "The admin password is not set yet. In Apps Script: Project Settings > Script properties > add ADMIN_PASSWORD.";
  const cache = CacheService.getScriptCache();
  const fails = parseInt(cache.get("admin_fails") || "0", 10);
  if (fails >= ADMIN_MAX_FAILS) return "Too many wrong passwords. Try again in 10 minutes.";
  if (String(password || "") !== expected) {
    cache.put("admin_fails", String(fails + 1), 600);
    return "Wrong password.";
  }
  return "";
}

function handleAdmin(data) {
  const problem = checkAdmin(data.password);
  if (problem) return responseJson({ status: "error", auth: false, message: problem });
  if (data.action === "admin_set_targets") {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(LOCK_WAIT_MS)) return responseJson({ status: "error", message: "Server busy. Try again." });
    try { saveTargets(data.targets || {}); } finally { lock.releaseLock(); }
  }
  return responseJson(adminStats());
}

// Targets tab: one row per station: Station | Survey hours | one column per vehicle class.
function getTargetsSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(TARGETS_SHEET_NAME);
  if (sheet) return sheet;
  sheet = ss.insertSheet(TARGETS_SHEET_NAME);
  const head = ["Station", "Survey hours"].concat(VEHICLE_CLASSES.map(function (c) { return c[0]; }));
  const rows = STATIONS.map(function (st) {
    const t = DEFAULT_TARGETS[st] || {};
    return [st, SURVEY_HOURS_DEFAULT].concat(VEHICLE_CLASSES.map(function (c) { return t[c[0]] === undefined ? "" : t[c[0]]; }));
  });
  sheet.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight("bold");
  sheet.getRange(2, 1, rows.length, head.length).setValues(rows);
  sheet.setFrozenRows(1);
  return sheet;
}

function readTargets() {
  const values = getTargetsSheet().getDataRange().getValues();
  const head = values[0].map(String);
  const out = {};
  for (let r = 1; r < values.length; r++) {
    const st = String(values[r][0]).trim();
    if (!st) continue;
    const t = { hours: Number(values[r][1]) || SURVEY_HOURS_DEFAULT, byClass: {} };
    for (let c = 2; c < head.length; c++) {
      if (values[r][c] !== "" && isFinite(Number(values[r][c]))) t.byClass[head[c]] = Number(values[r][c]);
    }
    out[st] = t;
  }
  return out;
}

function saveTargets(targets) {
  const sheet = getTargetsSheet();
  const values = sheet.getDataRange().getValues();
  const head = values[0].map(String);
  Object.keys(targets).forEach(function (st) {
    if (STATIONS.indexOf(st) === -1) return;
    const t = targets[st] || {};
    let r = 1;
    while (r < values.length && String(values[r][0]).trim() !== st) r++;
    if (r === values.length) values.push(head.map(function () { return ""; }));
    values[r][0] = st;
    const hours = Number(t.hours);
    if (hours > 0 && hours <= 24) values[r][1] = hours;
    const byClass = t.byClass || {};
    for (let c = 2; c < head.length; c++) {
      if (!(head[c] in byClass)) continue;
      const v = byClass[head[c]];
      values[r][c] = v === "" || v === null ? "" : (isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : values[r][c]);
    }
  });
  sheet.getRange(1, 1, values.length, head.length).setValues(values);
}

// Counts for the dashboard as [station, date, what, value, n] rows; the page
// adds them up for the station and date picked.
function adminStats() {
  const sheet = getDataSheet();
  const last = sheet.getLastRow();
  const rows = last > 1 ? sheet.getRange(2, 1, last - 1, HEADERS.length).getDisplayValues() : [];
  const col = {};
  HEADERS.forEach(function (h, i) { col[h] = i; });
  const agg = {};
  const add = function (st, date, what, value) {
    const k = [st, date, what, value].join("\u0001");
    agg[k] = (agg[k] || 0) + 1;
  };
  const recorders = {};
  rows.forEach(function (r) {
    const st = String(r[col["Survey Location"]] || "").trim() || "(no station)";
    const date = String(r[col["Date"]] || "").trim() || "(no date)";
    const time = String(r[col["Time"]] || "").trim();
    const m = /^(\d{1,2})/.exec(time);
    const hour = m ? ("0" + m[1]).slice(-2) : "??";
    const cls = vehicleClass(String(r[col["Vehicle Category"]]).trim(), r[col["Vehicle Type"]]);
    add(st, date, "class", cls);
    add(st, date, "hour", hour + "|" + classGroup(cls));
    ADMIN_FIELDS.forEach(function (f) {
      let v = String(r[col[f[1]]] || "").trim();
      if (!v) return;
      if (/^Other:/.test(v)) v = "Other";
      add(st, date, f[0], v);
    });
    const name = String(r[col["Recorder"]] || "").trim() || "(no name)";
    add(st, date, "recorder", name);
    const stamp = date + " " + time;
    const rec = recorders[name];
    if (!rec || stamp > rec.last) recorders[name] = { station: st, last: stamp };
  });
  return {
    status: "success",
    survey: "od",
    generated: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
    total: rows.length,
    stations: STATIONS,
    classes: VEHICLE_CLASSES.map(function (c) { return { name: c[0], group: c[1], types: c[2] }; }),
    targets: readTargets(),
    counts: Object.keys(agg).map(function (k) { return k.split("\u0001").concat([agg[k]]); }),
    recorders: Object.keys(recorders).map(function (n) { return { name: n, station: recorders[n].station, last: recorders[n].last }; })
  };
}

// Run once from the editor: creates the data and Targets tabs and asks for
// the permissions the web app needs.
function setup() {
  const sheet = getDataSheet();
  getTargetsSheet();
  Logger.log("Data sheet ready: " + sheet.getParent().getUrl());
}

// ---------------------------------------------------------------------
// Summary + O-D matrix (menu: A4 O-D Survey > Build / refresh summary)
// ---------------------------------------------------------------------
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("A4 O-D Survey")
    .addItem("Build / refresh summary", "buildSummary")
    .addToUi();
}

function buildSummary() {
  const ss = getSpreadsheet();
  const data = getDataSheet().getDataRange().getDisplayValues();
  const col = {};
  HEADERS.forEach(function (h, i) { col[h] = i; });

  // ---- Summary: every answer counted, overall and per survey date
  const segments = [];
  const counts = {}; // field -> answer -> segment -> n
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const seg = String(row[col[SEGMENT_COLUMN]] || "(none)");
    if (segments.indexOf(seg) === -1) segments.push(seg);
    SUMMARY_FIELDS.forEach(function (field) {
      const raw = String(row[col[field]] || "").trim();
      const answers = raw ? (MULTI_FIELDS.indexOf(field) >= 0 ? raw.split("; ") : [raw]) : ["(blank)"];
      answers.forEach(function (a) {
        const key = /^Other:/.test(a) ? "Other" : a; // group "Other: ..." details
        counts[field] = counts[field] || {};
        counts[field][key] = counts[field][key] || {};
        counts[field][key][seg] = (counts[field][key][seg] || 0) + 1;
      });
    });
  }
  segments.sort();

  const out = [["Question", "Answer", "Total"].concat(segments)];
  SUMMARY_FIELDS.forEach(function (field) {
    const byAnswer = counts[field] || {};
    Object.keys(byAnswer).sort(function (a, b) { return total(byAnswer[b]) - total(byAnswer[a]); }).forEach(function (a) {
      out.push([field, a, total(byAnswer[a])].concat(segments.map(function (s) { return byAnswer[a][s] || 0; })));
    });
  });

  let sheet = ss.getSheetByName(SUMMARY_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SUMMARY_SHEET_NAME);
  sheet.clear();
  sheet.getRange(1, 1, out.length, out[0].length).setValues(out);
  sheet.getRange(1, 1, 1, out[0].length).setFontWeight("bold");
  sheet.setFrozenRows(1);
  sheet.getRange(out.length + 2, 1).setValue("Interviews: " + (data.length - 1) + ". Blank answers come from questions not asked for that vehicle category.");
  sheet.autoResizeColumns(1, out[0].length);

  buildOdMatrix(ss, data, col);
}

// Origin district (rows) x destination district (columns), for all vehicles,
// passenger vehicles and freight vehicles, one block under the other.
function buildOdMatrix(ss, data, col) {
  const blocks = [["All vehicles", null], ["Passenger vehicles", "Passenger vehicle"], ["Freight vehicles", "Freight vehicle"]];
  const districts = {};
  for (let r = 1; r < data.length; r++) {
    districts[odKey(data[r][col["Origin District"]])] = true;
    districts[odKey(data[r][col["Destination District"]])] = true;
  }
  const names = Object.keys(districts).sort(function (a, b) {
    const ua = a.charAt(0) === "(", ub = b.charAt(0) === "(";
    return ua === ub ? a.localeCompare(b) : (ua ? 1 : -1); // "(not known)" last
  });
  const width = names.length + 2;
  const out = [];
  const pad = function (row) { while (row.length < width) row.push(""); return row; };
  blocks.forEach(function (b) {
    const m = {};
    let n = 0;
    for (let r = 1; r < data.length; r++) {
      const row = data[r];
      if (b[1] && String(row[col["Vehicle Category"]]) !== b[1]) continue;
      const o = odKey(row[col["Origin District"]]);
      const d = odKey(row[col["Destination District"]]);
      m[o] = m[o] || {};
      m[o][d] = (m[o][d] || 0) + 1;
      n++;
    }
    out.push(pad([b[0] + " (" + n + " interviews)  -  rows: origin district, columns: destination district"]));
    out.push(pad(["Origin \\ Destination"].concat(names, ["Total"])));
    names.forEach(function (o) {
      const cells = names.map(function (d) { return (m[o] && m[o][d]) || 0; });
      out.push(pad([o].concat(cells, [cells.reduce(function (s, x) { return s + x; }, 0)])));
    });
    const colTotals = names.map(function (d) { return names.reduce(function (s, o) { return s + ((m[o] && m[o][d]) || 0); }, 0); });
    out.push(pad(["Total"].concat(colTotals, [n])));
    out.push(pad([""]));
  });

  let sheet = ss.getSheetByName(OD_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(OD_SHEET_NAME);
  sheet.clear();
  sheet.getRange(1, 1, out.length, width).setValues(out);
  for (let r = 0; r < out.length; r++) {
    const first = String(out[r][0]);
    if (first === "Origin \\ Destination" || /interviews\)/.test(first) || first === "Total") sheet.getRange(r + 1, 1, 1, width).setFontWeight("bold");
  }
  sheet.autoResizeColumns(1, width);
}

function odKey(district) {
  const d = String(district || "").trim();
  if (!d) return "(blank)";
  return d === "Not known" ? "(not known)" : d;
}

function total(bySeg) {
  let n = 0;
  for (const k in bySeg) n += bySeg[k];
  return n;
}
