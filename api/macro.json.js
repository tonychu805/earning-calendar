// Vercel Serverless Function — returns macro/Fed events as JSON
// Requires: FINNHUB_API_KEY + GEMINI_API_KEY in Vercel environment variables

const MACRO_FILTERS = [
  { match:"fed interest rate",    icon:"🏛️", label:"Fed Rate Decision",       tag:"FOMC",    cls:"tag-fomc"  },
  { match:"fomc",                 icon:"🏛️", label:"FOMC",                    tag:"FOMC",    cls:"tag-fomc"  },
  { match:"federal open market",  icon:"🏛️", label:"FOMC",                    tag:"FOMC",    cls:"tag-fomc"  },
  { match:"consumer price index", icon:"📊", label:"CPI",                     tag:"CPI",     cls:"tag-cpi"   },
  { match:"cpi",                  icon:"📊", label:"CPI",                     tag:"CPI",     cls:"tag-cpi"   },
  { match:"nonfarm payroll",      icon:"💼", label:"Nonfarm Payrolls (NFP)",  tag:"jobs",    cls:"tag-jobs"  },
  { match:"non-farm payroll",     icon:"💼", label:"Nonfarm Payrolls (NFP)",  tag:"jobs",    cls:"tag-jobs"  },
  { match:"unemployment rate",    icon:"💼", label:"Unemployment Rate",       tag:"jobs",    cls:"tag-jobs"  },
  { match:"personal consumption", icon:"📉", label:"PCE Inflation",           tag:"PCE",     cls:"tag-pce"   },
  { match:"core pce",             icon:"📉", label:"Core PCE",                tag:"PCE",     cls:"tag-pce"   },
  { match:"pce",                  icon:"📉", label:"PCE Inflation",           tag:"PCE",     cls:"tag-pce"   },
  { match:"gdp",                  icon:"📈", label:"GDP",                     tag:"GDP",     cls:"tag-cpi"   },
  { match:"jackson hole",         icon:"🏔️", label:"Jackson Hole Symposium", tag:"J.Hole",  cls:"tag-jhole" },
  { match:"retail sales",         icon:"🛒", label:"Retail Sales",            tag:"Retail",  cls:"tag-jobs"  },
  { match:"producer price",       icon:"📊", label:"PPI",                     tag:"PPI",     cls:"tag-cpi"   },
  { match:"ppi",                  icon:"📊", label:"PPI",                     tag:"PPI",     cls:"tag-cpi"   },
  { match:"ism manufacturing",    icon:"🏭", label:"ISM Manufacturing PMI",   tag:"PMI",     cls:"tag-cpi"   },
  { match:"ism services",         icon:"🏭", label:"ISM Services PMI",        tag:"PMI",     cls:"tag-cpi"   },
  { match:"durable goods",        icon:"📦", label:"Durable Goods Orders",    tag:"Durables",cls:"tag-jobs"  },
  { match:"initial jobless",      icon:"💼", label:"Initial Jobless Claims",  tag:"jobs",    cls:"tag-jobs"  },
  { match:"jobless claims",       icon:"💼", label:"Initial Jobless Claims",  tag:"jobs",    cls:"tag-jobs"  },
];

// In-memory cache — keyed by "label::isoDate" for per-release context
const descCache = {};

function matchMacro(eventName) {
  const lower = (eventName || "").toLowerCase();
  return MACRO_FILTERS.find(f => lower.includes(f.match));
}

