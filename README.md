# מד סימני תחתית — bottom-signals

Phone-friendly Hebrew dashboard (static site on GitHub Pages) that scores 10 "market bottom" signals
(0 / 0.5 / 1 point each, 0–10 total) plus 2 S&P 500 market-health rows, and refreshes itself via GitHub Actions.

- `index.html`, `style.css`, `app.js` — the page (HTML/CSS/SVG, RTL). Reads `data/latest.json`, `data/history.json`, `config.json`.
- `scripts/indicator_stats.py` → `data/indicator_stats.json` — static historical reliability ranking of the 10 signals
  (run by hand from the offline backtest output `../backtest/out`; NOT recomputed by the workflow).
- `scripts/update.py` — standard-library-only fetcher/scorer. Every source has its own try/except; on failure the last
  good value is kept with its own timestamp, otherwise the signal shows "אין נתון" (0 points). Nothing is guessed.
- `.github/workflows/update-data.yml` — cron: every 30 min 13:30–20:30 UTC Mon–Fri, 05:00 UTC and 21:20 UTC; also manual.

## Settings — `config.json`

```json
{
  "full_buy_threshold": 6,
  "count_spx_in_score": false
}
```

- `full_buy_threshold` — score at which the full QQQ buy is triggered. `null` = not decided
  (footer: "סף הקנייה המלאה ב־QQQ — טרם נקבע"). Set a number (e.g. `6.5`) to draw a green marker on the gauge
  and highlight the footer when the score reaches it.
- `count_spx_in_score` — `false`: the S&P 500 rows are shown but not counted. `true`: they are added to the score (max 12).

Edit the file on GitHub (pencil icon → Commit). The page picks it up on the next load; the workflow also re-runs.

Yield warning lines are fixed in `scripts/update.py` (`YIELD_LINES`: 10Y 5.25%, 30Y 5.5%) — do not change.

Not investment advice.
