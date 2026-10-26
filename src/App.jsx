import { useEffect, useMemo, useRef, useState } from "react";

const PRIMARY = "#22303c";
const ACCENT = "#e07a1f";
const DARK = "#1a1a1a";
const BASE_RED = "#b91c1c";
const BLUE = "#1a5276";
const BROWN = "#784212";
const PURPLE = "#5b21b6";
const GREEN = "#166534";
const BG = "#f0f0f0";

// ---------- Materials (Revival pricing model "Job Cost" columns Y-AA; PolyTitan kit sizes) ----------
// Every material line is tracked in the unit inventory is counted in: gallons for polyurea/polyaspartic, kits for 3-gal kits.
const MATERIALS = {
  POLYUREA: { name: "Polyurea Basecoat", category: "Base Coat", coverage: 200, unit: "gal", step: 0.25, kitGallons: 15, ratio: "2:1", safety: 3, color: BASE_RED },
  FC1150: { name: "1150FC Basecoat", category: "Base Coat", coverage: 125, unit: "kit", kitGallons: 3, ratio: "2:1", safety: 1, color: BASE_RED },
  MVB: { name: "MVB Moisture Barrier", category: "Moisture Barrier", coverage: 125, unit: "kit", kitGallons: 3, ratio: "2:1", safety: 1, color: PURPLE },
  EPOXY_BASE: { id: "EPOXY_BASE", name: "Epoxy Basecoat", category: "Base Coat", coverage: 150, unit: "kit", kitGallons: 3, ratio: "2:1", safety: 1, color: BASE_RED },
  POLYASPARTIC: { id: "POLYASPARTIC", name: "Polyaspartic Topcoat", category: "Topcoat", coverage: 125, unit: "gal", step: 0.25, kitGallons: 10, ratio: "1:1", safety: 4, color: BLUE },
  HWU_TOP: { id: "HWU_TOP", name: "High-Wear Urethane Topcoat", category: "Topcoat", coverage: 600, unit: "gal", step: 1, kitGallons: 1, ratio: "single", safety: 1, color: BLUE },
  EPS_971: { id: "EPS_971", name: "971 EPS Epoxy Siloxane", category: "Clear Coat", coverage: 300, unit: "gal", step: 1, kitGallons: 1, ratio: "single", safety: 1, color: BLUE },
};

// Polyurea and 1150FC come in Gray, Tan and Clear; each color is its own inventory item.
const BASE_COLORS = [
  { id: "GRAY", label: "Gray" },
  { id: "TAN", label: "Tan" },
  { id: "CLEAR", label: "Clear" },
];

const FLAKE_TYPES = [
  { id: "CLASSIC", label: 'Classic 1/4" Flake', coverage: 250, hasColor: true },
  { id: "NATURAL_STONE", label: "Natural Stone Flake", coverage: 250, hasColor: true },
  { id: "QUARTZ", label: "Quartz", coverage: 50, hasColor: false },
];

// Colors from the Revival "2026 Flake & Chemical Sheet DSM" (On Hand - Flakes)
const CLASSIC_COLORS = ["Antler", "Basalt", "Cabin Fever", "Chestnut", "Coyote", "Creekbed", "Domino", "Granite", "Gravel", "Keystone", "Lanai Gray", "Mt. Everest", "Nightfall", "Orbit", "Outback", "Shoreline", "Silver Creek", "Stoney Creek", "Tidal Wave", "Wombat"];
const NATURAL_STONE_COLORS = ["Anchorage", "Armadillo", "Claystone", "Husky", "Shale", "Slate", "Turquoise"];
const OTHER_COLOR = "Other (write it in the notes)";

const FLAKE_SAFETY_BOXES = 0.25;

// Each system is its coats in order. "base" coats take the base color; "flake" is the broadcast.
const SYSTEMS = [
  { id: "polyurea_flake", label: "Polyurea Base + Flake + Polyaspartic", coats: ["POLYUREA", "flake", "POLYASPARTIC"] },
  { id: "mvb_polyurea_flake", label: "MVB + Polyurea + Flake + Polyaspartic", coats: ["MVB", "POLYUREA", "flake", "POLYASPARTIC"] },
  { id: "fc1150_flake", label: "1150FC Base + Flake + Polyaspartic", coats: ["FC1150", "flake", "POLYASPARTIC"] },
  { id: "full_poly", label: "Full Polyaspartic (Base + Flake + Top)", coats: ["POLYASPARTIC_BASE", "flake", "POLYASPARTIC"] },
  { id: "hwu", label: "Epoxy Base + High-Wear Urethane", coats: ["EPOXY_BASE", "HWU_TOP"] },
  { id: "grind_clear", label: "Grind & Clear (971 EPS)", coats: ["EPS_971"] },
];

