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
  { id: 46,  name:"PPI",              icon:"📊", tag:"PPI",    cls:"tag-cpi"  },
  { id: 9,   name:"Retail Sales",     icon:"🛒", tag:"Retail", cls:"tag-jobs" },
];


// ── FRED: fetch release dates for a single release ───────────────
async function fetchReleaseDates(release, fredKey, from, to) {
  // include_release_dates_with_no_data=true is required to get future scheduled dates
  // (default=false excludes them since data hasn't been published yet)
  // Sort desc + limit=12 captures recent past + upcoming; we then filter by date field.
  const url = `https://api.stlouisfed.org/fred/release/dates`
    + `?release_id=${release.id}`
    + `&sort_order=desc`
    + `&limit=12`
    + `&include_release_dates_with_no_data=true`
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

// ── Handler ──────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");

  const fredKey = process.env.FRED_API_KEY;
  console.log("FRED_API_KEY present:", !!fredKey);

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

  // ── Sort and deduplicate FRED events ──
  const allEvents = [...fredEvents];

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

  console.log(`Total events: ${events.length} (all from FRED)`);

  const source = fredKey ? "fred" : "none";
  return res.status(200).json({ source, events });
};
