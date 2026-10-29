/**
 * Revival Material Loadout backend for Google Sheets.
 * Paste this file into Extensions > Apps Script in the "Revival Material Tracker" Google Sheet.
 *
 * Setup (once):
 *   1. Run createApiToken() and copy the token it shows in the Execution log (it also saves it as the REVIVAL_API_TOKEN
 *      script property). Paste it into Netlify as APPS_SCRIPT_TOKEN.
 *   2. Run setupWorkbook() once and approve the permissions.
 *   3. Deploy > New deployment > Web app: Execute as "Me", Who has access "Anyone". Copy the /exec URL into Netlify as APPS_SCRIPT_URL.
 */

// Counts and reordering live in the 2026 Flake & Chemical Sheet DSM (Bailey counts, Luke orders, Reorder tab forecasts).
// This tracker only records what each job loaded, returned and wasted; it keeps no inventory.
const CONFIG = {
  timezone: "America/Chicago",
  apiTokenProperty: "REVIVAL_API_TOKEN",
  spreadsheetIdProperty: "REVIVAL_SPREADSHEET_ID",
  weeklyEmailTo: "josh@revivalconcretecoatings.com,luke@revivalconcretecoatings.com,hello@revivalconcretecoatings.com,bryce@revivalconcretecoatings.com",
  weeklyReportHour: 15,
  // Weekday mornings: jobs from the last work day with no Load trailer, and finished jobs with no Return
  dailyCheckHour: 7,
  signoffsFrom: "2026-11-02",   // go-live: jobs starting before this date are never flagged
  dailyCheckTo: "josh@revivalconcretecoatings.com,luke@revivalconcretecoatings.com,hello@revivalconcretecoatings.com,bryce@revivalconcretecoatings.com",
};

const SHEETS = {
  transactions: "Crew Entries",
  crewDays: "Crew Days",
  roster: "Crew Roster",
  weekly: "Waste Report",
};

// Revival Crew Schedule (DripJobs -> Zapier): the jobs crews load out for. Job ID = DripJobs project ID.
const SCHEDULE_SHEET_ID = "1I_P4Ypy9L5Wqp6TGYf8VgoqAExRhH5ftH2pVn1q_jJM";
const SCHEDULE_LOOKBACK_DAYS = 30;   // jobs that started up to 30 days ago (multi-day and two-phase jobs)
const SCHEDULE_LOOKAHEAD_DAYS = 7;   // and jobs starting in the next week (loading the night before)
// 2026 Flake & Chemical Sheet DSM: its "Upcoming Jobs" tab (rebuilt every morning from QuickBooks + the schedule) gives
// each job's sold sq ft, flake (Torginol name) and base coat, so the app can fill them in.
const FLAKE_SHEET_ID = "1BLz7pDUtBW5Hfta8Z-MS7-jQ1JG5I0o3c9cmVvTMKZU";

const SHEET_RENAMES = [];

const TX_HEADERS = [
  "Timestamp", "Entry ID", "Action", "Job ID", "Job Name", "Crew Lead", "Crew Members", "Work Date",
  "System ID", "System Name", "Square Feet", "Flake ID", "Material ID", "Material Name",
  "Category", "Unit", "Expected Use", "Safety Qty", "Recommended Load", "Actual Qty",
  "Return Qty", "Waste Qty", "Waste %", "Signature", "Notes", "Source", "Add-ons", "Coated Sq Ft"
];

// One row per person per job per day. The job labor report joins this to Gusto hours.
const CREW_DAYS_HEADERS = ["Work Date", "Job ID", "Job Name", "Person", "Role", "Recorded On", "Entry ID", "Timestamp"];

// Names must match Gusto exactly. Set Active to N when someone leaves; add new hires here.
const ROSTER_HEADERS = ["Name (as in Gusto)", "Gusto Title", "Active (Y/N)"];
const SEED_ROSTER = [
  ["Andrew Vance", "Lead Craftsman", "Y"],
  ["Benjamin Wyatt", "Craftsman", "Y"],
  ["Hunter Schueler", "Lead Craftsman", "Y"],
  ["Izajah Martinez", "Craftsman", "Y"],
  ["Jordan Dunesbery", "Craftsman", "Y"],
  ["Joshua Fisher", "Production Coordinator", "Y"],
  ["Kaleb McCollum", "Lead Craftsman", "Y"],
  ["Keegan DeYoung", "Craftsman", "Y"],
  ["Luke Miller", "General Manager", "Y"],
  ["Mike Hunter", "Craftsman", "Y"],
  ["Oscar Martinez", "Lead Craftsman", "Y"],
];

const WEEKLY_HEADERS = [
  "Report Timestamp", "Week Start", "Week End", "Material ID", "Material Name",
  "Expected Use", "Consumed", "Waste Qty", "Waste %", "Status"
];

