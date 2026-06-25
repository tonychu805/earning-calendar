// Vercel Serverless Function
// Set FMP_API_KEY in Vercel → Settings → Environment Variables
// Free key: https://financialmodelingprep.com/developer/docs

const SECTORS = {
  Technology: [
    // Semiconductors
    "NVDA","AVGO","AMD","TSM","ASML","MU","MRVL","SMCI","INTC","QCOM","NXPI","ALGM","PENG","ARM","AMAT","LRCX","KLAC",
    // Hardware & Infrastructure
    "ANET","DELL","HPE","VRT","CIEN","COHR","LITE","STX","WDC",
    // Software & Cloud
    "MSFT","GOOGL","GOOG","AMZN","META","BABA","PLTR","ADBE","SNOW","CRM","NOW","PATH","PANW","CRWD","ACN",
    // Other Tech
    "AAPL","TSLA","ORCL","NFLX","IBM","CSCO","TXN","INTU","HPQ",
  ],
  Energy:  ["XOM","CVX","COP","EOG","SLB","PSX","VLO","MPC","OXY","HES","HAL","BKR","DVN","WMB","KMI","OKE","APA","MRO","CTRA","TRGP","PXD"],
  Finance: ["JPM","BAC","WFC","C","GS","MS","AXP","BLK","SCHW","USB","PNC","TFC","COF","V","MA","PYPL","FIS","FI","GPN","ADP","PAYX","PRU","MET","AIG","CB","MMC","AON","ICE","CME","NDAQ"],
};

const SECTOR_MAP = {};
for (const [name, tickers] of Object.entries(SECTORS)) {
  for (const t of tickers) SECTOR_MAP[t] = name;
}

// Map FMP economic event names → display label + icon
// Matched via substring (case-insensitive)
const MACRO_FILTERS = [
  { match:"fed interest rate",    icon:"🏛️", label:"Fed Rate Decision"         },
  { match:"fomc",                 icon:"🏛️", label:"FOMC"                      },
  { match:"federal open market",  icon:"🏛️", label:"FOMC"                      },
  { match:"consumer price index", icon:"📊", label:"CPI"                       },
  { match:"cpi ",                 icon:"📊", label:"CPI"                       },
  { match:"nonfarm payroll",      icon:"💼", label:"Nonfarm Payrolls (NFP)"    },
  { match:"non farm payroll",     icon:"💼", label:"Nonfarm Payrolls (NFP)"    },
  { match:"unemployment rate",    icon:"💼", label:"Unemployment Rate"         },
  { match:"personal consumption", icon:"📉", label:"PCE Inflation"             },
  { match:"pce",                  icon:"📉", label:"PCE"                       },
  { match:"core pce",             icon:"📉", label:"Core PCE"                  },
  { match:"gdp",                  icon:"📈", label:"GDP"                       },
  { match:"jackson hole",         icon:"🏔️",  label:"Jackson Hole Symposium"   },
  { match:"retail sales",         icon:"🛒", label:"Retail Sales"              },
  { match:"producer price",       icon:"📊", label:"PPI"                       },
  { match:"ppi",                  icon:"📊", label:"PPI"                       },
  { match:"ism manufacturing",    icon:"🏭", label:"ISM Manufacturing PMI"     },
  { match:"ism services",         icon:"🏭", label:"ISM Services PMI"          },
  { match:"durable goods",        icon:"📦", label:"Durable Goods Orders"      },
  { match:"initial jobless",      icon:"💼", label:"Initial Jobless Claims"    },
];

function matchMacro(eventName) {
  const lower = (eventName||"").toLowerCase();
  return MACRO_FILTERS.find(f => lower.includes(f.match));
}

const ymd = d => d.slice(0,10).replace(/-/g,"");
const addDay = d => {
  const dt = new Date(d.slice(0,10)+"T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate()+1);
  return dt.toISOString().slice(0,10).replace(/-/g,"");
};
const esc = s => String(s??"").replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\n/g,"\\n");
const stamp = () => new Date().toISOString().replace(/[-:]/g,"").split(".")[0]+"Z";