const DEFAULT_ROSTER = [
  "Andrew Vance", "Benjamin Wyatt", "Hunter Schueler", "Izajah Martinez", "Jordan Dunesbery",
  "Joshua Fisher", "Kaleb McCollum", "Keegan DeYoung", "Luke Miller", "Mike Hunter", "Oscar Martinez",
];

// ---------- helpers ----------
function roundUpTo(value, step) {
  if (!value || !step) return 0;
  return Math.ceil((Number(value) - 1e-9) / step) * step;
}
function qty(value, decimals = 2) {
  const n = Number(value || 0);
  if (Math.abs(n - Math.round(n)) < 0.000001) return String(Math.round(n));
  return n.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "");
}
function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function plural(unit, n) {
  if (Number(n) === 1) return unit;
  return unit === "box" ? "boxes" : `${unit}s`;
}
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function quantitiesDiffer(a, b) {
  return Math.abs(safeNumber(a) - safeNumber(b)) > 0.000001;
}
function returnExplanationNeeded(lines, lineQuantities) {
  return lines.some((line) => quantitiesDiffer(lineQuantities[line.lineKey], line.safetyQty));
}
function splitRatio(total, ratio) {
  if (ratio === "1:1") return { partA: total / 2, partB: total / 2 };
  if (ratio === "single") return { partA: total, partB: 0 };
  return { partA: total * (2 / 3), partB: total / 3 };
}
function slug(text) {
  return String(text).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
}
function flakeColorsFor(flakeTypeId) {
  if (flakeTypeId === "NATURAL_STONE") return NATURAL_STONE_COLORS;
  if (flakeTypeId === "CLASSIC") return CLASSIC_COLORS;
  return [];
}

/** One material line per product. Full polyaspartic uses polyaspartic twice, so both coats become one line. */
function buildMaterialLines(system, opts, squareFeet) {
  const sf = safeNumber(squareFeet);
  if (!system || sf <= 0) return [];
  const gallonsByKey = {};
  const order = [];
  const add = (key, gallons) => {
    if (!(key in gallonsByKey)) { gallonsByKey[key] = 0; order.push(key); }
    gallonsByKey[key] += gallons;
  };
  for (const coat of system.coats) {
    if (coat === "flake") { add("flake", 0); continue; }
    const key = coat === "POLYASPARTIC_BASE" ? "POLYASPARTIC" : coat;
    add(key, sf / MATERIALS[key].coverage);
  }

  const baseColor = BASE_COLORS.find((c) => c.id === opts.baseColorId) || BASE_COLORS[0];
  const coatsOfPoly = system.coats.filter((c) => c === "POLYASPARTIC" || c === "POLYASPARTIC_BASE").length;
  const lines = [];
  for (const key of order) {
    if (key === "flake") {
      const type = FLAKE_TYPES.find((t) => t.id === opts.flakeTypeId) || FLAKE_TYPES[0];
      const colorName = type.hasColor ? (opts.flakeColor || flakeColorsFor(type.id)[0]) : "";
      const isOther = colorName === OTHER_COLOR;
      const materialId = type.hasColor ? `FLAKE_${type.id}_${isOther ? "OTHER" : slug(colorName)}` : "QUARTZ";
      const materialName = type.hasColor ? `${isOther ? "Other" : colorName} ${type.id === "NATURAL_STONE" ? "Natural Stone Flake" : "Flake"}` : "Quartz";
      const calculated = sf / type.coverage;
      const expected = roundUpTo(calculated, 0.25);
      lines.push({
        lineKey: "flake", category: type.id === "QUARTZ" ? "Quartz" : "Flake", materialId, materialName,
        unit: "box", step: 0.25, color: BROWN,
        expectedUse: expected, safetyQty: FLAKE_SAFETY_BOXES, recommendedLoad: roundUpTo(expected + FLAKE_SAFETY_BOXES, 0.25),
        detail: `${type.label}, ${qty(calculated)} calculated boxes at ${type.coverage} SF/box`,
      });
      continue;
    }
    const m = MATERIALS[key];
    const gallons = gallonsByKey[key];
    const takesColor = key === "POLYUREA" || key === "FC1150";
    const materialId = takesColor ? `${key}_${baseColor.id}` : (m.id || key);
    const materialName = takesColor ? `${m.name} - ${baseColor.label}` : m.name;
    const parts = splitRatio(gallons, m.ratio);
    const ab = parts.partB > 0 ? `${qty(parts.partA)} gal A + ${qty(parts.partB)} gal B` : `${qty(gallons)} gal`;
    const coatsNote = key === "POLYASPARTIC" && coatsOfPoly > 1 ? ` (${coatsOfPoly} coats)` : "";
    if (m.unit === "kit") {
      const expectedKits = Math.ceil(gallons / m.kitGallons - 1e-9);
      lines.push({
        lineKey: key, category: m.category, materialId, materialName, unit: "kit", step: 1, color: m.color,
        expectedUse: expectedKits, safetyQty: m.safety, recommendedLoad: expectedKits + m.safety,
        detail: `${ab} mixed, ${m.kitGallons}-gal kits (${qty(m.coverage * m.kitGallons)} SF/kit at ${m.coverage} SF/gal)`,
      });
    } else {
      const expected = roundUpTo(gallons, m.step);
      lines.push({
        lineKey: key, category: coatsNote ? "Base + Topcoat" : m.category, materialId, materialName: materialName + coatsNote, unit: "gal", step: m.step, color: m.color,
        expectedUse: expected, safetyQty: m.safety, recommendedLoad: roundUpTo(expected + m.safety, m.step),
        detail: `${ab} at ${m.coverage} SF/gal${coatsNote}, ${m.kitGallons}-gal kits`,
      });
    }
  }
  return lines;
}

