// Vercel Serverless Function — returns macro/Fed events as JSON
//
// Flow:
//   1. FRED /release/dates  → upcoming CPI, NFP, PCE, GDP, PPI, Retail Sales dates
//   2. FRED /series/observations → last 2 readings per indicator (previous + prior)
//   3. Gemini gemini-2.5-flash  → 1-sentence desc + market implication per event
//
// Required env vars: FRED_API_KEY, GEMINI_API_KEY

// ── FRED release IDs (upcoming dates) ────────────────────────────
const FRED_RELEASES = [
  { id: 10, name:"CPI",              icon:"📊", tag:"CPI",    cls:"tag-cpi"  },
  { id: 50, name:"Nonfarm Payrolls", icon:"💼", tag:"jobs",   cls:"tag-jobs" },
  { id: 54, name:"PCE Inflation",    icon:"📉", tag:"PCE",    cls:"tag-pce"  },
  { id: 53, name:"GDP",              icon:"📈", tag:"GDP",    cls:"tag-cpi"  },
  { id: 46, name:"PPI",              icon:"📊", tag:"PPI",    cls:"tag-cpi"  },
  { id: 9,  name:"Retail Sales",     icon:"🛒", tag:"Retail", cls:"tag-jobs" },
];

// ── FRED series IDs (recent actual values) ────────────────────────
const FRED_SERIES = {
  "CPI":             { id:"CPIAUCSL",        units:"pc1", suffix:"%" },
  "Nonfarm Payrolls":{ id:"PAYEMS",          units:"chg", suffix:"K" },
  "PCE Inflation":   { id:"PCEPI",           units:"pc1", suffix:"%" },
  "GDP":             { id:"A191RL1Q225SBEA", units:"lin", suffix:"%" },
  "PPI":             { id:"PPIACO",          units:"pc1", suffix:"%" },
  "Retail Sales":    { id:"RSAFS",           units:"pc1", suffix:"%" },
};

const descCache = {};
let lastGeminiDebug = null; // temporary debug

// ── Fetch upcoming release dates for one release ──────────────────
async function fetchReleaseDates(release, fredKey, from, to) {
  const url = `https://api.stlouisfed.org/fred/release/dates`
    + `?release_id=${release.id}`
    + `&sort_order=desc&limit=12`
    + `&include_release_dates_with_no_data=true`
    + `&api_key=${fredKey}&file_type=json`;

  const r = await fetch(url);
  if (!r.ok) throw new Error(`FRED HTTP ${r.status} for release ${release.id}`);
  const data = await r.json();

  return (data.release_dates || [])
    .map(d => d.date || d.release_date)
    .filter(d => d >= from && d <= to)
    .map(isoDate => ({
      isoDate,
      icon: release.icon,
      name: release.name,
      tag:  release.tag,
      cls:  release.cls,
    }));
}

// ── Fetch last 2 observations for one series ──────────────────────
async function fetchSeriesValues(name, fredKey) {
  const s = FRED_SERIES[name];
  if (!s) return null;

  const url = `https://api.stlouisfed.org/fred/series/observations`
    + `?series_id=${s.id}`
    + `&units=${s.units}`
    + `&sort_order=desc&limit=2`
    + `&api_key=${fredKey}&file_type=json`;

  const r = await fetch(url);
  if (!r.ok) throw new Error(`FRED series HTTP ${r.status} for ${s.id}`);
  const data = await r.json();

  const obs = (data.observations || []).filter(o => o.value !== ".");
  if (!obs.length) return null;

  const fmt = (v, suffix) => {
    const n = parseFloat(v);
    if (isNaN(n)) return null;
    const rounded = Math.round(n * 10) / 10;
    if (suffix === "K") return (rounded > 0 ? "+" : "") + rounded + "K";
    return rounded + suffix;
  };

  return {
    previous: fmt(obs[0]?.value, s.suffix),
    prior:    fmt(obs[1]?.value, s.suffix),
    date:     obs[0]?.date,
  };
}