/** Makes a long random token, saves it as the REVIVAL_API_TOKEN script property, and shows it in the Execution log to copy into Netlify. */
function createApiToken() {
  const token = "rev_" + Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  PropertiesService.getScriptProperties().setProperty(CONFIG.apiTokenProperty, token);
  Logger.log("Copy this into Netlify as APPS_SCRIPT_TOKEN: " + token);
  return token;
}

function setupWorkbook() {
  const ss = getSpreadsheet_();
  PropertiesService.getScriptProperties().setProperty(CONFIG.spreadsheetIdProperty, ss.getId());
  // work dates are saved as dates; keep the sheet on Iowa time so a date never shifts a day
  if (ss.setSpreadsheetTimeZone) ss.setSpreadsheetTimeZone(CONFIG.timezone);
  ensureCoreSheets_();
  seedRoster_();
  installTriggers();
  return { ok: true, spreadsheetId: ss.getId(), sheetNames: SHEETS };
}

function seedRoster_() {
  const sheet = getSpreadsheet_().getSheetByName(SHEETS.roster);
  if (sheet.getLastRow() > 1) return;
  sheet.getRange(2, 1, SEED_ROSTER.length, ROSTER_HEADERS.length).setValues(SEED_ROSTER);
}

function doGet(e) {
  try {
    verifyToken_((e.parameter || {}).token);
    ensureCoreSheets_();
    const action = (e.parameter || {}).action || "openJobs";
    if (action === "openJobs") return json_({ ok: true, jobs: listOpenJobs_() });
    if (action === "scheduledJobs") return json_({ ok: true, jobs: listScheduledJobs_() });
    if (action === "roster") return json_({ ok: true, roster: listRoster_() });
    if (action === "health") return json_({ ok: true, message: "Revival Apps Script backend is online." });
    return json_({ ok: false, error: "Unknown GET action." });
  } catch (error) {
    return json_({ ok: false, error: error.message });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const payload = JSON.parse((e.postData && e.postData.contents) || "{}");
    verifyToken_(payload.token);
    ensureCoreSheets_();
    if (payload.action === "submitLoadout") return json_(submitSignoff_(payload, "LOADOUT"));
    if (payload.action === "submitReturn") return json_(submitSignoff_(payload, "RETURN"));
    return json_({ ok: false, error: "Unknown POST action." });
  } catch (error) {
    return json_({ ok: false, error: error.message });
  } finally {
    lock.releaseLock();
  }
}

function submitSignoff_(payload, action) {
  validatePayload_(payload, action);
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(SHEETS.transactions);
  ensureTxHeaders_(sheet);
  const timestamp = new Date();
  const entryId = Utilities.getUuid();
  const lines = (payload.lines || []).map(normalizeLine_);
  const workDate = String(payload.workDate || "").trim();
  const jobId = String(payload.jobId || "").trim();
  const jobName = String(payload.jobName || "").trim();
  const lead = String(payload.crewLead || "").trim();
  const members = splitNames_(payload.crewMembers).filter(n => n !== lead);

  const rows = lines.map(line => [
    timestamp, entryId, action, jobId, jobName, lead, members.join(", "), workDate,
    String(payload.systemId || "").trim(), String(payload.systemName || "").trim(), number_(payload.squareFeet), String(payload.flakeId || "").trim(),
    line.materialId, line.materialName, line.category, line.unit,
    line.expectedUse, line.safetyQty, line.recommendedLoad,
    action === "LOADOUT" ? line.actualQty : 0,
    action === "RETURN" ? line.returnQty : 0,
    "", "", String(payload.signature || "").trim(), String(payload.notes || "").trim(), "Netlify app",
    String(payload.addons || "").trim(), number_(payload.coatedSquareFeet) || "",
  ]);
  appendRows_(sheet, rows, TX_HEADERS.length);

  // Who worked the job that day (lead + crew). A return re-confirms the crew for the last day.
  const crewRows = [[workDate, jobId, jobName, lead, "Lead", action === "LOADOUT" ? "Loadout" : "Return", entryId, timestamp]]
    .concat(members.map(n => [workDate, jobId, jobName, n, "Crew", action === "LOADOUT" ? "Loadout" : "Return", entryId, timestamp]));
  appendRows_(ss.getSheetByName(SHEETS.crewDays), crewRows, CREW_DAYS_HEADERS.length);

  return { ok: true, entryId: entryId, rowsAdded: rows.length, crewDays: crewRows.length, action: action };
}