// ---------- small components ----------
function Label({ children }) {
  return <label className="label">{children}</label>;
}
function SelectField({ label, value, onChange, children }) {
  return (
    <div className="field">
      <Label>{label}</Label>
      <div className="selectWrap">
        <select value={value} onChange={(event) => onChange(event.target.value)}>{children}</select>
        <span className="chevron">v</span>
      </div>
    </div>
  );
}
function TextField({ label, value, onChange, placeholder, required, list, type }) {
  return (
    <div className="field">
      <Label>{label}{required ? " *" : ""}</Label>
      <input className="textInput" type={type || "text"} value={value} list={list} placeholder={placeholder || ""} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

/** Tap names to mark who is on the job. The lead is always included. */
function CrewPicker({ label, roster, lead, selected, onToggle }) {
  return (
    <div className="field">
      <Label>{label}</Label>
      <div className="chips">
        {roster.filter((name) => name !== lead).map((name) => (
          <button type="button" key={name} className={`chip ${selected.includes(name) ? "on" : ""}`} onClick={() => onToggle(name)}>
            {selected.includes(name) ? "✓ " : ""}{name}
          </button>
        ))}
      </div>
      <div className="fieldHint">Tap everyone working this job with {lead || "the lead"}. This is how labor gets counted for the job.</div>
    </div>
  );
}

function MaterialCard({ line, value, onChange }) {
  return (
    <div className="materialCard" style={{ borderColor: line.color }}>
      <div className="materialTitleRow">
        <div>
          <div className="materialCategory">{line.category}</div>
          <div className="materialName">{line.materialName}</div>
          <div className="materialDetail">{line.detail}</div>
        </div>
        <div className="materialLoad" style={{ color: line.color }}>
          <div className="materialLoadNum">{qty(line.recommendedLoad)}</div>
          <div className="materialLoadUnit">load {plural(line.unit, line.recommendedLoad)}</div>
        </div>
      </div>
      <div className="useVsLoad">
        <div className="metricBox"><div className="metricLabel">Should use</div><div className="metricValue">{qty(line.expectedUse)} {plural(line.unit, line.expectedUse)}</div></div>
        <div className="metricBox safety"><div className="metricLabel">Safety margin</div><div className="metricValue">{qty(line.safetyQty)} {plural(line.unit, line.safetyQty)}</div></div>
      </div>
      <div className="qtyInputWrap">
        <div className="qtyInputLabel">Actual loaded</div>
        <input className="qtyInput" type="number" inputMode="decimal" min="0" step={line.step} value={value ?? ""} onChange={(event) => onChange(line.lineKey, event.target.value)} />
        <div className="qtyUnit">{plural(line.unit, value)}</div>
      </div>
    </div>
  );
}

function getMaterialColor(category) {
  const c = String(category || "").toLowerCase();
  if (c.includes("moisture")) return PURPLE;
  if (c.includes("base")) return BASE_RED;
  if (c.includes("flake") || c.includes("quartz")) return BROWN;
  return BLUE;
}
function normalizeReturnLines(job) {
  if (!job || !Array.isArray(job.lines)) return [];
  return job.lines.map((line, index) => ({
    lineKey: `return_${index}_${line.materialId || "material"}`,
    category: line.category || "Material",
    materialId: line.materialId || "",
    materialName: line.materialName || "Material",
    unit: line.unit || "unit",
    expectedUse: safeNumber(line.expectedUse),
    safetyQty: safeNumber(line.safetyQty),
    recommendedLoad: safeNumber(line.recommendedLoad),
    actualQty: safeNumber(line.actualQty || line.recommendedLoad),
    step: String(line.unit).toLowerCase() === "kit" || line.materialId === "HWU_TOP" || line.materialId === "EPS_971" ? 1 : 0.25,
    color: getMaterialColor(line.category),
  }));
}

function ReturnMaterialCard({ line, value, onChange }) {
  return (
    <div className="materialCard returnCard" style={{ borderColor: line.color }}>
      <div className="materialTitleRow">
        <div>
          <div className="materialCategory">{line.category}</div>
          <div className="materialName">{line.materialName}</div>
          <div className="materialDetail">Enter what came back to the shop. Use 0 if none returned.</div>
        </div>
        <div className="materialLoad" style={{ color: line.color }}>
          <div className="materialLoadNum">{qty(line.actualQty)}</div>
          <div className="materialLoadUnit">loaded {plural(line.unit, line.actualQty)}</div>
        </div>
      </div>
      <div className="returnMetrics">
        <span>Should use: <strong>{qty(line.expectedUse)} {plural(line.unit, line.expectedUse)}</strong></span>
        <span>Expected return: <strong>{qty(line.safetyQty)} {plural(line.unit, line.safetyQty)}</strong></span>
      </div>
      <div className="qtyInputWrap returnQtyInputWrap">
        <div className="qtyInputLabel">Returned to shop</div>
        <input className="qtyInput" type="number" inputMode="decimal" min="0" step={line.step} value={value ?? ""} placeholder="0" onChange={(event) => onChange(line.lineKey, event.target.value)} />
        <div className="qtyUnit">{plural(line.unit, value)}</div>
      </div>
    </div>
  );
}

// ---------- app ----------
export default function App() {
  const [mode, setMode] = useState("LOADOUT");
  const [systemId, setSystemId] = useState(SYSTEMS[0].id);
  const [baseColorId, setBaseColorId] = useState("GRAY");
  const [flakeTypeId, setFlakeTypeId] = useState("CLASSIC");
  const [flakeColor, setFlakeColor] = useState(CLASSIC_COLORS[0]);
  const [squareFeet, setSquareFeet] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [crewLead, setCrewLead] = useState("");
  const [crewMembers, setCrewMembers] = useState([]);
  const [workDate, setWorkDate] = useState(todayIso());
  const [signature, setSignature] = useState("");
  const [notes, setNotes] = useState("");
  const [lineQuantities, setLineQuantities] = useState({});
  const [status, setStatus] = useState({ type: "", text: "" });
  const [submitting, setSubmitting] = useState(false);
  const [roster, setRoster] = useState(DEFAULT_ROSTER);
  const [openJobs, setOpenJobs] = useState([]);
  const [scheduledJobs, setScheduledJobs] = useState([]);
  const [scheduledLoaded, setScheduledLoaded] = useState(false);
  const [selectedScheduledJob, setSelectedScheduledJob] = useState(null);
  const [selectedReturnJob, setSelectedReturnJob] = useState(null);
  const lastDefaultsKey = useRef("");

  const system = SYSTEMS.find((item) => item.id === systemId) || SYSTEMS[0];
  const hasFlake = system.coats.includes("flake");
  const takesBaseColor = system.coats.includes("POLYUREA") || system.coats.includes("FC1150");
  const flakeType = FLAKE_TYPES.find((t) => t.id === flakeTypeId) || FLAKE_TYPES[0];
  const sf = safeNumber(squareFeet || 0);
  const lines = useMemo(
    () => buildMaterialLines(system, { baseColorId, flakeTypeId, flakeColor }, sf),
    [system, baseColorId, flakeTypeId, flakeColor, sf]
  );
  const returnLines = useMemo(() => normalizeReturnLines(selectedReturnJob), [selectedReturnJob]);
  const needsReturnExplanation = mode === "RETURN" && selectedReturnJob ? returnExplanationNeeded(returnLines, lineQuantities) : false;
  const otherFlake = hasFlake && flakeType.hasColor && flakeColor === OTHER_COLOR;

  // loadout defaults: load the recommended quantity
  useEffect(() => {
    if (mode !== "LOADOUT") return;
    const key = `${systemId}|${baseColorId}|${flakeTypeId}|${flakeColor}|${sf}`;
    if (key === lastDefaultsKey.current) return;
    lastDefaultsKey.current = key;
    const defaults = {};
    lines.forEach((line) => { defaults[line.lineKey] = line.recommendedLoad; });
    setLineQuantities(defaults);
  }, [mode, systemId, baseColorId, flakeTypeId, flakeColor, sf, lines]);

  // crew roster (names exactly as in Gusto)
  useEffect(() => {
    let ignore = false;
    fetch("/.netlify/functions/material-api?action=roster")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => { if (!ignore && Array.isArray(data.roster) && data.roster.length) setRoster(data.roster); })
      .catch(() => {});
    return () => { ignore = true; };
  }, []);

  // scheduled jobs from the Revival Crew Schedule
  useEffect(() => {
    if (mode !== "LOADOUT") return;
    let ignore = false;
    fetch("/.netlify/functions/material-api?action=scheduledJobs")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => { if (!ignore && Array.isArray(data.jobs)) { setScheduledJobs(data.jobs); setScheduledLoaded(true); } })
      .catch(() => { if (!ignore) { setScheduledJobs([]); setScheduledLoaded(false); } });
    return () => { ignore = true; };
  }, [mode]);

  // open loadouts for returns
  useEffect(() => {
    if (mode !== "RETURN") return;
    let ignore = false;
    fetch("/.netlify/functions/material-api?action=openJobs")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => { if (!ignore && Array.isArray(data.jobs)) setOpenJobs(data.jobs); })
      .catch(() => { if (!ignore) setOpenJobs([]); });
    return () => { ignore = true; };
  }, [mode]);

  function applyScheduledJob(value) {
    setCustomerName(value);
    const typed = String(value).trim().toLowerCase();
    const match = scheduledJobs.find((job) => job.label.toLowerCase() === typed || job.customer.toLowerCase() === typed);
    setSelectedScheduledJob(match || null);
    if (match) {
      setCustomerName(match.customer);
      if (match.crewLead && roster.includes(match.crewLead)) setCrewLead(match.crewLead);
    }
  }

  function chooseFlakeType(id) {
    setFlakeTypeId(id);
    const colors = flakeColorsFor(id);
    if (colors.length && !colors.includes(flakeColor)) setFlakeColor(colors[0]);
  }

  function toggleMember(name) {
    setCrewMembers((current) => (current.includes(name) ? current.filter((n) => n !== name) : [...current, name]));
  }

  function chooseLead(name) {
    setCrewLead(name);
    setCrewMembers((current) => current.filter((n) => n !== name));
  }

  function switchMode(nextMode) {
    setMode(nextMode);
    setStatus({ type: "", text: "" });
    setLineQuantities({});
    setSignature("");
    setNotes("");
    setWorkDate(todayIso());
    setCustomerName("");
    setSelectedReturnJob(null);
    setSelectedScheduledJob(null);
    lastDefaultsKey.current = "";
  }

  function handleQtyChange(lineKey, value) {
    setLineQuantities((current) => ({ ...current, [lineKey]: value }));
  }

  function applyOpenJob(value) {
    setCustomerName(value);
    const typed = String(value).toLowerCase();
    const match = openJobs.find((job) => String(job.jobName || job.jobId).toLowerCase() === typed || String(job.jobId).toLowerCase() === typed);
    setSelectedReturnJob(match || null);
    setStatus({ type: "", text: "" });
    if (!match) { setLineQuantities({}); return; }
    setCrewLead(match.crewLead || "");
    setCrewMembers(String(match.crewMembers || "").split(",").map((s) => s.trim()).filter(Boolean));
    const defaults = {};
    normalizeReturnLines(match).forEach((line) => { defaults[line.lineKey] = ""; });
    setLineQuantities(defaults);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus({ type: "", text: "" });
    const isReturn = mode === "RETURN";
    const submissionLines = isReturn ? returnLines : lines;

    if (!isReturn) {
      if (!customerName.trim() || !crewLead || !signature.trim() || sf <= 0 || !workDate || submissionLines.length === 0) {
        setStatus({ type: "error", text: "Pick the job, crew lead, work date, square footage, and sign before submitting." });
        return;
      }
      if (otherFlake && !notes.trim()) {
        setStatus({ type: "error", text: "Write the flake color in the notes." });
        return;
      }
    } else {
      if (!selectedReturnJob || !signature.trim() || !crewLead || !workDate || submissionLines.length === 0) {
        setStatus({ type: "error", text: "Select the loaded job, confirm who was on the job, enter returned quantities, and sign." });
        return;
      }
      if (submissionLines.some((line) => lineQuantities[line.lineKey] === undefined || lineQuantities[line.lineKey] === "")) {
        setStatus({ type: "error", text: "Enter a return quantity for each material. Use 0 if none came back." });
        return;
      }
      if (returnExplanationNeeded(submissionLines, lineQuantities) && !notes.trim()) {
        setStatus({ type: "error", text: "Add an explanation when the returned amount is above or below the expected return." });
        return;
      }
    }

    const payload = {
      action: isReturn ? "submitReturn" : "submitLoadout",
      // Job ID = DripJobs project ID when picked from the crew schedule (exact match in every report)
      jobId: isReturn ? selectedReturnJob.jobId : (selectedScheduledJob ? selectedScheduledJob.projectId : customerName.trim()),
      jobName: isReturn ? (selectedReturnJob.jobName || selectedReturnJob.jobId) : customerName.trim(),
      crewLead,
      crewMembers: crewMembers.join(", "),
      workDate,
      systemId: isReturn ? (selectedReturnJob.systemId || "") : system.id,
      systemName: isReturn ? (selectedReturnJob.systemName || "") : system.label,
      squareFeet: isReturn ? safeNumber(selectedReturnJob.squareFeet) : sf,
      flakeId: isReturn ? (selectedReturnJob.flakeId || "") : (hasFlake ? flakeType.id : ""),
      signature: signature.trim(),
      notes: notes.trim(),
      lines: submissionLines.map((line) => ({
        materialId: line.materialId,
        materialName: line.materialName,
        category: line.category,
        unit: line.unit,
        expectedUse: Number(line.expectedUse || 0),
        safetyQty: Number(line.safetyQty || 0),
        recommendedLoad: Number(line.recommendedLoad || 0),
        actualQty: isReturn ? 0 : Number(lineQuantities[line.lineKey] || 0),
        returnQty: isReturn ? Number(lineQuantities[line.lineKey] || 0) : 0,
      })),
    };

    setSubmitting(true);
    try {
      const response = await fetch("/.netlify/functions/material-api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || "Submission failed");
      setStatus({ type: "success", text: `${isReturn ? "Return" : "Loadout"} sign-off saved.` });
      setSignature("");
      setNotes("");
      if (!isReturn) setSelectedScheduledJob(null);
      if (isReturn) {
        const returnedJobId = selectedReturnJob.jobId;
        setOpenJobs((current) => current.filter((job) => job.jobId !== returnedJobId));
        setSelectedReturnJob(null);
        setCustomerName("");
        setLineQuantities({});
      }
    } catch (error) {
      setStatus({ type: "error", text: error.message || "Could not submit. Check connection and try again." });
    } finally {
      setSubmitting(false);
    }
  }

  const crewSection = (
    <>
      <SelectField label={mode === "LOADOUT" ? "Crew lead *" : "Crew lead"} value={crewLead} onChange={chooseLead}>
        <option value="">Pick the crew lead</option>
        {roster.map((name) => <option key={name} value={name}>{name}</option>)}
      </SelectField>
      {crewLead && (
        <CrewPicker
          label={mode === "LOADOUT" ? "Who's on the job" : "Who was on the job today"}
          roster={roster}
          lead={crewLead}
          selected={crewMembers}
          onToggle={toggleMember}
        />
      )}
      <TextField label={mode === "LOADOUT" ? "Work date" : "Last day on the job"} type="date" value={workDate} onChange={setWorkDate} required />
    </>
  );

  return (
    <div className="page">
      <style>{styles}</style>
      <header className="header">
        <div className="headerContent">
          <div className="eyebrow">Revival Concrete Coatings</div>
          <h1>Material Loadout</h1>
          <div className="headerText">Load, return, and sign off materials and crew.</div>
        </div>
      </header>
      <div className="accentBar" />

      <main className="main">
        <div className="modeToggle" role="tablist" aria-label="Mode">
          <button type="button" className={mode === "LOADOUT" ? "active" : ""} onClick={() => switchMode("LOADOUT")}>Load trailer</button>
          <button type="button" className={mode === "RETURN" ? "active" : ""} onClick={() => switchMode("RETURN")}>Return materials</button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === "LOADOUT" ? (
            <>
              <TextField label="Customer" value={customerName} onChange={applyScheduledJob} placeholder="Start typing, then pick the job" required list="scheduled-jobs" />
              <datalist id="scheduled-jobs">
                {scheduledJobs.map((job) => <option key={job.projectId} value={job.label}>{job.crew || "No crew assigned"}</option>)}
              </datalist>
              {selectedScheduledJob ? (
                <div className="fieldHint jobMatch">Matched to the scheduled job{selectedScheduledJob.crew ? ` (${selectedScheduledJob.crew})` : ""}, {selectedScheduledJob.dates}.</div>
              ) : scheduledLoaded && customerName.trim().length > 2 ? (
                <div className="fieldHint jobNoMatch">Not on the crew schedule. Pick the job from the list, or check the spelling against the work order.</div>
              ) : null}

              {crewSection}

              <SelectField label="System" value={systemId} onChange={setSystemId}>
                {SYSTEMS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </SelectField>

              {takesBaseColor && (
                <SelectField label="Base color" value={baseColorId} onChange={setBaseColorId}>
                  {BASE_COLORS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </SelectField>
              )}

              {hasFlake && (
                <>
                  <SelectField label="Flake or quartz" value={flakeTypeId} onChange={chooseFlakeType}>
                    {FLAKE_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label} - {item.coverage} SF/box</option>)}
                  </SelectField>
                  {flakeType.hasColor && (
                    <SelectField label="Flake color" value={flakeColor} onChange={setFlakeColor}>
                      {[...flakeColorsFor(flakeTypeId), OTHER_COLOR].map((c) => <option key={c} value={c}>{c}</option>)}
                    </SelectField>
                  )}
                </>
              )}

              <div className="field">
                <Label>Square footage *</Label>
                <input type="number" inputMode="numeric" min="1" className={`sfInput ${sf > 0 ? "hasValue" : ""}`} placeholder="0" value={squareFeet} onChange={(event) => setSquareFeet(event.target.value)} />
                <div className="sfUnit">Square feet (from the work order)</div>
              </div>

              {sf > 0 ? (
                <section className="results">
                  <div className="resultsLabel">Use vs. load on trailer</div>
                  {lines.map((line) => <MaterialCard key={line.lineKey} line={line} value={lineQuantities[line.lineKey]} onChange={handleQtyChange} />)}
                </section>
              ) : (
                <div className="emptyBox">Enter square footage to calculate materials.</div>
              )}

              <div className="field">
                <Label>{otherFlake ? "Notes *" : "Notes"}</Label>
                <textarea className="notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={otherFlake ? "Write the flake color here." : "Optional"} />
              </div>
            </>
          ) : (
            <>
              <TextField label="Customer" value={customerName} onChange={applyOpenJob} placeholder="Start typing or select the loaded job" required list="open-jobs" />
              <datalist id="open-jobs">
                {openJobs.map((job) => <option key={job.jobId} value={job.jobName || job.jobId}>{job.systemName || "Open job"}</option>)}
              </datalist>
              {!selectedReturnJob ? (
                <div className="emptyBox">Select an open loadout, then enter what came back to the shop.</div>
              ) : (
                <>
                  <div className="returnSummary">
                    <div className="returnSummaryTitle">Loaded job found</div>
                    <div className="returnSummaryGrid">
                      <div><strong>System:</strong> {selectedReturnJob.systemName || "Not listed"}</div>
                      <div><strong>Square feet:</strong> {qty(selectedReturnJob.squareFeet)}</div>
                      <div><strong>Loaded:</strong> {selectedReturnJob.workDate || selectedReturnJob.timestamp}</div>
                    </div>
                  </div>
                  {crewSection}
                  <section className="results">
                    <div className="resultsLabel">Return quantities</div>
                    {returnLines.map((line) => <ReturnMaterialCard key={line.lineKey} line={line} value={lineQuantities[line.lineKey]} onChange={handleQtyChange} />)}
                  </section>
                  <div className="field">
                    <Label>{needsReturnExplanation ? "Usage explanation *" : "Usage explanation"}</Label>
                    <textarea className="notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Required if returned amount is above or below expected return. Example: extra coat, spill, shortage, change order, or material not used." />
                    <div className="fieldHint">Expected return is the safety margin. Explain any over-use or under-use.</div>
                  </div>
                </>
              )}
            </>
          )}

          {(mode === "LOADOUT" || selectedReturnJob) && (
            <TextField label="Signature" value={signature} onChange={setSignature} placeholder="Type full name" required />
          )}

          {status.text && <div className={`status ${status.type}`}>{status.text}</div>}

          {(mode === "LOADOUT" || selectedReturnJob) && (
            <button className="submitButton" type="submit" disabled={submitting}>
              {submitting ? "Saving..." : mode === "LOADOUT" ? "Sign loadout" : "Sign return"}
            </button>
          )}
        </form>
      </main>

      <footer className="footer">Revival material calculator - field use only</footer>
    </div>
  );
}

