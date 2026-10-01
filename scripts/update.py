#!/usr/bin/env python3
"""Bottom-signals updater for the GitHub Pages app.

Fetches live public data, scores the 6 bottom signals (0 / 0.5 / 1 each, same rules as
bottom_score.py) plus 2 S&P 500 market-health rows (shown, not counted by default), and writes:
  data/latest.json   - everything the page needs
  data/history.json  - one score per US trading day (last run of the day wins)
Robust by design: every source is fetched in its own try/except. If a source fails, the last
good value is kept with its own timestamp (status "kept"); if there never was one, the signal
is marked "na" (shown as 'אין נתון') and left out of the score. Nothing is ever guessed.
Score = points earned / points available (signals with data) x 10, i.e. normalized to 0-10.
The 4 low-reliability signals (NDX drawdown, NDX vs 200d, HY OAS, macro relief) were removed on 1.10.2026.
Standard library only (no pip install needed).
"""
import datetime, email.utils, html, json, os, re, sys, time, traceback, urllib.request
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
UTC, NY = datetime.timezone.utc, ZoneInfo('America/New_York')
YIELD_LINES = {'10y': 5.25, '30y': 5.5}  # FIXED by Marina - never change these warning lines
TIERS = [(3, 'אין פחד עדיין'), (5, 'פחד מצטבר — להתכונן'), (7, 'פחד אמיתי — אזור קנייה'), (999, 'כניעה')]
BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
H_CNN = {'User-Agent': BROWSER, 'Referer': 'https://www.cnn.com/', 'Accept': 'application/json, text/plain, */*'}
H_WEB = {'User-Agent': BROWSER, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'}
LOG = []

def log(*a):
    msg = ' '.join(str(x) for x in a); LOG.append(msg); print(msg, file=sys.stderr)

def now_utc(): return datetime.datetime.now(UTC).replace(microsecond=0)
def iso(dt): return dt.astimezone(UTC).replace(microsecond=0).isoformat().replace('+00:00', 'Z')
def iso_ts(ts): return iso(datetime.datetime.fromtimestamp(ts, UTC))
def iso_date_ny(d, hh=16):  # a market date -> its US close as an ISO instant
    return iso(datetime.datetime(d.year, d.month, d.day, hh, 0, tzinfo=NY))

def get(url, headers=None, tries=3, timeout=25):
    err = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=headers or H_WEB)
            return urllib.request.urlopen(req, timeout=timeout).read().decode('utf-8', 'ignore')
        except Exception as e:
            err = e; time.sleep(1.5 * (i + 1))
    raise err

# ------------------------------------------------------------------ Yahoo
_YCACHE = {}
def yahoo(sym, rng='2y', tries=2):
    key = (sym, rng)
    if key in _YCACHE: return _YCACHE[key]
    err = None
    for host in ('query1', 'query2'):
        try:
            raw = get(f'https://{host}.finance.yahoo.com/v8/finance/chart/{sym}?range={rng}&interval=1d',
                      {'User-Agent': BROWSER, 'Accept': 'application/json'}, tries=tries)
            d = json.loads(raw)['chart']['result'][0]
            rows = [(t, c) for t, c in zip(d['timestamp'], d['indicators']['quote'][0]['close']) if c is not None]
            if len(rows) < 2: raise ValueError(f'{sym}: too few rows')
            m = d.get('meta', {})
            out = {'c': [c for _, c in rows], 'dates': [datetime.datetime.fromtimestamp(t, NY).date() for t, _ in rows],
                   'time': m.get('regularMarketTime') or rows[-1][0]}
            _YCACHE[key] = out
            return out
        except Exception as e:
            err = e
    raise err

def sma(c, n): return sum(c[-n:]) / n

# ------------------------------------------------------------------ helpers
def pts(v, half, full, lower_is_fear=True):
    if v is None: return 0
    if lower_is_fear: return 1 if v <= full else 0.5 if v <= half else 0
    return 1 if v >= full else 0.5 if v >= half else 0

def frac(base, full, x):
    if full == base: return 1.0 if x >= full else 0.0
    return max(0.0, min(1.0, (x - base) / (full - base)))