// ── Gemini descriptions ───────────────────────────────────────────
async function generateDescriptions(events, seriesData, geminiKey) {
  // Deduplicate by name — one description per indicator type
  const uniqueNames = [...new Set(events.map(e => e.name))];
  const missing = uniqueNames.filter(name => !descCache[name]);
  if (!missing.length) { console.log("All descriptions cached"); return; }

  const eventList = missing.map(name => {
    const s = seriesData[name];
    const ctx = s
      ? `last reading: ${s.previous}${s.prior ? `, prior: ${s.prior}` : ""} (as of ${s.date})`
      : "no recent data available";
    return `- "${name}" — ${ctx}`;
  }).join("\n");

  const prompt = `You are a senior macro strategist. Today is ${new Date().toISOString().slice(0,10)}.

For each economic indicator below, return a JSON array where each object has:
- "key": the exact indicator name (e.g. "CPI")
- "implication": 1 sentence — given the recent trend, what is the likely market reaction (equities, rates, USD) if the next print comes in hotter vs cooler than expected. Be specific to the current data, not generic.

JSON array only, no markdown.

Indicators:
${eventList}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: 4096,
            temperature: 0.2,
          },
        }),
      }
    );
    clearTimeout(timeout);

    if (!r.ok) {
      const errText = await r.text();
      lastGeminiDebug = { stage: "http_error", status: r.status, body: errText.slice(0, 400) };
      return;
    }

    const data = await r.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      lastGeminiDebug = { stage: "no_text", raw: JSON.stringify(data).slice(0, 400) };
      return;
    }

    let parsed;
    try { parsed = JSON.parse(text); }
    catch(e) {
      lastGeminiDebug = { stage: "json_parse_error", error: e.message, text: text.slice(0, 300) };
      return;
    }

    if (!Array.isArray(parsed)) {
      lastGeminiDebug = { stage: "not_array", text: text.slice(0, 200) };
      return;
    }

    for (const item of parsed) {
      if (item?.key && item?.implication) {
        descCache[item.key] = { desc: "", implication: item.implication };
      }
    }
    lastGeminiDebug = { stage: "ok", keys: Object.keys(descCache) };
  } catch (err) {
    lastGeminiDebug = { stage: "exception", error: err.message };
  }
}

// ── Handler ───────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");

  const fredKey   = process.env.FRED_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  console.log("FRED:", !!fredKey, "GEMINI:", !!geminiKey);

  const today = new Date();
  const from  = today.toISOString().slice(0, 10);
  const to    = new Date(today.getTime() + 90 * 86400000).toISOString().slice(0, 10);

  if (!fredKey) return res.status(200).json({ source:"none", events:[] });

  // ── 1. Fetch release dates + series values in parallel ──
  const [dateResults, seriesResults] = await Promise.all([
    Promise.allSettled(FRED_RELEASES.map(r => fetchReleaseDates(r, fredKey, from, to))),
    Promise.allSettled(FRED_RELEASES.map(r => fetchSeriesValues(r.name, fredKey))),
  ]);

  // Build events list
  let fredEvents = [];
  for (const [i, result] of dateResults.entries()) {
    if (result.status === "fulfilled") {
      fredEvents.push(...result.value);
      console.log(`${FRED_RELEASES[i].name}: ${result.value.length} dates`);
    } else {
      console.error(`${FRED_RELEASES[i].name} dates failed:`, result.reason?.message);
    }
  }

  // Build series lookup by name → { previous, prior, date }
  const seriesData = {};
  for (const [i, result] of seriesResults.entries()) {
    if (result.status === "fulfilled" && result.value) {
      seriesData[FRED_RELEASES[i].name] = result.value;
      console.log(`${FRED_RELEASES[i].name} series: ${result.value.previous}`);
    } else {
      console.error(`${FRED_RELEASES[i].name} series failed:`, result.reason?.message);
    }
  }

  // Deduplicate + sort + format date label
  const seen = new Set();
  const events = fredEvents
    .filter(e => {
      const key = `${e.name}::${e.isoDate}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.isoDate.localeCompare(b.isoDate))
    .map(e => {
      const d   = new Date(e.isoDate + "T00:00:00Z");
      const mon = d.toLocaleString("en-US", { month:"short", timeZone:"UTC" });
      const s   = seriesData[e.name];
      return {
        ...e,
        date:     `${mon} ${d.getUTCDate()}`,
        previous: s?.previous ?? null,
        prior:    s?.prior    ?? null,
      };
    });

  console.log(`Total events: ${events.length}`);

  // ── 2. Gemini descriptions ──
  if (geminiKey && events.length) {
    await generateDescriptions(events, seriesData, geminiKey);
  }

  const enriched = events.map(e => ({
    ...e,
    ...(descCache[e.name] || { desc:"", implication:"" }),
  }));

  return res.status(200).json({ source:"fred+gemini", events: enriched, _debug: lastGeminiDebug });
};