// ── Finnhub: fetch economic calendar ────────────────────────────
async function fetchFinnhubMacro(finnhubKey, from, to) {
  const url = `https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${finnhubKey}`;
  const r    = await fetch(url);

  if (!r.ok) throw new Error(`Finnhub HTTP ${r.status}`);

  const data = await r.json();
  // Finnhub returns { economicCalendar: [...] }
  const rows = data?.economicCalendar || data;
  if (!Array.isArray(rows)) throw new Error("Unexpected Finnhub response shape");

  const seen   = new Set();
  const events = [];

  for (const row of rows) {
    // Filter: US + high impact only
    if ((row.country || "").toUpperCase() !== "US") continue;
    if ((row.impact  || "").toLowerCase()  !== "high") continue;

    const macro = matchMacro(row.event);
    if (!macro) continue;

    // Finnhub date is YYYY-MM-DD or YYYY-MM-DD HH:mm:ss
    const isoDate = (row.time || row.date || "").slice(0, 10);
    if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) continue;

    const key = `${macro.label}::${isoDate}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const d   = new Date(isoDate + "T00:00:00Z");
    const mon = d.toLocaleString("en-US", { month:"short", timeZone:"UTC" });
    const day = d.getUTCDate();

    events.push({
      date:     `${mon} ${day}`,
      isoDate,
      icon:     macro.icon,
      name:     macro.label,
      tag:      macro.tag,
      cls:      macro.cls,
      estimate: row.estimate != null ? String(row.estimate) : null,
      previous: row.prev     != null ? String(row.prev)     : null,
    });
  }

  events.sort((a, b) => a.isoDate.localeCompare(b.isoDate));
  return events;
}

// ── Gemini: generate time-sensitive descriptions ─────────────────
async function generateDescriptions(events, geminiKey) {
  const missing = events.filter(e => !descCache[`${e.name}::${e.isoDate}`]);
  if (!missing.length) { console.log("All descriptions cached."); return; }

  console.log(`Calling Gemini for ${missing.length} events...`);

  const eventList = missing.map(e => {
    const parts = [`name: "${e.name}"`, `date: "${e.isoDate}"`];
    if (e.estimate) parts.push(`consensus estimate: ${e.estimate}`);
    if (e.previous) parts.push(`previous reading: ${e.previous}`);
    return `{ ${parts.join(", ")} }`;
  }).join("\n");

  const prompt = `You are a sell-side macro strategist writing a concise calendar briefing for equity investors. Today's date is ${new Date().toISOString().slice(0,10)}.

For each upcoming US macroeconomic event below, return a JSON array. Each element must have:
- "key": the string "name::date" exactly as given (e.g. "CPI::2026-07-10")
- "desc": 2 sentences — what this specific release measures and what is being watched this time. Reference the estimate and/or previous reading where provided.
- "implication": 2 sentences — how equity markets are likely to react. Be specific: name directional bias (risk-on / risk-off), which sectors are affected, and how it ties to rate cut odds.

Be concise, factual, and time-sensitive. Do not write generic textbook definitions. Return only a valid JSON array, no markdown fences.

Events:
${eventList}`;

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: 2000,
            temperature: 0.3,
          },
        }),
      }
    );

    if (!r.ok) {
      const t = await r.text();
      console.error(`Gemini HTTP ${r.status}:`, t.slice(0, 200));
      return;
    }

    const data = await r.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) { console.error("Gemini returned no text:", JSON.stringify(data).slice(0,200)); return; }

    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) { console.error("Gemini response not array:", text.slice(0,200)); return; }

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

  const finnhubKey = process.env.FINNHUB_API_KEY;
  const geminiKey  = process.env.GEMINI_API_KEY;

  console.log("FINNHUB_API_KEY present:", !!finnhubKey);
  console.log("GEMINI_API_KEY present:",  !!geminiKey);

  const today = new Date();
  const from  = today.toISOString().slice(0, 10);
  const to    = new Date(today.getTime() + 90 * 86400000).toISOString().slice(0, 10);

  let events = [];
  let source = "empty";

  if (finnhubKey) {
    try {
      events = await fetchFinnhubMacro(finnhubKey, from, to);
      source = "finnhub";
      console.log(`Finnhub returned ${events.length} matching events.`);
    } catch (err) {
      console.error("Finnhub fetch failed:", err.message);
    }
  }

  if (geminiKey && events.length) {
    await generateDescriptions(events, geminiKey);
  }

  const enriched = events.map(e => ({
    ...e,
    ...(descCache[`${e.name}::${e.isoDate}`] || { desc:"", implication:"" }),
  }));

  return res.status(200).json({ source, events: enriched });
};