def bars(s):
    """Same bar logic as bottom_dashboard.enrich(): fill from the right toward the full-point end."""
    if s.get('value') is None:
        s['bar_p'], s['bar_h'], s['color'] = 0, s.get('half_mark', frac(s['base'], s['full'], s['half'])), 'gray'; return s
    p = s['progress'] if s.get('progress') is not None else frac(s['base'], s['full'], s['value'])
    h = s['half_mark'] if s.get('half_mark') is not None else frac(s['base'], s['full'], s['half'])
    if s['points'] >= 1: p = max(p, 1.0)
    elif s['points'] >= 0.5: p = max(p, h)
    s['bar_p'], s['bar_h'] = round(max(0, min(1, p)), 4), round(h, 4)
    s['color'] = 'green' if s['points'] >= 0.5 else ('yellow' if p >= 0.5 else 'gray')
    return s

def signed(x, nd=1, suffix='%'):
    s = f'{x:+.{nd}f}{suffix}'
    return s.replace('-', '−')

# ------------------------------------------------------------------ signal definitions
# value is always in "fear units" with direction up (higher = more fear) or down (lower = more fear),
# exactly like the values JSON consumed by bottom_dashboard.py.
DEFS = [
    dict(id='vix', label='VIX', half=28, full=35, base=12, direction='up',
         half_display='28', full_display='35', source='Yahoo ^VIX', kind='live'),
    dict(id='vix_ratio', label='VIX/VIX3M', half=1.0, full=1.10, base=0.80, direction='up',
         half_display='1.00', full_display='1.10', source='Yahoo ^VIX, ^VIX3M', kind='live'),
    dict(id='fng', label='פחד וחמדנות CNN', half=25, full=10, base=50, direction='down',
         half_display='≤25', full_display='≤10', source='CNN Fear & Greed', kind='live'),
    dict(id='s5fi', label='S5FI', half=15, full=5, base=50, direction='down',
         half_display='≤15%', full_display='≤5%', source='ChartRow / חישוב עצמי', kind='live'),
    dict(id='aaii', label='AAII דובים', half=45, full=55, base=30, direction='up',
         half_display='45%', full_display='55%', source='AAII (שבועי)', kind='live'),
    dict(id='putcall', label='פוט/קול (CNN)', half=25, full=10, base=50, direction='down',
         half_display='≤25', full_display='≤10', source='CNN Fear & Greed', kind='live'),
]
SPX_DEFS = [
    dict(id='spx_dd', label='ירידת S&P 500 מהשיא', half=10, full=20, base=0, direction='up',
         half_display='10%', full_display='20%', source='Yahoo ^GSPC', kind='live'),
    dict(id='spx_200', label='S&P 500 מול ממוצע 200', half=5, full=12, base=0, direction='up',
         half_display='−5%', full_display='−12%', source='Yahoo ^GSPC', kind='live'),
]

def f_dd(sym):
    def f():
        y = yahoo(sym, '10y'); c = y['c']
        ath = max(c); i = c.index(ath)
        dd = (1 - c[-1] / ath) * 100
        return dict(value=round(dd, 2), display=f'{dd:.2f}%', points=pts(-dd, -10, -20),
                    note=f'שיא {ath:,.0f} ({y["dates"][i].strftime("%-d.%-m.%Y")})', as_of=iso_ts(y['time']))
    return f

def f_200(sym):
    def f():
        y = yahoo(sym, '10y'); c = y['c']
        v = (c[-1] / sma(c, 200) - 1) * 100
        return dict(value=round(-v, 2), display=signed(v), points=pts(v, -5, -12),
                    note=f'ממוצע 200 יום: {sma(c, 200):,.0f}', as_of=iso_ts(y['time']))
    return f

def f_vix():
    y = yahoo('%5EVIX', '1mo'); v = y['c'][-1]
    return dict(value=round(v, 2), display=f'{v:.1f}', points=pts(v, 28, 35, False), as_of=iso_ts(y['time']))