function validatePayload_(payload, action) {
  if (!payload) throw new Error("Missing payload.");
  if (!payload.jobId) throw new Error("Job ID is required.");
  if (!payload.crewLead) throw new Error("Crew lead is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.workDate || ""))) throw new Error("Work date is required.");
  if (!payload.signature) throw new Error("Signature is required.");
  if (number_(payload.squareFeet) <= 0) throw new Error("Square footage must be greater than zero.");
  if (!Array.isArray(payload.lines) || payload.lines.length === 0) throw new Error("No material lines were submitted.");
  if (action !== "LOADOUT" && action !== "RETURN") throw new Error("Invalid action.");
}

function splitNames_(value) {
  return String(value || "").split(",").map(s => s.trim()).filter(Boolean);
}

function normalizeLine_(line) {
  return {
    materialId: String(line.materialId || "").trim(),
    materialName: String(line.materialName || "").trim(),
    category: String(line.category || "").trim(),
    unit: String(line.unit || "").trim(),
    expectedUse: number_(line.expectedUse),
    safetyQty: number_(line.safetyQty),
    recommendedLoad: number_(line.recommendedLoad),
    actualQty: number_(line.actualQty),
    returnQty: number_(line.returnQty),
  };
}

function listRoster_() {
  const sheet = getSpreadsheet_().getSheetByName(SHEETS.roster);
  if (!sheet || sheet.getLastRow() < 2) return SEED_ROSTER.map(r => r[0]);
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues()
    .filter(r => String(r[0]).trim() && !/^n/i.test(String(r[2]).trim()))
    .map(r => String(r[0]).trim())
    .sort();
}

/**
 * Jobs on the Revival Crew Schedule (latest row per DripJobs project) starting in the window, with the crew lead from
 * the Crews tab. Picking one stamps the DripJobs project ID as the Job ID.
 */
function listScheduledJobs_() {
  const ss = SpreadsheetApp.openById(SCHEDULE_SHEET_ID);
  const leads = {};
  const crews = ss.getSheetByName("Crews");
  if (crews && crews.getLastRow() > 1) {
    crews.getRange(2, 1, crews.getLastRow() - 1, 2).getValues().forEach(r => {
      const crew = String(r[0] || "").trim();
      if (crew) leads[crew] = String(r[1] || "").replace(/\(.*\)/, "").trim();
    });
  }
  const log = ss.getSheetByName("Schedule Log");
  if (!log || log.getLastRow() < 2) return [];
  const values = log.getRange(1, 1, log.getLastRow(), Math.min(log.getLastColumn(), 14)).getValues();
  const idx = headerIndex_(values[0]);
  const now = new Date();
  const from = new Date(now.getTime() - SCHEDULE_LOOKBACK_DAYS * 864e5);
  const to = new Date(now.getTime() + SCHEDULE_LOOKAHEAD_DAYS * 864e5);
  const latest = {};
  values.slice(1).forEach(r => {
    const id = String(r[idx["Project ID"]] || "").trim();
    if (!id || String(r[idx["Stage"]] || "") !== "Project Scheduled") return;
    latest[id] = r;   // rows are appended in order, so the last one wins
  });
  const sold = soldJobDetails_();
  return Object.keys(latest).map(id => {
    const r = latest[id];
    const start = toDate_(r[idx["Start Date"]]);
    const end = toDate_(r[idx["End Date"]]) || start;
    const crew = String(r[idx["Crew"]] || "").trim();
    const customer = String(r[idx["Customer"]] || "").replace(/\s+/g, " ").trim();
    return { projectId: id, customer: customer, crew: crew, crewLead: leads[crew] || "", start: start, end: end,
      address: String(r[idx["Address"]] || "").trim(), crewNotes: String(r[idx["Crew Notes"]] || "") };
  })
    .filter(j => j.customer && j.start && j.start >= from && j.start <= to)
    .sort((a, b) => a.start - b.start)
    .map(j => {
      const dates = formatShort_(j.start) + (j.end && formatShort_(j.end) !== formatShort_(j.start) ? " - " + formatShort_(j.end) : "");
      const d = sold[normCustomer_(j.customer)] || {};
      return { projectId: j.projectId, customer: j.customer, crew: j.crew, crewLead: j.crewLead, dates: dates,
        label: j.customer + " - " + dates, soldSquareFeet: d.sqft || "", flakeColor: d.flake || "", baseCoat: d.base || "",
        crewNotes: j.crewNotes };   // the app reads the verticals / stairs / extra topcoat lines from these
    });
}

function normCustomer_(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** customer -> { sqft, flake, base } from the Flake & Chemical sheet's Upcoming Jobs tab. Empty if it can't be read. */
function soldJobDetails_() {
  const out = {};
  try {
    const sheet = SpreadsheetApp.openById(FLAKE_SHEET_ID).getSheetByName("Upcoming Jobs");
    if (!sheet || sheet.getLastRow() < 3) return out;
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getValues();
    const idx = headerIndex_(values[0]);
    values.slice(1).forEach(r => {
      const key = normCustomer_(r[idx["Customer"]]);
      if (!key) return;
      const flake = String(r[idx["Flake (order name)"]] || "").trim();
      out[key] = { sqft: Number(r[idx["Sq ft"]]) || "", flake: /^\?/.test(flake) ? "" : flake, base: String(r[idx["Base coat"]] || "").trim() };
    });
  } catch (err) {
    console.error("Upcoming Jobs: " + err.message);
  }
  return out;
}

function formatShort_(date) {
  return Utilities.formatDate(date, CONFIG.timezone, "M/d");
}

function listOpenJobs_() {
  const tx = getTransactionObjects_();
  const jobs = {};
  const returnedAfter = {};
  tx.forEach(row => {
    const jobId = String(row["Job ID"] || "").trim();
    if (!jobId) return;
    const timestamp = toDate_(row.Timestamp);
    if (row.Action === "RETURN") {
      if (!returnedAfter[jobId] || timestamp > returnedAfter[jobId]) returnedAfter[jobId] = timestamp;
      return;
    }
    if (row.Action !== "LOADOUT") return;
    const entryId = String(row["Entry ID"] || "").trim();
    const current = jobs[jobId];
    if (!current || timestamp > current.timestamp) {
      jobs[jobId] = {
        jobId: jobId, jobName: row["Job Name"] || "", crewLead: row["Crew Lead"] || "", crewMembers: row["Crew Members"] || "",
        workDate: row["Work Date"] ? formatDate_(toDate_(row["Work Date"]) || new Date()) : "",
        systemId: row["System ID"] || "", systemName: row["System Name"] || "", squareFeet: row["Square Feet"] || "",
        flakeId: row["Flake ID"] || "", lines: [], entryId: entryId, timestamp: timestamp,
      };
    }
    const job = jobs[jobId];
    if (job && entryId === job.entryId) {
      job.lines.push({
        materialId: row["Material ID"] || "", materialName: row["Material Name"] || "", category: row.Category || "", unit: row.Unit || "",
        expectedUse: number_(row["Expected Use"]), safetyQty: number_(row["Safety Qty"]), recommendedLoad: number_(row["Recommended Load"]),
        actualQty: number_(row["Actual Qty"]),
      });
    }
  });
  // a job is open when its latest loadout has no return after it (two-phase jobs get a second loadout)
  return Object.keys(jobs)
    .filter(jobId => !returnedAfter[jobId] || returnedAfter[jobId] < jobs[jobId].timestamp)
    .map(jobId => jobs[jobId])
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 50)
    .map(job => ({
      jobId: job.jobId, jobName: job.jobName, crewLead: job.crewLead, crewMembers: job.crewMembers, workDate: job.workDate,
      systemId: job.systemId, systemName: job.systemName, squareFeet: job.squareFeet, flakeId: job.flakeId,
      lines: job.lines || [], timestamp: formatDateTime_(job.timestamp),
    }));
}

function weeklyWasteReport() {
  ensureCoreSheets_();
  const now = new Date();
  const weekStart = startOfWorkWeek_(now);
  const allTx = getTransactionObjects_();
  const thisWeek = allTx.filter(row => {
    const d = toDate_(row.Timestamp);
    return d && d >= weekStart && d <= now;
  });
  // A job loaded out last week (Thursday/Friday or a multi-day job) and returned this week still needs its loadout,
  // or the return would look like material that was never used. Pull in that job's loadouts since its previous return.
  const returnedThisWeek = {};
  thisWeek.forEach(row => { if (row.Action === "RETURN") returnedThisWeek[String(row["Job ID"] || "").trim()] = true; });
  const priorReturn = {};
  allTx.forEach(row => {
    const jobId = String(row["Job ID"] || "").trim();
    const d = toDate_(row.Timestamp);
    if (row.Action === "RETURN" && d && d < weekStart && (!priorReturn[jobId] || d > priorReturn[jobId])) priorReturn[jobId] = d;
  });
  const earlierLoadouts = allTx.filter(row => {
    const jobId = String(row["Job ID"] || "").trim();
    const d = toDate_(row.Timestamp);
    return row.Action === "LOADOUT" && returnedThisWeek[jobId] && d && d < weekStart &&
      d > new Date(weekStart.getTime() - 30 * 864e5) && (!priorReturn[jobId] || d > priorReturn[jobId]);
  });
  const tx = earlierLoadouts.concat(thisWeek);

  const loadoutJobs = {};
  const returnedJobs = {};
  const jobNames = {};
  tx.forEach(row => {
    const jobId = String(row["Job ID"] || "").trim();
    if (!jobId) return;
    if (row["Job Name"]) jobNames[jobId] = String(row["Job Name"]).trim();
    if (row.Action === "LOADOUT") loadoutJobs[jobId] = true;
    if (row.Action === "RETURN") returnedJobs[jobId] = true;
  });

  // Job ID is the DripJobs work order ID for jobs picked from the sold list; show the customer name instead
  const openJobs = Object.keys(loadoutJobs).filter(jobId => !returnedJobs[jobId]).map(jobId => jobNames[jobId] || jobId);
  const aggregates = {};

  tx.forEach(row => {
    const jobId = String(row["Job ID"] || "").trim();
    const action = row.Action;
    if (action === "LOADOUT" && !returnedJobs[jobId]) return;
    const materialId = String(row["Material ID"] || "").trim();
    if (!materialId) return;
    if (!aggregates[materialId]) {
      aggregates[materialId] = {
        materialId: materialId,
        materialName: row["Material Name"] || "",
        unit: row.Unit || "",
        expected: 0,
        loaded: 0,
        returned: 0,
      };
    }
    if (action === "LOADOUT") {
      aggregates[materialId].expected += number_(row["Expected Use"]);
      aggregates[materialId].loaded += number_(row["Actual Qty"]);
    }
    if (action === "RETURN") {
      aggregates[materialId].returned += number_(row["Return Qty"]);
    }
  });

  const summaries = Object.keys(aggregates).map(materialId => {
    const item = aggregates[materialId];
    const consumed = item.loaded - item.returned;
    const waste = consumed - item.expected;
    const wastePct = item.expected ? waste / item.expected : 0;
    const tolerance = item.unit === "kit" ? 0 : 0.25;
    const status = Math.abs(waste) <= tolerance ? "ON TARGET" : (waste > 0 ? "WASTEFUL" : "UNDER TARGET");
    return {
      materialId: item.materialId,
      materialName: item.materialName,
      expected: round2_(item.expected),
      consumed: round2_(consumed),
      waste: round2_(waste),
      wastePct: wastePct,
      status: status,
    };
  });

  appendWeeklySummary_(now, weekStart, now, summaries);
  sendWeeklyEmail_(now, weekStart, now, summaries, openJobs);
  return { ok: true, summaries: summaries.length, openJobs: openJobs.length };
}

function appendWeeklySummary_(reportTime, weekStart, weekEnd, summaries) {
  if (!summaries.length) return;
  const sheet = getSpreadsheet_().getSheetByName(SHEETS.weekly);
  const rows = summaries.map(item => [
    reportTime,
    weekStart,
    weekEnd,
    item.materialId,
    item.materialName,
    item.expected,
    item.consumed,
    item.waste,
    item.wastePct,
    item.status,
  ]);
  appendRows_(sheet, rows, WEEKLY_HEADERS.length);
}

function sendWeeklyEmail_(reportTime, weekStart, weekEnd, summaries, openJobs) {
  const overall = summaries.some(item => item.status === "WASTEFUL") ? "WASTEFUL" : "ON TARGET";
  const subject = `Revival Weekly Material Waste Report - ${overall} - ${formatDate_(weekStart)} to ${formatDate_(weekEnd)}`;
  const tableRows = summaries.length ? summaries.map(item => `
    <tr>
      <td>${escapeHtml_(item.materialId)}</td>
      <td>${escapeHtml_(item.materialName)}</td>
      <td style="text-align:right;">${item.expected.toFixed(2)}</td>
      <td style="text-align:right;">${item.consumed.toFixed(2)}</td>
      <td style="text-align:right;">${item.waste.toFixed(2)}</td>
      <td style="text-align:right;">${(item.wastePct * 100).toFixed(1)}%</td>
      <td><strong>${escapeHtml_(item.status)}</strong></td>
    </tr>`).join("") : `<tr><td colspan="7">No completed loadout/return pairs were found for this week.</td></tr>`;

  const openJobText = openJobs.length
    ? `<p><strong>Missing return sign-off:</strong> ${openJobs.map(escapeHtml_).join(", ")}. These jobs were excluded from waste totals until returns are signed.</p>`
    : `<p>No missing return sign-offs found for this week.</p>`;

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;">
      <h2>Revival Weekly Material Waste Report</h2>
      <p><strong>Status:</strong> ${overall}</p>
      <p><strong>Week:</strong> ${formatDate_(weekStart)} through ${formatDate_(weekEnd)}</p>
      ${openJobText}
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">
        <thead style="background:#1a1a1a;color:#ffffff;">
          <tr><th>Material ID</th><th>Material</th><th>Expected Use</th><th>Consumed</th><th>Waste Qty</th><th>Waste %</th><th>Status</th></tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
      <p style="color:#666;font-size:12px;">Generated ${formatDateTime_(reportTime)}.</p>
    </div>`;

  const plainBody = `Revival Weekly Material Waste Report\nStatus: ${overall}\nWeek: ${formatDate_(weekStart)} through ${formatDate_(weekEnd)}\nOpen jobs missing return sign-off: ${openJobs.join(", ") || "None"}`;
  MailApp.sendEmail({ to: CONFIG.weeklyEmailTo, subject: subject, body: plainBody, htmlBody: htmlBody });
}

function installFridayTrigger() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === "weeklyWasteReport") ScriptApp.deleteTrigger(trigger);
  });

  ScriptApp.newTrigger("weeklyWasteReport")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.FRIDAY)
    .atHour(CONFIG.weeklyReportHour)
    .nearMinute(30)
    .inTimezone(CONFIG.timezone)
    .create();

  return { ok: true, message: "Friday weekly waste report trigger installed." };
}

/** Run once from the editor: installs the Friday waste report and the weekday-morning missing sign-off check. */
function installTriggers() {
  installFridayTrigger();
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === "dailyMissingSignoffs") ScriptApp.deleteTrigger(trigger);
  });
  [ScriptApp.WeekDay.MONDAY, ScriptApp.WeekDay.TUESDAY, ScriptApp.WeekDay.WEDNESDAY, ScriptApp.WeekDay.THURSDAY, ScriptApp.WeekDay.FRIDAY].forEach(day => {
    ScriptApp.newTrigger("dailyMissingSignoffs").timeBased().onWeekDay(day).atHour(CONFIG.dailyCheckHour).nearMinute(0).inTimezone(CONFIG.timezone).create();
  });
  return { ok: true, message: "Friday waste report and weekday 7 AM missing sign-off check installed." };
}

/** "2026-10-28", "2026-10-28 8:30:00", a Date, or "10/28/26" -> "2026-10-28" in Iowa time; "" if unreadable */
function dayKey_(value) {
  if (value === "" || value === null || value === undefined) return "";
  if (Object.prototype.toString.call(value) === "[object Date]") return isNaN(value) ? "" : Utilities.formatDate(value, CONFIG.timezone, "yyyy-MM-dd");
  const text = String(value).trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + "-" + iso[2] + "-" + iso[3];
  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (us) { let y = Number(us[3]); if (y < 100) y += 2000; return y + "-" + ("0" + us[1]).slice(-2) + "-" + ("0" + us[2]).slice(-2); }
  const d = toDate_(text);
  return d ? Utilities.formatDate(d, CONFIG.timezone, "yyyy-MM-dd") : "";
}

function addDaysKey_(key, n) {
  const d = new Date(key + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Weekday mornings at 7 AM CT. Emails the jobs that need a sign-off:
 *  - No Load trailer: a job that started on the last work day (Friday-Sunday on Mondays) with no loadout.
 *  - No Return: a job whose last scheduled day has passed and whose latest loadout has no return after it.
 *    Multi-day jobs aren't flagged until their end date has passed.
 * Uses the latest "Project Scheduled" row per DripJobs project on the Revival Crew Schedule. Painting jobs are skipped.
 */
function dailyMissingSignoffs() {
  const today = dayKey_(new Date());
  const weekday = new Date(today + "T12:00:00Z").getUTCDay();   // 0 Sunday .. 6 Saturday
  const from = addDaysKey_(today, weekday === 1 ? -3 : -1);      // Monday looks back to Friday
  const yesterday = addDaysKey_(today, -1);

  // schedule: latest row per project (rows are appended in order)
  const ss = SpreadsheetApp.openById(SCHEDULE_SHEET_ID);
  const leads = {};
  const crews = ss.getSheetByName("Crews");
  if (crews && crews.getLastRow() > 1) {
    crews.getRange(2, 1, crews.getLastRow() - 1, 2).getValues().forEach(r => {
      const crew = String(r[0] || "").trim();
      if (crew) leads[crew] = String(r[1] || "").replace(/\(.*\)/, "").trim();
    });
  }
  const log = ss.getSheetByName("Schedule Log");
  const values = log.getRange(1, 1, log.getLastRow(), Math.min(log.getLastColumn(), 14)).getValues();
  const idx = headerIndex_(values[0]);
  const latest = {}, crewOf = {};
  values.slice(1).forEach(r => {
    const id = String(r[idx["Project ID"]] || "").trim();
    if (!id || String(r[idx["Stage"]] || "") !== "Project Scheduled") return;
    latest[id] = r;
    const crew = String(r[idx["Crew"]] || "").trim();
    if (crew) crewOf[id] = crew;
  });
  const jobs = Object.keys(latest).map(id => {
    const r = latest[id];
    const start = dayKey_(r[idx["Start Date"]]);
    let end = dayKey_(r[idx["End Date"]]);
    if (!end || end < start) end = start;   // DripJobs sometimes sends an end date before the start
    const crew = String(r[idx["Crew"]] || "").trim() || crewOf[id] || "";
    return { id: id, customer: String(r[idx["Customer"]] || "").replace(/\s+/g, " ").trim(), start: start, end: end, crew: crew, lead: leads[crew] || "" };
  }).filter(j => j.customer && j.start && j.start >= CONFIG.signoffsFrom && !/paint/i.test(j.crew));

  // sign-offs: loadouts and returns per job (by DripJobs project ID, or by customer name when typed by hand)
  const tx = getTransactionObjects_();
  const keyOf = (id, name) => [String(id || "").trim(), "name:" + normCustomer_(name)];
  const lastLoad = {}, lastReturn = {}, loadDays = {};
  tx.forEach(row => {
    const t = toDate_(row.Timestamp);
    if (!t) return;
    keyOf(row["Job ID"], row["Job Name"]).forEach(k => {
      if (row.Action === "LOADOUT") {
        if (!lastLoad[k] || t > lastLoad[k]) lastLoad[k] = t;
        (loadDays[k] = loadDays[k] || []).push(dayKey_(t));
      }
      if (row.Action === "RETURN" && (!lastReturn[k] || t > lastReturn[k])) lastReturn[k] = t;
    });
  });
  const find = (map, job) => map[job.id] || map["name:" + normCustomer_(job.customer)];

  const noLoadout = [], noReturn = [];
  jobs.forEach(job => {
    const loaded = find(lastLoad, job), returned = find(lastReturn, job);
    // started on the last work day: needs a loadout from within 3 days before the start
    if (job.start >= from && job.start <= yesterday) {
      const days = (loadDays[job.id] || []).concat(loadDays["name:" + normCustomer_(job.customer)] || []);
      if (!days.some(d => d >= addDaysKey_(job.start, -3))) noLoadout.push(job);
    }
    // finished (last scheduled day before today), loaded, and no return after the latest loadout; nag for up to 14 days
    if (job.end <= yesterday && job.end >= addDaysKey_(today, -14) && loaded && (!returned || returned < loaded)) noReturn.push(job);
  });

  // loadouts typed by hand that don't match a scheduled job: flag when open more than 3 days
  const scheduledKeys = {};
  jobs.forEach(j => { scheduledKeys[j.id] = true; scheduledKeys["name:" + normCustomer_(j.customer)] = true; });
  const unmatched = listOpenJobs_().filter(o => !scheduledKeys[String(o.jobId).trim()] && !scheduledKeys["name:" + normCustomer_(o.jobName)])
    .filter(o => { const d = dayKey_(o.workDate); return d && d >= CONFIG.signoffsFrom && d <= addDaysKey_(today, -3); });

  if (!noLoadout.length && !noReturn.length && !unmatched.length) return { ok: true, sent: false };

  const who = j => [j.crew || "No crew assigned", j.lead ? "lead: " + j.lead : ""].filter(Boolean).join(", ");
  const dates = j => j.start === j.end ? formatKey_(j.start) : formatKey_(j.start) + " - " + formatKey_(j.end);
  const section = (title, rows) => rows.length
    ? `<h3>${title} (${rows.length})</h3><table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;"><tr style="background:#1a1a1a;color:#fff;"><th>Customer</th><th>Scheduled</th><th>Crew</th></tr>` +
      rows.map(j => `<tr><td>${escapeHtml_(j.customer)}</td><td>${dates(j)}</td><td>${escapeHtml_(who(j))}</td></tr>`).join("") + "</table>"
    : "";
  // which crews missed what (the top of the email and the subject line)
  const byCrew = {};
  const crewKey = j => (j.crew || "No crew assigned") + (j.lead ? " (" + j.lead + ")" : "");
  noLoadout.forEach(j => { const c = byCrew[crewKey(j)] = byCrew[crewKey(j)] || { load: [], ret: [] }; c.load.push(j.customer); });
  noReturn.forEach(j => { const c = byCrew[crewKey(j)] = byCrew[crewKey(j)] || { load: [], ret: [] }; c.ret.push(j.customer); });
  const crewLines = Object.keys(byCrew).sort().map(k => {
    const c = byCrew[k], bits = [];
    if (c.load.length) bits.push("no loadout: " + c.load.join(", "));
    if (c.ret.length) bits.push("no return: " + c.ret.join(", "));
    return { crew: k, text: bits.join("; ") };
  });
  const html = `<div style="font-family:Arial,sans-serif;"><h2>Material Tracker: missing sign-offs</h2>` +
    (crewLines.length ? `<h3>By crew</h3><ul>` + crewLines.map(l => `<li><strong>${escapeHtml_(l.crew)}</strong>: ${escapeHtml_(l.text)}</li>`).join("") + `</ul>` : "") +
    section("No Load trailer sign-off", noLoadout) +
    section("Job finished, no Return materials sign-off", noReturn) +
    (unmatched.length ? `<h3>Loaded more than 3 days ago with no return, not on the schedule (${unmatched.length})</h3><ul>` +
      unmatched.map(o => `<li>${escapeHtml_(o.jobName || o.jobId)}: loaded ${escapeHtml_(o.workDate)} by ${escapeHtml_(o.crewLead || "?")}</li>`).join("") + "</ul>" : "") +
    `<p>Crew leads can still sign late: open the app, pick the job and submit. Multi-day jobs aren't flagged for a return until their last scheduled day has passed.</p></div>`;
  const plain = [
    crewLines.length ? "By crew:\n" + crewLines.map(l => `- ${l.crew}: ${l.text}`).join("\n") : "",
    noLoadout.length ? "No Load trailer: " + noLoadout.map(j => `${j.customer} (${who(j)})`).join("; ") : "",
    noReturn.length ? "No Return: " + noReturn.map(j => `${j.customer} (${who(j)})`).join("; ") : "",
    unmatched.length ? "Open loadouts not on the schedule: " + unmatched.map(o => o.jobName || o.jobId).join("; ") : "",
  ].filter(Boolean).join("\n");
  const count = noLoadout.length + noReturn.length + unmatched.length;
  const crewNames = Object.keys(byCrew).map(k => k.replace(/\s*\(.*\)$/, "")).filter((v, i, a) => a.indexOf(v) === i);
  MailApp.sendEmail({ to: CONFIG.dailyCheckTo, subject: `Material Tracker: ${count} missing sign-off${count === 1 ? "" : "s"}${crewNames.length ? " - " + crewNames.join(", ") : ""} (${formatKey_(today)})`, body: plain, htmlBody: html });
  return { ok: true, sent: true, noLoadout: noLoadout.length, noReturn: noReturn.length, unmatched: unmatched.length };
}

function formatKey_(key) {
  const p = String(key).split("-");
  return p.length === 3 ? Number(p[1]) + "/" + Number(p[2]) : String(key);
}

function ensureCoreSheets_() {
  migrateSheetNamesForProductionView_();
  ensureSheetWithHeaders_(SHEETS.transactions, TX_HEADERS);
  ensureSheetWithHeaders_(SHEETS.weekly, WEEKLY_HEADERS);
  ensureSheetWithHeaders_(SHEETS.crewDays, CREW_DAYS_HEADERS);
  ensureSheetWithHeaders_(SHEETS.roster, ROSTER_HEADERS);
}

function migrateSheetNamesForProductionView_() {
  const ss = getSpreadsheet_();
  SHEET_RENAMES.forEach(item => {
    const oldSheet = ss.getSheetByName(item.oldName);
    const newSheet = ss.getSheetByName(item.newName);
    if (oldSheet && !newSheet) oldSheet.setName(item.newName);
  });
}

function ensureSheetWithHeaders_(name, headers) {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sheet;
  }
  const currentHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
  const isEmpty = currentHeaders.every(value => value === "");
  if (isEmpty) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sheet;
}

