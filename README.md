# Earnings & Fed Calendar

A self-updating ICS calendar feed for stock earnings and key macro events. Subscribe once in Google Calendar, Apple Calendar, or Outlook — it refreshes automatically every 24 hours.

**Live at:** [earning-calendar-chi.vercel.app](https://earning-calendar-chi.vercel.app)

---

## What's included

**Earnings** — 90-day rolling window for 90+ tickers across three sectors:
- **Technology** — Semiconductors (NVDA, AMD, ASML, AVGO…), Cloud (MSFT, GOOGL, META, AMZN…), Hardware (ANET, DELL, VRT…)
- **Energy** — XOM, CVX, COP, SLB, EOG and more
- **Finance** — JPM, GS, BAC, V, MA, BLK and more

**Macro / Fed events** — auto-fetched from the same API:
- FOMC rate decisions
- CPI & PCE inflation releases
- Nonfarm Payrolls (NFP)
- GDP, Retail Sales, Durable Goods, ISM PMIs
- Jackson Hole Symposium

---

## How to subscribe

| Platform | Steps |
|---|---|
| **Google Calendar** | Other calendars → **+** → From URL → paste the `.ics` link → Add |
| **Apple Calendar (Mac)** | File → New Calendar Subscription → paste URL → Subscribe |
| **iPhone / iPad** | Settings → Calendar → Accounts → Other → Add Subscribed Calendar |
| **Outlook** | Add calendar → Subscribe from web → paste URL |

ICS URL: `https://earning-calendar-chi.vercel.app/calendar.ics`

---

## How it works

```
GET /calendar.ics
  ├── fetch FMP /stable/earnings-calendar  (next 90 days)
  └── return merged ICS with REFRESH-INTERVAL:P1D

GET /macro.json
  ├── fetch FRED API — CPI, NFP, PCE, GDP, PPI, Retail Sales release dates
  ├── hardcoded    — FOMC meetings + Jackson Hole (Fed publishes annually)
  ├── call Gemini  — time-sensitive 1-sentence descriptions per event
  └── return enriched JSON sorted by date
```

- Deployed as Vercel Serverless Functions (Node.js)
- API keys stored as environment variables in Vercel (never in code)
- Calendar clients re-fetch the ICS daily per the `REFRESH-INTERVAL` header

---

## Project structure

```
earning-calendar/
├── api/
│   ├── calendar.ics.js   # ICS feed — earnings
│   └── macro.json.js     # Macro events — FRED + FOMC + Gemini descriptions
├── public/
│   └── index.html        # Landing page
└── vercel.json           # Routes + function config
```

---

## Deploy your own

1. Fork this repo
2. Import into [Vercel](https://vercel.com)
3. Add environment variables:
   | Key | Source |
   |---|---|
   | `FMP_API_KEY` | [financialmodelingprep.com](https://financialmodelingprep.com/developer/docs) |
   | `FRED_API_KEY` | [fred.stlouisfed.org/docs/api/api_key.html](https://fred.stlouisfed.org/docs/api/api_key.html) (free) |
   | `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) (free tier) |
4. Deploy — your ICS URL: `https://<your-project>.vercel.app/calendar.ics`

---

## Data sources

- **Earnings** — [Financial Modeling Prep](https://financialmodelingprep.com) (free tier)
- **Economic release dates** — [FRED API](https://fred.stlouisfed.org/docs/api/fred/) (free, Federal Reserve Bank of St. Louis)
- **FOMC / Jackson Hole** — hardcoded annually from [federalreserve.gov](https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm)
- **Event descriptions** — Google Gemini (`gemini-2.5-flash`)
