// Vercel Serverless Function — returns macro/Fed events as JSON
// Uses Gemini to generate both event dates AND time-sensitive descriptions.
// Requires: GEMINI_API_KEY in Vercel environment variables

// In-memory cache — refreshed once per function instance lifecycle (~daily)
let cachedEvents   = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

const ICON_MAP = {
  "FOMC":                  "🏛️",
  "Fed Rate Decision":     "🏛️",
  "CPI":                   "📊",
  "PCE":                   "📉",
  "Nonfarm Payrolls":      "💼",
  "NFP":                   "💼",
  "GDP":                   "📈",
  "PPI":                   "📊",
  "Retail Sales":          "🛒",
  "Jackson Hole":          "🏔️",
  "ISM":                   "🏭",
  "Jobless Claims":        "💼",
  "Durable Goods":         "📦",
  "Default":               "📅",
};

const TAG_MAP = {
  "FOMC":             { tag:"FOMC",    cls:"tag-fomc"  },
  "Fed Rate Decision":{ tag:"FOMC",    cls:"tag-fomc"  },
  "CPI":              { tag:"CPI",     cls:"tag-cpi"   },
  "PCE":              { tag:"PCE",     cls:"tag-pce"   },
  "Nonfarm Payrolls": { tag:"jobs",    cls:"tag-jobs"  },
  "NFP":              { tag:"jobs",    cls:"tag-jobs"  },
  "GDP":              { tag:"GDP",     cls:"tag-cpi"   },
  "PPI":              { tag:"PPI",     cls:"tag-cpi"   },
  "Retail Sales":     { tag:"Retail",  cls:"tag-jobs"  },
  "Jackson Hole":     { tag:"J.Hole",  cls:"tag-jhole" },
  "ISM":              { tag:"PMI",     cls:"tag-cpi"   },
  "Jobless Claims":   { tag:"jobs",    cls:"tag-jobs"  },
  "Durable Goods":    { tag:"Durables",cls:"tag-jobs"  },
  "Default":          { tag:"Macro",   cls:"tag-cpi"   },
};

function getIcon(name) {
  const key = Object.keys(ICON_MAP).find(k => name.includes(k));
  return ICON_MAP[key] || ICON_MAP["Default"];
}

function getTag(name) {
  const key = Object.keys(TAG_MAP).find(k => name.includes(k));
  return TAG_MAP[key] || TAG_MAP["Default"];
}

async function fetchFromGemini(geminiKey, from, to) {
  const prompt = `You are a macro calendar data provider. Today is ${from}.

Return a JSON array of all major US macroeconomic events scheduled between ${from} and ${to} (inclusive).

Only include HIGH-IMPACT events: FOMC meetings and rate decisions, CPI, PCE, Nonfarm Payrolls (NFP), GDP, PPI, ISM Manufacturing PMI, ISM Services PMI, Retail Sales, Durable Goods Orders, Initial Jobless Claims (weekly — only include if it falls within the window), and Jackson Hole Symposium if applicable.

Each object must have these exact fields:
- "isoDate": "YYYY-MM-DD" (the scheduled release date)
- "name": short event name (e.g. "CPI", "FOMC Rate Decision", "Nonfarm Payrolls", "PCE Inflation", "GDP", "PPI", "ISM Manufacturing PMI", "Retail Sales", "Durable Goods Orders", "Initial Jobless Claims", "Jackson Hole Symposium")
- "estimate": consensus estimate as a string if known, otherwise null
- "previous": previous reading as a string if known, otherwise null
- "desc": 2 sentences — what this specific release measures and what markets are watching for this particular release given the current macro environment.
- "implication": 2 sentences — specific market reaction scenarios. Name directional bias for equities (risk-on/off), which sectors are most affected, and how the result ties to Fed rate cut odds.

Sort by isoDate ascending. Return only a valid JSON array, no markdown.`;

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: 4000,
          temperature: 0.2,
        },
      }),
    }
  );

  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Gemini HTTP ${r.status}: ${t.slice(0, 200)}`);
  }

  const data = await r.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no text: " + JSON.stringify(data).slice(0, 200));

  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("Gemini response is not an array");

  console.log(`Gemini returned ${parsed.length} macro events.`);

  return parsed
    .filter(e => e.isoDate && /^\d{4}-\d{2}-\d{2}$/.test(e.isoDate) && e.name)
    .map(e => {
      const d   = new Date(e.isoDate + "T00:00:00Z");
      const mon = d.toLocaleString("en-US", { month:"short", timeZone:"UTC" });
      const day = d.getUTCDate();
      const { tag, cls } = getTag(e.name);
      return {
        date:        `${mon} ${day}`,
        isoDate:     e.isoDate,
        icon:        getIcon(e.name),
        name:        e.name,
        tag,
        cls,
        estimate:    e.estimate || null,
        previous:    e.previous || null,
        desc:        e.desc        || "",
        implication: e.implication || "",
      };
    });
}

// ── Handler ──────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");

  const geminiKey = process.env.GEMINI_API_KEY;
  console.log("GEMINI_API_KEY present:", !!geminiKey);

  if (!geminiKey) {
    console.warn("GEMINI_API_KEY not set.");
    return res.status(200).json({ source:"unconfigured", events:[] });
  }

  // Serve from in-memory cache if still fresh
  const now = Date.now();
  if (cachedEvents && (now - cacheTimestamp) < CACHE_TTL_MS) {
    console.log("Serving from in-memory cache.");
    return res.status(200).json({ source:"gemini-cached", events: cachedEvents });
  }

  const today = new Date();
  const from  = today.toISOString().slice(0, 10);
  const to    = new Date(today.getTime() + 90 * 86400000).toISOString().slice(0, 10);

  try {
    const events = await fetchFromGemini(geminiKey, from, to);
    cachedEvents   = events;
    cacheTimestamp = now;
    return res.status(200).json({ source:"gemini", events });
  } catch (err) {
    console.error("Gemini failed:", err.message);
    // Return stale cache if available rather than empty
    if (cachedEvents) {
      return res.status(200).json({ source:"gemini-stale", events: cachedEvents });
    }
    return res.status(200).json({ source:"error", events:[] });
  }
};