/** Adds header cells (and sheet columns) for columns added after the sheet was set up (Add-ons, Coated Sq Ft). */
function ensureTxHeaders_(sheet) {
  if (sheet.getMaxColumns() < TX_HEADERS.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), TX_HEADERS.length - sheet.getMaxColumns());
  const have = sheet.getRange(1, 1, 1, TX_HEADERS.length).getValues()[0];
  TX_HEADERS.forEach((h, i) => { if (!String(have[i] || "").trim()) sheet.getRange(1, i + 1).setValue(h); });
}

function getTransactionObjects_() {
  const sheet = getSpreadsheet_().getSheetByName(SHEETS.transactions);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).filter(row => row.some(value => value !== "")).map(row => {
    const obj = {};
    headers.forEach((header, index) => obj[header] = row[index]);
    return obj;
  });
}

function appendRows_(sheet, rows, columnCount) {
  if (!rows || !rows.length) return;
  const start = sheet.getLastRow() + 1;
  sheet.getRange(start, 1, rows.length, columnCount).setValues(rows);
}

function headerIndex_(headers) {
  const idx = {};
  headers.forEach((header, index) => idx[String(header).trim()] = index);
  return idx;
}

function getSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = props.getProperty(CONFIG.spreadsheetIdProperty);
  if (spreadsheetId) return SpreadsheetApp.openById(spreadsheetId);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error(`Set script property ${CONFIG.spreadsheetIdProperty} to your Google Sheet ID.`);
  return active;
}

function verifyToken_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty(CONFIG.apiTokenProperty);
  if (!expected) throw new Error(`Missing script property ${CONFIG.apiTokenProperty}.`);
  if (!token || token !== expected) throw new Error("Invalid API token.");
}

function json_(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

function number_(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function roundToIncrement_(value, increment) {
  if (!increment) return round2_(value);
  return round2_(Math.round(value / increment) * increment);
}

function round2_(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function startOfWorkWeek_(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toDate_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value)) return value;
  const d = new Date(value);
  return isNaN(d) ? null : d;
}

function formatDate_(date) {
  return Utilities.formatDate(date, CONFIG.timezone, "MMM d, yyyy");
}

function formatDateTime_(date) {
  return Utilities.formatDate(date, CONFIG.timezone, "MMM d, yyyy h:mm a");
}

function escapeHtml_(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