def f_vix_ratio():
    a, b = yahoo('%5EVIX', '1mo'), yahoo('%5EVIX3M', '1mo')
    r = a['c'][-1] / b['c'][-1]
    return dict(value=round(r, 3), display=f'{r:.2f}', points=pts(r, 1.0, 1.10, False),
                note=f'VIX3M {b["c"][-1]:.1f}', as_of=iso_ts(min(a['time'], b['time'])))

_CNN = {}
def cnn():
    if 'd' not in _CNN:
        _CNN['d'] = json.loads(get('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', H_CNN))
    return _CNN['d']

def cnn_time(node, fallback):
    t = node.get('timestamp')
    try:
        if isinstance(t, (int, float)): return iso_ts(t / 1000 if t > 1e11 else t)
        return iso(datetime.datetime.fromisoformat(str(t).replace('Z', '+00:00')))
    except Exception:
        return fallback

def f_fng():
    d = cnn()['fear_and_greed']; v = float(d['score'])
    return dict(value=round(v, 1), display=f'{v:.1f}', points=pts(v, 25, 10), as_of=cnn_time(d, iso(now_utc())))

def f_putcall():
    d = cnn()['put_call_options']; v = float(d['score'])
    return dict(value=round(v, 1), display=f'{v:.0f}', points=pts(v, 25, 10), as_of=cnn_time(d, cnn_time(cnn()['fear_and_greed'], iso(now_utc()))))

def f_s5fi():
    """1) ChartRow public breadth page (% of S&P 500 members above 50-day MA, EOD).
       2) fallback: compute it ourselves from Yahoo closes of the Wikipedia constituents list."""
    try:
        page = get('https://chartrow.com/sp500/market-breadth', H_WEB, tries=2)
        t = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', re.sub(r'(?s)<script.*?</script>|<style.*?</style>', ' ', page))))
        m = re.search(r'Above 50-day MA\s*([\d.]+)%\s*(\d+) of (\d+) eligible', t)
        dm = re.search(r'as of market close,? (\w+ \d{1,2}, \d{4})', t)
        if not m or not dm: raise ValueError('ChartRow: pattern not found')
        d = datetime.datetime.strptime(dm.group(1), '%b %d, %Y').date()
        if (datetime.datetime.now(NY).date() - d).days > 5: raise ValueError(f'ChartRow: stale ({d})')
        v = int(m.group(2)) / int(m.group(3)) * 100
        return dict(value=round(v, 1), display=f'{v:.0f}%', points=pts(v, 15, 5), as_of=iso_date_ny(d),
                    source='ChartRow — אחוז מניות S&P 500 מעל ממוצע 50 יום', kind='live', date_only=True,
                    note=f'{m.group(2)} מתוך {m.group(3)} מניות')
    except Exception as e:
        log('S5FI ChartRow failed -> computing:', repr(e))
    page = get('https://en.wikipedia.org/wiki/List_of_S%26P_500_companies', {'User-Agent': 'bottom-signals-app/1.0 (GitHub Actions)'})
    table = page.split('id="constituents"', 1)[1].split('</table>', 1)[0]
    syms = sorted({re.sub(r'<[^>]+>', '', r).strip().replace('.', '-') for r in re.findall(r'<tr[^>]*>\s*<td[^>]*>(.*?)</td>', table, re.S)})
    syms = [s for s in syms if re.fullmatch(r'[A-Z0-9-]{1,6}', s)]
    if len(syms) < 480: raise ValueError(f'constituents list too short: {len(syms)}')
    def one(s):
        try:
            y = yahoo(s, '6mo', tries=2); c = y['c']
            return (c[-1] > sma(c, 50), y['dates'][-1]) if len(c) >= 50 else None
        except Exception:
            return None
    with ThreadPoolExecutor(12) as ex: res = [r for r in ex.map(one, syms) if r]
    if len(res) < 450: raise ValueError(f'only {len(res)} constituents priced')
    last = max(d for _, d in res); above = sum(1 for a, _ in res if a)
    v = above / len(res) * 100
    return dict(value=round(v, 1), display=f'{v:.0f}%', points=pts(v, 15, 5), as_of=iso_date_ny(last) if last < datetime.datetime.now(NY).date() else iso(now_utc()),
                source='אחוז מניות S&P 500 מעל ממוצע 50 יום — חישוב עצמי מ־Yahoo ורשימת ויקיפדיה', kind='computed', date_only=False,
                note=f'מחושב · {above} מתוך {len(res)} מניות')

