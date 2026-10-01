# מד סימני תחתית — bottom-signals

Phone-friendly Hebrew dashboard (static site on GitHub Pages) that scores 6 "market bottom" signals
(0 / 0.5 / 1 point each) plus 2 S&P 500 market-health rows, and refreshes itself via GitHub Actions.

Score = points earned / points available (signals that have data) × 10, shown as X/10.
Signals: VIX (28/35), VIX/VIX3M (1.00/1.10), CNN Fear & Greed (≤25/≤10), S5FI (≤15%/≤5%),
AAII bears (≥45%/≥55%, or bull-bear spread ≤−15/≤−30), CNN put/call sub-score (≤25/≤10).
On 1.10.2026 the 4 low-reliability signals were removed: NDX drawdown from high, NDX below 200d SMA,
HY OAS (junk spread) and macro relief (10Y / dollar). Older history points (10-signal raw score) are not drawn.

- `index.html`, `style.css`, `app.js` — the page (HTML/CSS/SVG, RTL). Reads `data/latest.json`, `data/history.json`, `config.json`.
- `scripts/indicator_stats.py` → `data/indicator_stats.json` — static historical reliability ranking of the 6 signals
  (run by hand from the offline backtest output `../backtest/out`; NOT recomputed by the workflow).
- `scripts/update.py` — standard-library-only fetcher/scorer. Every source has its own try/except; on failure the last
  good value is kept with its own timestamp, otherwise the signal shows "אין נתון" and is left out of the score
  (the score is normalized over the signals that have data). Nothing is guessed.
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
