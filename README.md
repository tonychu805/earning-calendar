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
  ├── fetch FMP /stable/economic-calendar  (next 90 days, US High-impact only)
  └── return merged ICS with REFRESH-INTERVAL:P1D
```

- Deployed as a Vercel Serverless Function (Node.js)
- FMP free tier API key stored as `FMP_API_KEY` environment variable in Vercel
- Falls back to hardcoded demo events if the API key is missing or the request fails
- Calendar clients re-fetch the URL daily per the `REFRESH-INTERVAL` header

---

## Project structure

```
earning-calendar/
├── api/
│   └── calendar.ics.js   # Serverless function — earnings + macro ICS generator
├── public/
│   └── index.html        # Landing page
└── vercel.json           # Route /calendar.ics → /api/calendar.ics
```

---

## Deploy your own

1. Fork this repo
2. Import into [Vercel](https://vercel.com) — it auto-detects the serverless function
3. Add your [FMP API key](https://financialmodelingprep.com/developer/docs) as an environment variable:
   - Key: `FMP_API_KEY`
   - Value: your key
4. Deploy — your personal ICS URL will be `https://<your-project>.vercel.app/calendar.ics`

---

## Data source

Earnings and economic calendar data provided by [Financial Modeling Prep](https://financialmodelingprep.com). Free tier covers the features used here.
