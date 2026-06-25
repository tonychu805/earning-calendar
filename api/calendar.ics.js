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

// FRED release IDs for macro events (mirrors macro.json.js)
const FRED_RELEASES = [
  { id: 10, icon:"📊", label:"CPI"              },
  { id: 50, icon:"💼", label:"Nonfarm Payrolls" },
  { id: 54, icon:"📉", label:"PCE Inflation"    },
  { id: 53, icon:"📈", label:"GDP"              },
  { id: 46, icon:"📊", label:"PPI"              },
  { id: 9,  icon:"🛒", label:"Retail Sales"     },
];

async function fetchFredMacro(fredKey, from, to) {
  const results = await Promise.allSettled(
    FRED_RELEASES.map(async r => {
      const url = `https://api.stlouisfed.org/fred/release/dates`
        + `?release_id=${r.id}&sort_order=desc&limit=12`
        + `&include_release_dates_with_no_data=true`
        + `&api_key=${fredKey}&file_type=json`;
      const res  = await fetch(url);
      const data = await res.json();
      return (data.release_dates || [])
        .map(d => d.date || d.release_date)
        .filter(d => d >= from && d <= to)
        .map(date => ({ date, summary:`${r.icon} ${r.label}`, desc:`${r.label} economic data release.` }));
    })
  );

  return results
    .flatMap(r => r.status === "fulfilled" ? r.value : [])
    .sort((a, b) => a.date.localeCompare(b.date));
}

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

  const fmpKey  = process.env.FMP_API_KEY;
  const fredKey = process.env.FRED_API_KEY;
  const ts = stamp();

  const today = new Date();
  const from  = today.toISOString().slice(0,10);
  const to    = new Date(today.getTime()+90*86400000).toISOString().slice(0,10);

  // Fetch earnings (FMP) + macro dates (FRED) in parallel
  const [earningsResult, macroResult] = await Promise.allSettled([
    fmpKey  ? fetchEarnings(fmpKey, from, to)    : Promise.resolve(DEMO_EARNINGS),
    fredKey ? fetchFredMacro(fredKey, from, to)  : Promise.resolve([]),
  ]);

  const earningsEvents = (earningsResult.status==="fulfilled" ? earningsResult.value : DEMO_EARNINGS)
    .map(e => earningsVevent(e, ts));

  const macroEvents = (macroResult.status==="fulfilled" ? macroResult.value : [])
    .map(e => macroVevent(e, ts));

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