def f_aaii():
    feed = get('https://insights.aaii.com/feed', H_WEB)
    for it in re.findall(r'<item>(.*?)</item>', feed, re.S):
        if 'Sentiment Survey' not in it: continue
        body = html.unescape(re.sub(r'<[^>]+>', ' ', html.unescape(it)))
        bull = float(re.search(r'Bullish:\s*([\d.]+)%', body).group(1))
        bears = float(re.search(r'Bearish:\s*([\d.]+)%', body).group(1))
        spread = bull - bears
        pd = re.search(r'<pubDate>(.*?)</pubDate>', it)
        as_of = iso(email.utils.parsedate_to_datetime(pd.group(1).strip())) if pd else iso(now_utc())
        return dict(value=bears, display=f'{bears:.1f}%', points=max(pts(bears, 45, 55, False), pts(spread, -15, -30)),
                    note=f'שוורים {bull:.1f}% · פער {signed(spread, 1)}', as_of=as_of)
    raise ValueError('AAII: no Sentiment Survey item in feed')

FUNCS = {'vix': f_vix, 'vix_ratio': f_vix_ratio, 'fng': f_fng, 's5fi': f_s5fi, 'aaii': f_aaii, 'putcall': f_putcall,
         'spx_dd': f_dd('%5EGSPC'), 'spx_200': f_200('%5EGSPC')}

def run_signal(d, prev, fetched_at):
    s = dict(d)
    try:
        r = FUNCS[d['id']]()
        s.update(r); s['status'] = 'live'; s['fetched_at'] = fetched_at
        if s['kind'] == 'computed': s['status'] = 'computed'
    except Exception as e:
        log(f'[{d["id"]}] FAILED:', repr(e)); traceback.print_exc(file=sys.stderr)
        p = prev.get(d['id'])
        if p and p.get('value') is not None and p.get('status') != 'na':
            keep = {k: p[k] for k in ('value', 'display', 'points', 'progress', 'note', 'as_of', 'fetched_at', 'source', 'kind', 'date_only') if k in p}
            s.update(keep); s['status'] = 'kept'
        else:
            s.update(value=None, display='אין נתון', points=0, as_of=None, fetched_at=None, status='na')
        s['error'] = str(e)[:200]
    return bars(s)

# ------------------------------------------------------------------ info rows / yields
def run_quote(key, sym, label, fmt, prev, fetched_at, rng='1mo'):
    try:
        y = yahoo(sym, rng); c = y['c']
        return dict(id=key, label=label, value=round(c[-1], 3), display=fmt(c[-1]),
                    change=round((c[-1] / c[-2] - 1) * 100, 2), as_of=iso_ts(y['time']), fetched_at=fetched_at, status='live')
    except Exception as e:
        log(f'[{key}] FAILED:', repr(e))
        p = prev.get(key)
        if p and p.get('value') is not None and p.get('status') != 'na':
            return dict(p, status='kept', error=str(e)[:200])
        return dict(id=key, label=label, value=None, display='אין נתון', status='na', error=str(e)[:200])

def load_json(path, default):
    try:
        with open(path, encoding='utf-8') as f: return json.load(f)
    except Exception:
        return default