// ── Demo fallback ────────────────────────────────────────────────
const DEMO_EARNINGS = [
  {symbol:"AAPL",date:"2026-07-30",fiscalDateEnding:"2026-06-30",epsEstimated:"1.88",time:"amc",sector:"Technology"},
  {symbol:"MSFT",date:"2026-07-29",fiscalDateEnding:"2026-06-30",epsEstimated:"3.10",time:"amc",sector:"Technology"},
  {symbol:"NVDA",date:"2026-08-20",fiscalDateEnding:"2026-07-31",epsEstimated:"0.85",time:"amc",sector:"Technology"},
  {symbol:"GOOGL",date:"2026-07-29",fiscalDateEnding:"2026-06-30",epsEstimated:"2.15",time:"amc",sector:"Technology"},
  {symbol:"META",date:"2026-07-30",fiscalDateEnding:"2026-06-30",epsEstimated:"7.10",time:"amc",sector:"Technology"},
  {symbol:"JPM",date:"2026-07-14",fiscalDateEnding:"2026-06-30",epsEstimated:"4.60",time:"bmo",sector:"Finance"},
  {symbol:"GS",date:"2026-07-15",fiscalDateEnding:"2026-06-30",epsEstimated:"9.80",time:"bmo",sector:"Finance"},
  {symbol:"XOM",date:"2026-08-01",fiscalDateEnding:"2026-06-30",epsEstimated:"1.92",time:"bmo",sector:"Energy"},
  {symbol:"CVX",date:"2026-08-01",fiscalDateEnding:"2026-06-30",epsEstimated:"2.45",time:"bmo",sector:"Energy"},
];

// Hardcoded macro fallback (used when economic calendar API is unavailable)
const DEMO_MACRO = [
  { date:"2026-07-02", summary:"💼 Jobs Report — June NFP",           desc:"Bureau of Labor Statistics: June nonfarm payrolls." },
  { date:"2026-07-10", summary:"📊 CPI — June Inflation",             desc:"BLS Consumer Price Index for June 2026." },
  { date:"2026-07-29", summary:"🏛️ FOMC Decision & Press Conference",  desc:"Fed interest rate decision." },
  { date:"2026-07-31", summary:"📉 PCE Inflation — June",             desc:"BEA PCE price index for June 2026." },
  { date:"2026-08-07", summary:"💼 Jobs Report — July NFP",           desc:"Bureau of Labor Statistics: July nonfarm payrolls." },
  { date:"2026-08-12", summary:"📊 CPI — July Inflation",             desc:"BLS Consumer Price Index for July 2026." },
  { date:"2026-08-27", summary:"🏔️ Jackson Hole Symposium",            desc:"Kansas City Fed Annual Economic Policy Symposium." },
  { date:"2026-08-29", summary:"📉 PCE Inflation — July",             desc:"BEA PCE price index for July 2026." },
  { date:"2026-09-05", summary:"💼 Jobs Report — August NFP",         desc:"Bureau of Labor Statistics: August nonfarm payrolls." },
  { date:"2026-09-11", summary:"📊 CPI — August Inflation",           desc:"BLS Consumer Price Index for August 2026." },
  { date:"2026-09-17", summary:"🏛️ FOMC Decision & Press Conference",  desc:"Fed interest rate decision." },
];

// ── ICS event builders ───────────────────────────────────────────
function earningsVevent(e, ts) {
  const icon = e.time==="bmo"?"🌙":e.time==="amc"?"⭐":"📊";
  return [
    "BEGIN:VEVENT",
    `UID:${e.symbol}-${e.date}@earningscal`,
    `DTSTAMP:${ts}`,
    `DTSTART;VALUE=DATE:${ymd(e.date)}`,
    `DTEND;VALUE=DATE:${addDay(e.date)}`,
    `SUMMARY:${esc(icon+" "+e.symbol+" Earnings")}`,
    `DESCRIPTION:${esc(e.symbol+" earnings ending "+e.fiscalDateEnding+". EPS Est: "+e.epsEstimated)}`,
    `CATEGORIES:${e.sector}`,
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
  ].join("\r\n");
}

function macroVevent({ date, summary, desc }, ts) {
  return [
    "BEGIN:VEVENT",
    `UID:macro-${date}-${summary.replace(/[^a-zA-Z0-9]/g,"").slice(0,16)}@earningscal`,
    `DTSTAMP:${ts}`,
    `DTSTART;VALUE=DATE:${ymd(date)}`,
    `DTEND;VALUE=DATE:${addDay(date)}`,
    `SUMMARY:${esc(summary)}`,
    `DESCRIPTION:${esc(desc)}`,
    "CATEGORIES:Macro",
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
  ].join("\r\n");
}

