// Work order add-ons. Reps fill three lines in the DripJobs crew notes:
//   Verticals (linear ft): 33            "33 @ 12in", "20 ft x 18"" (height defaults to 6")
//   Stairs (# of steps): 3               "1 staircase" / "2 flights" (75 sq ft each)
//   Extra topcoat: None / High-Wear Urethane / Polyaspartic
// The app turns them into extra sq ft (verticals, stairs) and an extra topcoat line.
// This file is the same in the PFC and Revival apps.

export const VERTICAL_DEFAULT_IN = 6;
export const SQFT_PER_STEP = 4;
export const SQFT_PER_STAIRCASE = 75;

const LABELS = /(?:^|\s)(?:verticals?\s*(?:\(|:)|stairs?\s*(?:\(|:)|extra\s+top\s*coat\s*:)/i;

export function plainNotes(notes) {
  return String(notes || "")
    .replace(/<\/(p|div|li|h\d)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;|&rdquo;|&ldquo;/gi, '"').replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[ \t]+/g, " ");
}

// value after "Label (...):" up to the end of the line or the next template label
function field(text, labelRe) {
  const m = text.match(labelRe);
  if (!m) return null;
  let rest = text.slice(m.index + m[0].length).split("\n")[0];
  const next = rest.match(LABELS);
  if (next) rest = rest.slice(0, next.index);
  return rest.trim();
}

const num = (s) => Number(String(s).replace(/,/g, ""));

/** Reads the add-on lines from crew notes (HTML or text). Blank or unfilled lines read as nothing. */
export function parseAddons(notes) {
  const text = plainNotes(notes);
  const out = { verticalFt: 0, verticalIn: VERTICAL_DEFAULT_IN, steps: 0, staircases: 0, extraTopcoat: "", found: false, mention: "" };

  const v = field(text, /verticals?\s*(?:\([^)]*\))?\s*:/i);
  if (v !== null) {
    out.found = true;
    let rest = v;
    const h = rest.match(/(\d+(?:\.\d+)?)\s*(?:"|''|in\b|inch(?:es)?\b)\s*(?:high|tall)?/i);
    if (h) { out.verticalIn = num(h[1]); rest = rest.slice(0, h.index) + " " + rest.slice(h.index + h[0].length); }
    out.verticalFt = (rest.match(/\d[\d,]*(?:\.\d+)?/g) || []).map(num).reduce((a, b) => a + b, 0);
  }

  const s = field(text, /stairs?\s*(?:\([^)]*\))?\s*:/i);
  if (s !== null) {
    out.found = true;
    const flights = s.match(/(\d+(?:\.\d+)?)\s*(?:stair\s*cases?|flights?|full)/i);
    if (flights) out.staircases = num(flights[1]);
    else if (/stair\s*case|flight/i.test(s)) out.staircases = 1;
    const rest = flights ? s.slice(0, flights.index) + s.slice(flights.index + flights[0].length) : s;
    const steps = rest.match(/\d+(?:\.\d+)?/);
    if (steps) out.steps = num(steps[0]);
  }

  const t = field(text, /extra\s+top\s*coat\s*(?:\([^)]*\))?\s*:/i);
  if (t !== null) {
    out.found = true;
    const unfilled = /none/i.test(t) && /urethane/i.test(t) && /poly/i.test(t);   // the template's option list left as is
    if (!unfilled && !/^\s*(none|no|n\/a|-)?\s*$/i.test(t)) {
      if (/urethane|hwu|high[\s-]*wear/i.test(t)) out.extraTopcoat = "HWU";
      else if (/poly/i.test(t)) out.extraTopcoat = "POLYASPARTIC";
    }
  }

  // older work orders: free text that mentions add-ons but has no template numbers
  if (!out.found) {
    const hits = [];
    if (/vertical/i.test(text) && !/no verticals?/i.test(text)) hits.push("verticals");
    if (/\bstairs?\b|\bsteps?\b/i.test(text)) hits.push("stairs");
    if (/(extra|second|2nd|additional)\s+(top\s*coat|coat)|high[\s-]*wear|urethane/i.test(text)) hits.push("an extra topcoat");
    if (hits.length) out.mention = `The work order notes mention ${hits.join(" and ")}. Check the work order and enter any add-ons below.`;
  }
  return out;
}

/** Extra sq ft from verticals and stairs. */
export function addonSqft(a) {
  const vertical = (Number(a.verticalFt) || 0) * (Number(a.verticalIn) || 0) / 12;
  const stairs = (Number(a.steps) || 0) * SQFT_PER_STEP + (Number(a.staircases) || 0) * SQFT_PER_STAIRCASE;
  return { vertical, stairs, total: vertical + stairs };
}

/** One line for the sheet, e.g. "Verticals 33 ft x 6in (16.5 sf); Stairs 3 steps (12 sf); Extra topcoat HWU". */
export function addonSummary(a) {
  const parts = [];
  const sq = addonSqft(a);
  if (Number(a.verticalFt) > 0) parts.push(`Verticals ${a.verticalFt} ft x ${a.verticalIn}in (${round1(sq.vertical)} sf)`);
  if (Number(a.steps) > 0 || Number(a.staircases) > 0) {
    const bits = [];
    if (Number(a.steps) > 0) bits.push(`${a.steps} steps`);
    if (Number(a.staircases) > 0) bits.push(`${a.staircases} staircase${Number(a.staircases) === 1 ? "" : "s"}`);
    parts.push(`Stairs ${bits.join(" + ")} (${round1(sq.stairs)} sf)`);
  }
  if (a.extraTopcoat) parts.push(`Extra topcoat ${a.extraTopcoat === "HWU" ? "High-Wear Urethane" : "Polyaspartic"}`);
  return parts.join("; ");
}

function round1(n) { return Math.round(n * 10) / 10; }

/**
 * Adds the extra topcoat to the material lines: merged into the same product's line when the system already uses it,
 * otherwise a new line. extra = { materialId, materialName, coverage, step, safety, color }.
 */
export function withExtraTopcoat(lines, extra, area, roundUpTo, qty) {
  if (!extra || !(area > 0)) return lines;
  const gallons = area / extra.coverage;
  const expected = roundUpTo(gallons, extra.step);
  const same = lines.find((l) => l.materialId === extra.materialId);
  if (same) {
    const expectedUse = roundUpTo(Number(same.expectedUse) + expected, same.step);
    return lines.map((l) => (l !== same ? l : {
      ...l,
      materialName: l.materialName + " + extra coat",
      expectedUse,
      recommendedLoad: roundUpTo(expectedUse + Number(l.safetyQty), l.step),
      detail: `${l.detail}; plus extra coat ${qty(gallons)} gal`,
    }));
  }
  return lines.concat({
    lineKey: "extra_topcoat", category: "Extra Topcoat", materialId: extra.materialId, materialName: extra.materialName,
    unit: "gal", step: extra.step, color: extra.color,
    expectedUse: expected, safetyQty: extra.safety, recommendedLoad: roundUpTo(expected + extra.safety, extra.step),
    detail: `Extra coat: ${qty(gallons)} gal at ${extra.coverage} SF/gal over ${Math.round(area)} sq ft`,
  });
}