def main():
    os.makedirs(DATA, exist_ok=True)
    cfg = load_json(os.path.join(ROOT, 'config.json'), {})
    count_spx = bool(cfg.get('count_spx_in_score', False))
    old = load_json(os.path.join(DATA, 'latest.json'), {})
    prev = {s['id']: s for s in old.get('signals', []) + old.get('spx_signals', []) + old.get('yields', []) + old.get('info', [])}
    started = now_utc(); fetched_at = iso(started)

    signals = [run_signal(d, prev, fetched_at) for d in DEFS]
    spx = [run_signal(d, prev, fetched_at) for d in SPX_DEFS]
    yields = [dict(run_quote('y10', '%5ETNX', 'תשואת 10 שנים', lambda v: f'{v:.2f}%', prev, fetched_at), line=YIELD_LINES['10y']),
              dict(run_quote('y30', '%5ETYX', 'תשואת 30 שנים', lambda v: f'{v:.2f}%', prev, fetched_at), line=YIELD_LINES['30y'])]
    for y in yields:
        y['line'] = YIELD_LINES['10y'] if y['id'] == 'y10' else YIELD_LINES['30y']  # never taken from old data
        y['warn'] = y.get('value') is not None and y['value'] >= y['line']
    info = [run_quote('brent', 'BZ%3DF', 'נפט ברנט', lambda v: f'${v:.2f}', prev, fetched_at),
            run_quote('dxy', 'DX-Y.NYB', 'דולר DXY', lambda v: f'{v:.2f}', prev, fetched_at),
            run_quote('ndx', '%5ENDX', 'נאסד״ק 100', lambda v: f'{v:,.0f}', prev, fetched_at),
            run_quote('qqq', 'QQQ', 'QQQ', lambda v: f'${v:.2f}', prev, fetched_at)]

    avail = [s for s in signals if s['status'] != 'na']; spx_avail = [s for s in spx if s['status'] != 'na']
    core = sum(s['points'] for s in avail); spx_pts = sum(s['points'] for s in spx_avail)
    norm = lambda p, n: round(p / n * 10, 2) if n else 0.0
    core_norm = norm(core, len(avail)); with_spx = norm(core + spx_pts, len(avail) + len(spx_avail))
    total = with_spx if count_spx else core_norm
    tier_i = next(i for i, (lim, _) in enumerate(TIERS) if total < lim)
    ndx_q = next(q for q in info if q['id'] == 'ndx')
    market_time = ndx_q.get('as_of') if ndx_q.get('status') != 'na' else None
    out = {
        'generated_at': fetched_at,
        'market_time': market_time,
        'score': total, 'score_max': 10, 'score_method': 'points earned / points available x 10',
        'score_core': core_norm, 'score_with_spx': with_spx, 'count_spx_in_score': count_spx,
        'points': core, 'points_available': len(avail), 'signals_count': len(signals), 'score_spx': spx_pts,
        'tier_index': tier_i, 'tier': TIERS[tier_i][1],
        'missing': [s['id'] for s in signals + spx if s['status'] == 'na'],
        'kept': [s['id'] for s in signals + spx if s['status'] == 'kept'],
        'signals': signals, 'spx_signals': spx, 'yields': yields, 'info': info,
        'full_buy_threshold': cfg.get('full_buy_threshold'),
        'full_buy_threshold_note': cfg.get('full_buy_threshold_note'),
        'log': LOG[-30:],
    }
    with open(os.path.join(DATA, 'latest.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    hist_path = os.path.join(DATA, 'history.json')
    hist = load_json(hist_path, [])
    day = (datetime.datetime.fromisoformat(market_time.replace('Z', '+00:00')).astimezone(NY).date()
           if market_time else datetime.datetime.now(NY).date()).isoformat()
    entry = {'d': day, 'score': total, 'core': core_norm, 'with_spx': with_spx, 'pts': core, 'avail': len(avail),
             'spx': spx_pts, 'tier': tier_i, 'missing': len(out['missing']), 't': fetched_at, 'v': 6}
    hist = [h for h in hist if h.get('d') != day] + [entry]
    hist.sort(key=lambda h: h['d'])
    with open(hist_path, 'w', encoding='utf-8') as f:
        json.dump(hist[-3000:], f, ensure_ascii=False, indent=0)

    print(f'score {total:g}/10 ({TIERS[tier_i][1]}) | points {core:g}/{len(avail)} available of {len(signals)} | S&P rows {spx_pts:g} | '
          f'missing {out["missing"]} | kept {out["kept"]}')
    for s in signals + spx:
        print(f'  {s["points"]:>3}  {s["id"]:<10} {s["display"]:<10} {s["status"]}')
    for y in yields + info:
        print(f'       {y["id"]:<10} {y.get("display")} {y.get("status")}')

if __name__ == '__main__':
    main()
