#!/usr/bin/env python3
"""Static backtest stats for the 10 bottom signals -> data/indicator_stats.json.

Run once by hand (NOT by the update workflow):
    python3 scripts/indicator_stats.py [path/to/backtest/out]
Default input dir: ../backtest/out (daily_score_series.csv + episodes.csv from the offline backtest).

Definitions
- Big drops: episodes in episodes.csv with max drawdown of the Nasdaq-100 of 15% or more (11 since 2000).
- "Caught": the signal was at a FULL point (1.0) at least once between the episode peak and its recovery end.
  Episodes where the signal has no history are not counted (denominator = episodes with data).
- Lead: calendar days from the first full-point day in the episode to the trough; median across caught episodes.
- 1y forward: QQQ total-return (adjusted close) 252 trading days after each full-on day.
- Baseline: the same 1y forward stats over every day with a forward value.
- Ranking score (higher = more reliable):
      (pct_pos - base_pos)[pp] + (median_1y - base_median)[pp]
      - max(0, lead_days - 30) / 10          (fires too early)
      - 0.2 * pct_of_days_full_on            (fires too often)
      + 10 * (catch_rate - 0.5)              (small bonus for catching most drops)
- Badge: high  = pct_pos >= base+10pp and median >= base
         medium = pct_pos >= base-10pp and median >= base+5pp
         low   = otherwise
"""
import json, math, os, sys
from datetime import datetime, timezone
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..', 'backtest', 'out')
OUT = os.path.join(HERE, '..', 'data', 'indicator_stats.json')
H1Y = 252

# backtest column -> live signal id, Hebrew rule text, data note (Hebrew, empty = full history)
SIGNALS = [
    ('s3_vix', 'vix', 'VIX', ['≥35'], ''),
    ('s6_s5fi', 's5fi', 'S5FI', ['≤5%'], 'היסטוריה משוחזרת ומקורבת (רק מניות המדד של היום) — המספרים אופטימיים'),
    ('s4_vix_ratio', 'vix_ratio', 'VIX/VIX3M', ['≥1.10'], 'נתונים רק מ־2006'),
    ('s5_fear_greed', 'fng', 'פחד וחמדנות CNN', ['≤10'], 'נתונים רק מ־2011 — 6 ירידות בלבד'),
    ('s7_aaii', 'aaii', 'AAII דובים', ['≥55%'], ''),
    ('s8_putcall_sub', 'putcall', 'פוט/קול', ['≥0.90'], 'נבדק דרך מדד תחליף (יחס פוט/קול של CBOE במניות, בשנים 2006 עד 2019) — לא אותו מדד שמוצג כאן'),
    ('s10_macro', 'macro', 'הקלה במאקרו', ['10Y −25bp', 'DXY −2%'], 'נדלק לעתים קרובות מאוד'),
    ('s9_hy_oas', 'hy', 'מרווח אג״ח זבל', ['≥5%'], ''),
    ('s1_ndx_dd', 'ndx_dd', 'ירידת נאסד״ק מהשיא', ['≥20%'], 'בבדיקה: ירידה משיא 52 שבועות'),
    ('s2_ndx_vs200', 'ndx_200', 'נאסד״ק מתחת לממוצע 200', ['≥12%'], ''),
]


def rnd(x):  # round half up (avoid banker's rounding on .5 day medians)
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else int(math.floor(x + 0.5))


def main():
    d = pd.read_csv(os.path.join(SRC, 'daily_score_series.csv'), parse_dates=['Date']).set_index('Date')
    ep = pd.read_csv(os.path.join(SRC, 'episodes.csv'), parse_dates=['peak', 'trough', 'end'])
    big = ep[ep.max_dd <= -0.15]
    q = d.qqq_adj
    fwd = (q.shift(-H1Y) / q - 1)
    base = fwd.dropna()
    base_pos, base_med = float((base > 0).mean()), float(base.median())

    rows = []
    for col, sid, name, thr, note in SIGNALS:
        s = d[col]
        on = s >= 1
        caught = avail = 0; leads = []
        for _, e in big.iterrows():
            w = s.loc[e.peak:e.end]
            if w.notna().sum() == 0:
                continue
            avail += 1
            hit = w[w >= 1]
            if len(hit):
                caught += 1; leads.append((e.trough - hit.index[0]).days)
        f = fwd[on].dropna()
        pos, med = float((f > 0).mean()), float(f.median())
        lead = float(np.median(leads)) if leads else float('nan')
        pct_on = float(on.sum() / s.notna().sum() * 100)
        score = ((pos - base_pos) * 100 + (med - base_med) * 100
                 - max(0.0, lead - 30) / 10 - 0.2 * pct_on + 10 * (caught / avail - 0.5))
        if pos >= base_pos + 0.10 and med >= base_med:
            badge = 'high'
        elif pos >= base_pos - 0.10 and med >= base_med + 0.05:
            badge = 'medium'
        else:
            badge = 'low'
        rows.append(dict(id=sid, backtest_col=col, name=name, full_threshold=thr, data_note=note,
                         history_from=str(s.first_valid_index().date()),
                         caught=caught, episodes=avail, lead_days=rnd(lead),
                         full_on_days=int(on.sum()), pct_days_full_on=round(pct_on, 1),
                         pct_pos_1y=rnd(pos * 100), median_1y=rnd(med * 100),
                         pct_pos_1y_exact=round(pos, 4), median_1y_exact=round(med, 4),
                         score=round(score, 2), badge=badge))
    rows.sort(key=lambda r: -r['score'])
    for i, r in enumerate(rows, 1):
        r['rank'] = i
    out = dict(
        generated_at=datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        source='offline backtest: daily_score_series.csv + episodes.csv (2000-01-03 .. %s)' % d.index[-1].date(),
        big_drops=int(len(big)), big_drop_threshold_pct=15, horizon_days=H1Y,
        baseline=dict(pct_pos_1y=rnd(base_pos * 100), median_1y=rnd(base_med * 100),
                      pct_pos_1y_exact=round(base_pos, 4), median_1y_exact=round(base_med, 4)),
        signals=rows)
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print(f"baseline: {out['baseline']['pct_pos_1y']}% positive, median {out['baseline']['median_1y']:+d}%")
    for r in rows:
        print(f"{r['rank']:>2} {r['id']:<10} {r['caught']}/{r['episodes']:<3} lead {r['lead_days']:>4}d "
              f"pos {r['pct_pos_1y']:>3}% med {r['median_1y']:+d}% on {r['pct_days_full_on']:>5}% "
              f"score {r['score']:>7} {r['badge']}")


if __name__ == '__main__':
    main()
