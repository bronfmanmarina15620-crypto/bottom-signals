# מד סימני תחתית — bottom-signals

Phone-friendly Hebrew dashboard (static site on GitHub Pages) that scores 5 live "market bottom" signals
(0 / 0.5 / 1 point each) plus 2 S&P 500 market-health rows, and refreshes itself via GitHub Actions.

Score = points earned / points available (signals that have data) × 10, shown as X/10.
Signals: VIX (28/35), VIX/VIX3M (1.00/1.10), CNN Fear & Greed (≤25/≤10), S5FI (≤15%/≤5%),
CNN put/call sub-score (≤25/≤10).
On 20.11.2026 AAII bears (weekly survey) was removed from the score — the score uses only live market data.
AAII is still shown as an info-only row (`info_signals` in latest.json). history.json entries were recomputed
without AAII from the per-run latest.json snapshots in git (v=7, `recomputed: no-aaii`). S5FI is self-computed
from Yahoo intraday daily bars every Action run (~30 min); ChartRow (EOD) is only a fallback.
On 1.10.2026 the 4 low-reliability signals were removed: NDX drawdown from high, NDX below 200d SMA,
HY OAS (junk spread) and macro relief (10Y / dollar). Older history points (10-signal raw score) are not drawn.

- `index.html`, `style.css`, `app.js` — the page (HTML/CSS/SVG, RTL). Reads `data/latest.json`, `data/history.json`, `config.json`.
- `scripts/indicator_stats.py` → `data/indicator_stats.json` — static historical reliability ranking of the 6 signals
  (run by hand from the offline backtest output `../backtest/out`; NOT recomputed by the workflow).
- `scripts/update.py` — standard-library-only fetcher/scorer. Every source has its own try/except; on failure the last
  good value is kept with its own timestamp, otherwise the signal shows "אין נתון" and is left out of the score
  (the score is normalized over the signals that have data). Nothing is guessed.
- `data/quarterly.json` — quarterly "index momentum heatmap" (NDX, SPX, INDU, RSP, IWM: YTD, Q1–Q4, last month of the
  quarter; % close-to-close from Yahoo). Static: `scripts/update.py` recomputes it after each completed month (current quarter shown to date)
  (`as_of` ≠ last completed quarter), otherwise leaves it untouched. Manual: `python scripts/update.py --quarterly-only [--force]`.
- `.github/workflows/update-data.yml` — cron: every 30 min 13:30–20:30 UTC Mon–Fri, 05:00 UTC and 21:20 UTC; also manual.

## Settings — `config.json`

```json
{
  "full_buy_threshold": 6,
  "full_buy_threshold_note": "…",
  "count_spx_in_score": false
}
```

- `full_buy_threshold` — score at which the full QQQ buy is triggered. `null` = not decided
  (footer: "סף הקנייה המלאה ב־QQQ — טרם נקבע"). Set a number (e.g. `6.5`) to draw a green marker on the gauge
  and highlight the footer when the score reaches it.
- `full_buy_threshold_note` — optional short Hebrew text shown under the buy-threshold line (`null` / absent = nothing).
- `count_spx_in_score` — `false`: the S&P 500 rows are shown but not counted. `true`: they are added to the
  normalized score (8 signals, still 0–10).

Edit the file on GitHub (pencil icon → Commit). The page picks it up on the next load; the workflow also re-runs.

Yield warning lines are fixed in `scripts/update.py` (`YIELD_LINES`: 10Y 5.25%, 30Y 5.5%) — do not change.

Not investment advice.

## Graded scoring (20.11.2026)
Each of the 5 counted signals scores clamp((value-base)/(full-base),0,1); half/full thresholds unchanged (half = reference mark,
`step` field keeps the 0/0.5/1 crossing state for pills/colors). S5FI half threshold moved 15% -> 20%. Score = sum/available x10, one
decimal. history.json was recomputed with graded points from each day's latest.json snapshot in git (v=8, `recomputed: graded-no-aaii`, per-signal `g`).

## Live quarterly table + same-day history (20.11.2026)
quarterly.json: completed quarters fixed; ytd, current quarter and current month = stored base close -> live price (CNBC, Yahoo fallback),
recomputed every Action run and on every refresh in the app. history.json: one point per NY trading day from runs at/after 09:30 NY
(pre-market runs no longer overwrite the previous day); past days recomputed from the last same-day snapshot in git.