function ics(events) {
  return [
    "BEGIN:VCALENDAR",
    "PRODID:-//Earnings & Fed Calendar//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Earnings & Fed Calendar",
    "X-WR-CALDESC:Tech / Energy / Finance earnings + key Fed & macro dates",
    "REFRESH-INTERVAL;VALUE=DURATION:P1D",
    "X-PUBLISHED-TTL:P1D",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n")+"\r\n";
}

// ── Handler ──────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader("Content-Type","text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition",'attachment; filename="earnings-calendar.ics"');
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Cache-Control","public, max-age=3600, s-maxage=3600");

  const apiKey = process.env.FMP_API_KEY;
  const ts = stamp();

  if (!apiKey) {
    const demoMacro = DEMO_MACRO.map(e => macroVevent(e, ts));
    return res.status(200).send(ics([...DEMO_EARNINGS.map(e=>earningsVevent(e,ts)), ...demoMacro]));
  }

  const today = new Date();
  const from  = today.toISOString().slice(0,10);
  const to    = new Date(today.getTime()+90*86400000).toISOString().slice(0,10);

  // Fetch earnings and economic calendar in parallel
  const [earningsResult, macroResult] = await Promise.allSettled([
    fetchEarnings(apiKey, from, to),
    fetchMacro(apiKey, from, to),
  ]);

  const earningsEvents = earningsResult.status==="fulfilled"
    ? earningsResult.value.map(e => earningsVevent(e, ts))
    : DEMO_EARNINGS.map(e => earningsVevent(e, ts));

  const macroEvents = macroResult.status==="fulfilled" && macroResult.value.length > 0
    ? macroResult.value.map(e => macroVevent(e, ts))
    : DEMO_MACRO.map(e => macroVevent(e, ts));   // fallback to hardcoded

  return res.status(200).send(ics([...earningsEvents, ...macroEvents]));
};

// ── Earnings fetch ───────────────────────────────────────────────
async function fetchEarnings(apiKey, from, to) {
  const stableUrl = `https://financialmodelingprep.com/stable/earnings-calendar?from=${from}&to=${to}&apikey=${apiKey}`;
  const v3Url     = `https://financialmodelingprep.com/api/v3/earning_calendar?from=${from}&to=${to}&apikey=${apiKey}`;

  let r = await fetch(stableUrl);
  let data = await r.json();

  if (!Array.isArray(data)) {
    console.error("Earnings stable endpoint failed:", JSON.stringify(data).slice(0,150));
    r = await fetch(v3Url);
    data = await r.json();
  }

  if (!Array.isArray(data)) throw new Error("Bad earnings response: "+JSON.stringify(data).slice(0,100));

  const events = [];
  for (const row of data) {
    const symbol = (row.symbol||"").toUpperCase();
    const sector = SECTOR_MAP[symbol];
    if (!sector) continue;
    if (!row.date||!/^\d{4}-\d{2}-\d{2}/.test(row.date)) continue;
    events.push({
      symbol, sector,
      date: row.date.slice(0,10),
      fiscalDateEnding: row.fiscalDateEnding||"N/A",
      epsEstimated: row.epsEstimated!=null ? String(row.epsEstimated) : "N/A",
      time: row.time||"",
    });
  }
  return events;
}

// ── Economic calendar fetch ──────────────────────────────────────
async function fetchMacro(apiKey, from, to) {
  // Try stable endpoint, then v3
  const stableUrl = `https://financialmodelingprep.com/stable/economic-calendar?from=${from}&to=${to}&apikey=${apiKey}`;
  const v3Url     = `https://financialmodelingprep.com/api/v3/economic_calendar?from=${from}&to=${to}&apikey=${apiKey}`;

  let r = await fetch(stableUrl);
  let data = await r.json();

  if (!Array.isArray(data)) {
    console.error("Economic calendar stable endpoint failed:", JSON.stringify(data).slice(0,150));
    r = await fetch(v3Url);
    data = await r.json();
  }

  if (!Array.isArray(data)) throw new Error("Bad economic calendar response: "+JSON.stringify(data).slice(0,100));

  const seen = new Set();
  const events = [];

  for (const row of data) {
    // Only US high-impact events
    if ((row.country||"").toUpperCase() !== "US") continue;
    if ((row.impact||"").toLowerCase() !== "high") continue;

    const macro = matchMacro(row.event);
    if (!macro) continue;

    const date = (row.date||"").slice(0,10);
    if (!date||!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    // Deduplicate same event on same date
    const key = `${date}:${macro.label}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Build description from available fields
    const parts = [row.event];
    if (row.estimate!=null) parts.push(`Estimate: ${row.estimate}`);
    if (row.previous!=null) parts.push(`Previous: ${row.previous}`);

    events.push({
      date,
      summary: `${macro.icon} ${macro.label}`,
      desc: parts.join(" | "),
    });
  }

  // Sort chronologically
  events.sort((a,b) => a.date.localeCompare(b.date));
  return events;
}
