// Vercel Serverless Function — returns macro/Fed events as JSON
//
// Data sources:
//   FRED API  → CPI, NFP, PCE, GDP, PPI, Retail Sales release dates (auto-updated)
//   Hardcoded → FOMC meetings + Jackson Hole (not in FRED; published annually by the Fed)
//   Gemini    → time-sensitive descriptions for all events
//
// Required env vars: FRED_API_KEY, GEMINI_API_KEY

// ── FRED release IDs ─────────────────────────────────────────────
const FRED_RELEASES = [
  { id: 10,  name:"CPI",              icon:"📊", tag:"CPI",    cls:"tag-cpi"  },
  { id: 50,  name:"Nonfarm Payrolls", icon:"💼", tag:"jobs",   cls:"tag-jobs" },
  { id: 54,  name:"PCE Inflation",    icon:"📉", tag:"PCE",    cls:"tag-pce"  },
  { id: 53,  name:"GDP",              icon:"📈", tag:"GDP",    cls:"tag-cpi"  },
  { id: 31,  name:"PPI",              icon:"📊", tag:"PPI",    cls:"tag-cpi"  },
  { id: 84,  name:"Retail Sales",     icon:"🛒", tag:"Retail", cls:"tag-jobs" },
];

// ── Fixed events not available in FRED ───────────────────────────
// Source: federalreserve.gov/monetarypolicy/fomccalendars.htm
// Update annually (Fed publishes next year's schedule in December)
const FIXED_EVENTS = [
  { isoDate:"2026-07-28", icon:"🏛️",  name:"FOMC Meeting",       tag:"FOMC",   cls:"tag-fomc"  },
  { isoDate:"2026-07-29", icon:"🏛️",  name:"FOMC Rate Decision",  tag:"FOMC",   cls:"tag-fomc"  },
  { isoDate:"2026-08-27", icon:"🏔️",  name:"Jackson Hole Begins", tag:"J.Hole", cls:"tag-jhole" },
  { isoDate:"2026-08-29", icon:"🏔️",  name:"Fed Chair Keynote",   tag:"J.Hole", cls:"tag-jhole" },
  { isoDate:"2026-09-15", icon:"🏛️",  name:"FOMC Meeting",        tag:"FOMC",   cls:"tag-fomc"  },
  { isoDate:"2026-09-16", icon:"🏛️",  name:"FOMC Rate Decision",  tag:"FOMC",   cls:"tag-fomc"  },
];

// ── In-memory description cache ──────────────────────────────────
const descCache = {};

// ── FRED: fetch release dates for a single release ───────────────
async function fetchReleaseDates(release, fredKey, from, to) {
  const url = `https://api.stlouisfed.org/fred/release/dates`
    + `?release_id=${release.id}`
    + `&realtime_start=${from}`
    + `&realtime_end=${to}`
    + `&sort_order=asc`
    + `&include_release_dates_with_no_data=false`
    + `&api_key=${fredKey}`
    + `&file_type=json`;

  const r    = await fetch(url);
  if (!r.ok) throw new Error(`FRED HTTP ${r.status} for release ${release.id}`);
  const data = await r.json();
  const dates = (data.release_dates || [])
    .map(d => d.date || d.release_date)
    .filter(d => d >= from && d <= to);

  return dates.map(isoDate => ({
    isoDate,
    icon: release.icon,
    name: release.name,
    tag:  release.tag,
    cls:  release.cls,
    estimate: null,
    previous: null,
  }));
}

// ── Gemini: generate descriptions ────────────────────────────────
async function generateDescriptions(events, geminiKey) {
  const missing = events.filter(e => !descCache[`${e.name}::${e.isoDate}`]);
  if (!missing.length) { console.log("All descriptions cached."); return; }

  console.log(`Calling Gemini for ${missing.length} events...`);

  const eventList = missing.map(e => `"${e.name}" on ${e.isoDate}`).join("\n");

  const prompt = `You are a macro strategist. Today is ${new Date().toISOString().slice(0,10)}.

For each event below return a JSON array where each item has:
- "key": "name::date" (e.g. "CPI::2026-07-10")
- "desc": ONE sentence — what this release measures and what markets are specifically watching for this release.
- "implication": ONE sentence — likely equity market reaction (risk-on/off, sectors affected, rate cut odds).

Be specific and current. No generic textbook definitions. JSON array only, no markdown.

Events:
${eventList}`;

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: 2048,
            temperature: 0.2,
          },
        }),
      }
    );

    if (!r.ok) {
      const t = await r.text();
      console.error(`Gemini HTTP ${r.status}:`, t.slice(0, 300));
      return;
    }

    const data   = await r.json();
    const text   = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) { console.error("No Gemini text:", JSON.stringify(data).slice(0,200)); return; }

    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) { console.error("Not array:", text.slice(0,200)); return; }

    let count = 0;
    for (const item of parsed) {
      if (item?.key && item?.desc && item?.implication) {
        descCache[item.key] = { desc: item.desc, implication: item.implication };
        count++;
      }
    }
    console.log(`Gemini: cached ${count} descriptions.`);
  } catch (err) {
    console.error("Gemini exception:", err.message);
  }
}

// ── Handler ──────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");

  const fredKey   = process.env.FRED_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  console.log("FRED_API_KEY present:",   !!fredKey);
  console.log("GEMINI_API_KEY present:", !!geminiKey);

  const today = new Date();
  const from  = today.toISOString().slice(0, 10);
  const to    = new Date(today.getTime() + 90 * 86400000).toISOString().slice(0, 10);

  // ── Fetch FRED release dates in parallel ──
  let fredEvents = [];
  if (fredKey) {
    const results = await Promise.allSettled(
      FRED_RELEASES.map(r => fetchReleaseDates(r, fredKey, from, to))
    );
    for (const [i, result] of results.entries()) {
      if (result.status === "fulfilled") {
        fredEvents.push(...result.value);
        console.log(`FRED release ${FRED_RELEASES[i].id} (${FRED_RELEASES[i].name}): ${result.value.length} dates`);
      } else {
        console.error(`FRED release ${FRED_RELEASES[i].id} failed:`, result.reason?.message);
      }
    }
  }

  // ── Combine FRED + fixed events, filter to window, sort ──
  const fixedInWindow = FIXED_EVENTS.filter(e => e.isoDate >= from && e.isoDate <= to);
  const allEvents = [...fredEvents, ...fixedInWindow];

  // Deduplicate by name+date
  const seen = new Set();
  const events = allEvents
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
      return { ...e, date: `${mon} ${d.getUTCDate()}` };
    });

  console.log(`Total events: ${events.length} (${fredEvents.length} from FRED, ${fixedInWindow.length} fixed)`);

  // ── Generate descriptions via Gemini ──
  if (geminiKey && events.length) {
    await generateDescriptions(events, geminiKey);
  }

  const enriched = events.map(e => ({
    ...e,
    ...(descCache[`${e.name}::${e.isoDate}`] || { desc:"", implication:"" }),
  }));

  const source = fredKey ? "fred+fixed" : "fixed-only";
  return res.status(200).json({ source, events: enriched });
};