const styles = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800;900&family=Barlow:wght@400;500;600&display=swap');
* { box-sizing: border-box; }
body { margin: 0; background: ${BG}; font-family: 'Barlow', sans-serif; color: ${DARK}; }
button, input, select, textarea { font: inherit; }
.page { max-width: 480px; min-height: 100vh; margin: 0 auto; background: ${BG}; }
.header { background: ${PRIMARY}; color: #fff; padding: 20px 20px 22px; position: relative; overflow: hidden; }
.header:after { content: ''; position: absolute; width: 130px; height: 130px; border-radius: 50%; right: -34px; bottom: -38px; background: rgba(255,255,255,.06); }
.headerContent { position: relative; z-index: 1; }
.eyebrow { font-family: 'Barlow Condensed', sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; opacity: .75; }
h1 { font-family: 'Barlow Condensed', sans-serif; font-size: 34px; line-height: 1; margin: 4px 0; font-weight: 900; }
.headerText { font-size: 13px; opacity: .86; }
.accentBar { height: 4px; background: ${ACCENT}; }
.main { padding: 18px 16px 24px; }
.modeToggle { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; background: #fff; padding: 6px; border-radius: 14px; border: 1px solid #ddd; margin-bottom: 16px; }
.modeToggle button { border: 0; border-radius: 10px; padding: 12px 8px; background: transparent; color: #777; font-family: 'Barlow Condensed', sans-serif; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; }
.modeToggle button.active { background: ${DARK}; color: #fff; }
.field { margin-bottom: 14px; }
.label { display: block; font-family: 'Barlow Condensed', sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #888; margin-bottom: 6px; }
.fieldHint { color: #888; font-size: 12px; margin-top: 6px; line-height: 1.35; }
.jobMatch { color: ${GREEN}; font-weight: 700; margin-top: -8px; margin-bottom: 14px; }
.jobNoMatch { color: #b45309; font-weight: 700; margin-top: -8px; margin-bottom: 14px; }
.selectWrap { position: relative; }
.chevron { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); color: #aaa; pointer-events: none; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; }
select, .textInput, .notes { width: 100%; border: 2px solid #e0e0e0; border-radius: 10px; background: #fff; color: ${DARK}; padding: 13px 14px; outline: none; }
select { appearance: none; padding-right: 42px; }
select:focus, .textInput:focus, .notes:focus { border-color: ${ACCENT}; }
.notes { min-height: 80px; resize: vertical; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { border: 2px solid #ddd; background: #fff; color: #555; border-radius: 999px; padding: 9px 13px; font-weight: 600; font-size: 14px; }
.chip.on { border-color: ${PRIMARY}; background: ${PRIMARY}; color: #fff; }
.sfInput { width: 100%; padding: 16px; text-align: center; font-family: 'Barlow Condensed', sans-serif; font-size: 56px; font-weight: 900; border: 3px solid #e0e0e0; border-radius: 10px; background: #fff; color: #bbb; outline: none; }
.sfInput.hasValue { border-color: ${ACCENT}; color: ${DARK}; }
.sfUnit { text-align: center; margin-top: 4px; font-family: 'Barlow Condensed', sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #bbb; }
.resultsLabel { font-family: 'Barlow Condensed', sans-serif; font-size: 10px; font-weight: 800; color: #888; letter-spacing: 2px; text-transform: uppercase; margin: 2px 0 10px; }
.materialCard { background: #fff; border: 3px solid; border-radius: 14px; padding: 14px; margin-bottom: 12px; box-shadow: 0 1px 0 rgba(0,0,0,.04); }
.materialTitleRow { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.materialCategory { font-family: 'Barlow Condensed', sans-serif; font-size: 10px; font-weight: 800; color: #888; letter-spacing: 2px; text-transform: uppercase; }
.materialName { font-weight: 700; font-size: 16px; margin-top: 2px; }
.materialDetail { color: #999; font-size: 12px; margin-top: 2px; }
.materialLoad { text-align: right; min-width: 78px; }
.materialLoadNum { font-family: 'Barlow Condensed', sans-serif; font-size: 46px; line-height: .9; font-weight: 900; }
.materialLoadUnit { font-family: 'Barlow Condensed', sans-serif; font-size: 12px; font-weight: 800; text-transform: uppercase; }
.useVsLoad { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
.metricBox { background: #f6f6f6; border-radius: 10px; padding: 10px; }
.metricBox.safety { background: #fff7db; }
.metricLabel { color: #888; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .8px; }
.metricValue { font-family: 'Barlow Condensed', sans-serif; font-size: 22px; font-weight: 900; margin-top: 2px; }
.qtyInputWrap { margin-top: 12px; display: grid; grid-template-columns: 1fr 95px 44px; gap: 8px; align-items: center; }
.qtyInputLabel { color: #777; font-size: 13px; font-weight: 700; }
.qtyInput { width: 100%; border: 2px solid #ddd; border-radius: 10px; padding: 10px; text-align: center; font-family: 'Barlow Condensed', sans-serif; font-size: 24px; font-weight: 900; }
.qtyUnit { font-family: 'Barlow Condensed', sans-serif; font-size: 13px; font-weight: 800; color: #777; text-transform: uppercase; }
.emptyBox { background: #fff; border: 2px dashed #ddd; color: #aaa; border-radius: 14px; padding: 28px 16px; text-align: center; margin-bottom: 16px; font-weight: 700; }
.returnSummary { background: #fff; border: 1px solid #ddd; border-radius: 14px; padding: 13px 14px; margin-bottom: 14px; }
.returnSummaryTitle { font-family: 'Barlow Condensed', sans-serif; font-size: 14px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; color: ${DARK}; margin-bottom: 6px; }
.returnSummaryGrid { display: grid; gap: 4px; font-size: 12px; color: #666; }
.returnMetrics { display: grid; gap: 4px; margin-top: 10px; padding: 10px; background: #f6f6f6; border-radius: 10px; font-size: 12px; color: #666; }
.returnQtyInputWrap { grid-template-columns: 1fr 110px 44px; }
.status { border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; font-weight: 700; }
.status.success { background: #dcfce7; color: ${GREEN}; border: 1px solid #86efac; }
.status.error { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
.submitButton { width: 100%; border: 0; background: ${DARK}; color: #fff; border-radius: 12px; padding: 15px 18px; font-family: 'Barlow Condensed', sans-serif; font-size: 18px; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; }
.submitButton:disabled { opacity: .55; }
.footer { background: ${DARK}; color: rgba(255,255,255,.42); text-align: center; padding: 16px 20px; font-family: 'Barlow Condensed', sans-serif; font-size: 10px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; }
input[type=number]::-webkit-outer-spin-button, input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }
input[type=number] { -moz-appearance: textfield; }
`;
