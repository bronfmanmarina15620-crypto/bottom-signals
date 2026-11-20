#!/usr/bin/env python3
"""Bottom-signals updater for the GitHub Pages app.

Fetches live public data, scores the 5 live bottom signals (0 / 0.5 / 1 each, same rules as
bottom_score.py) plus 2 S&P 500 market-health rows (shown, not counted by default), and writes:
  data/latest.json   - everything the page needs
  data/history.json  - one score per US trading day (last run of the day wins)
Robust by design: every source is fetched in its own try/except. If a source fails, the last
good value is kept with its own timestamp (status "kept"); if there never was one, the signal
is marked "na" (shown as 'אין נתון') and left out of the score. Nothing is ever guessed.
Score = points earned / points available (signals with data) x 10, i.e. normalized to 0-10, one decimal.
GRADED scoring (20.11.2026, approved by Marina): each of the 5 counted signals scores
clamp((value - base) / (full - base), 0, 1) - continuous between the calm end (base) and the full threshold, so every
worsening moves the score. The half threshold is kept as a reference mark and drives the status pill ('step' field).
The 4 low-reliability signals (NDX drawdown, NDX vs 200d, HY OAS, macro relief) were removed on 1.10.2026.
AAII (weekly survey, collected days before publication) was removed from the score on 20.11.2026 at Marina's
request: the score must use only live market data. It is still fetched and shown as an info-only row.
Standard library only (no pip install needed).
"""
import datetime, email.utils, html, json, os, re, sys, time, traceback, urllib.request
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
UTC, NY = datetime.timezone.utc, ZoneInfo('America/New_York')
YIELD_LINES = {'10y': 5.25, '30y': 5.5}  # FIXED by Marina - never change these warning lines
TIERS = [(3, 'אין פחד עדיין'), (5, 'פחד מצטבר — להתכונן'), (7, 'פחד אמיתי — אזור הזדמנות'), (999, 'כניעה')]
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

GRADED = ('vix', 'vix_ratio', 'fng', 'putcall', 's5fi')

def step_pts(s, v):
    """The old 0 / 0.5 / 1 step rule from the definition's half/full thresholds (used for status pills/colors)."""
    if v is None: return 0
    if s['direction'] == 'down': return 1 if v <= s['full'] else 0.5 if v <= s['half'] else 0
    return 1 if v >= s['full'] else 0.5 if v >= s['half'] else 0

def bars(s):
    """Same bar logic as bottom_dashboard.enrich(): fill from the right toward the full-point end."""
    if s.get('value') is None:
        s['bar_p'], s['bar_h'], s['color'] = 0, s.get('half_mark', frac(s['base'], s['full'], s['half'])), 'gray'; return s
    p = s['progress'] if s.get('progress') is not None else frac(s['base'], s['full'], s['value'])
    h = s['half_mark'] if s.get('half_mark') is not None else frac(s['base'], s['full'], s['half'])
    st = s.get('step', s['points'])
    if st >= 1: p = max(p, 1.0)
    elif st >= 0.5: p = max(p, h)
    s['bar_p'], s['bar_h'] = round(max(0, min(1, p)), 4), round(h, 4)
    s['color'] = 'green' if st >= 0.5 else ('yellow' if p >= 0.5 else 'gray')
    return s

def signed(x, nd=1, suffix='%'):
    s = f'{x:+.{nd}f}{suffix}'
    return s.replace('-', '−')

# ------------------------------------------------------------------ signal definitions
# value is always in "fear units" with direction up (higher = more fear) or down (lower = more fear),
# exactly like the values JSON consumed by bottom_dashboard.py.
DEFS = [
    dict(id='vix', label='VIX', half=28, full=35, base=12, direction='up',
         half_display='28', full_display='35', source='CNBC VIX', kind='live'),
    dict(id='vix_ratio', label='VIX/VIX3M', half=1.0, full=1.10, base=0.80, direction='up',
         half_display='1.00', full_display='1.10', source='CNBC VIX, VIX3M', kind='live'),
    dict(id='fng', label='פחד וחמדנות CNN', half=25, full=10, base=50, direction='down',
         half_display='≤25', full_display='≤10', source='CNN Fear & Greed', kind='live'),
    dict(id='s5fi', label='S5FI', half=20, full=5, base=50, direction='down',
         half_display='≤20%', full_display='≤5%', source='ChartRow / חישוב עצמי', kind='live'),
    dict(id='putcall', label='פוט/קול (CNN)', half=25, full=10, base=50, direction='down',
         half_display='≤25', full_display='≤10', source='CNN Fear & Greed', kind='live'),
]
# shown for information only, never counted in the score (not live: weekly survey)
INFO_DEFS = [
    dict(id='aaii', label='AAII דובים (שבועי — לא נספר)', half=45, full=55, base=30, direction='up',
         half_display='45%', full_display='55%', source='AAII (סקר שבועי)', kind='live', counted=False),
]
SPX_DEFS = [
    dict(id='spx_dd', label='ירידת S&P 500 מהשיא', half=10, full=20, base=0, direction='up',
         half_display='10%', full_display='20%', source='Yahoo ^GSPC', kind='live'),
    dict(id='spx_200', label='S&P 500 מול ממוצע 200', half=5, full=12, base=0, direction='up',
         half_display='−5%', full_display='−12%', source='Yahoo ^GSPC', kind='live'),
]

def spx_live(y):
    """Inputs the app needs to recompute the S&P rows from a live price with the same formulas:
    the live price replaces the last bar if it is the same NY date, otherwise it is appended."""
    c, d = y['c'], y['dates']
    i_all = c.index(max(c)); i_ex = c.index(max(c[:-1]))
    return {'last_date': d[-1].isoformat(), 'ath_all': round(c[i_all], 4), 'ath_all_date': d[i_all].isoformat(),
            'ath_ex_last': round(c[i_ex], 4), 'ath_ex_last_date': d[i_ex].isoformat(),
            'sum199_prev': round(sum(c[-200:-1]), 4), 'sum199_last': round(sum(c[-199:]), 4)}

def f_dd(sym):
    def f():
        y = yahoo(sym, '10y'); c = y['c']
        ath = max(c); i = c.index(ath)
        dd = (1 - c[-1] / ath) * 100
        return dict(value=round(dd, 2), display=f'{dd:.2f}%', points=pts(-dd, -10, -20),
                    note=f'שיא {ath:,.0f} ({y["dates"][i].strftime("%-d.%-m.%Y")})', as_of=iso_ts(y['time']), live=spx_live(y))
    return f

def f_200(sym):
    def f():
        y = yahoo(sym, '10y'); c = y['c']
        v = (c[-1] / sma(c, 200) - 1) * 100
        return dict(value=round(-v, 2), display=signed(v), points=pts(v, -5, -12),
                    note=f'ממוצע 200 יום: {sma(c, 200):,.0f}', as_of=iso_ts(y['time']), live=spx_live(y))
    return f

# ------------------------------------------------------------------ CNBC quotes (fresher than Yahoo; same feed the app reads live on refresh)
CNBC_URL = ('https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols={}'
            '&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1')
CNBC_SYM = {'vix': '.VIX', 'vix3m': '.VIX3M', 'spx': '.SPX', 'y10': 'US10Y', 'y30': 'US30Y',
            'brent': '@LCO.1', 'dxy': '.DXY', 'ndx': '.NDX', 'qqq': 'QQQ'}
_CNBC = {}
def _num(x): return float(str(x).replace(',', '').replace('%', '').strip())
def cnbc(key):
    """Regular-session quote: {'last', 'prev', 'time'(epoch)}. Raises if missing/invalid."""
    if not _CNBC:
        raw = json.loads(get(CNBC_URL.format('%7C'.join(CNBC_SYM.values())), {'User-Agent': BROWSER, 'Accept': 'application/json'}, tries=2, timeout=15))
        for q in raw['FormattedQuoteResult']['FormattedQuote']:
            _CNBC[q.get('symbol')] = q
    q = _CNBC.get(CNBC_SYM[key])
    if not q or q.get('code') not in (0, '0') or q.get('last') in (None, ''): raise ValueError(f'CNBC {key}: no quote')
    last, chg = _num(q['last']), _num(q.get('change') or 0)
    t = str(q.get('last_time') or '')
    if len(t) == 10:  # date only (market closed) -> that session's close
        d = datetime.date.fromisoformat(t); ts = datetime.datetime(d.year, d.month, d.day, 16, 15 if key.startswith('vix') else 0, tzinfo=NY).timestamp()
    else:
        ts = datetime.datetime.strptime(t[:19] + t[-5:], '%Y-%m-%dT%H:%M:%S%z').timestamp()
    if last <= 0: raise ValueError(f'CNBC {key}: bad value {last}')
    return {'last': last, 'prev': last - chg, 'time': int(ts)}

def vix_pair():
    """(vix, vix3m, vix_time, vix3m_time, source) - CNBC first, Yahoo fallback."""
    try:
        a, b = cnbc('vix'), cnbc('vix3m')
        return a['last'], b['last'], a['time'], b['time'], 'CNBC'
    except Exception as e:
        log('VIX CNBC failed -> Yahoo:', repr(e))
    a, b = yahoo('%5EVIX', '1mo'), yahoo('%5EVIX3M', '1mo')
    return a['c'][-1], b['c'][-1], a['time'], b['time'], 'Yahoo'

def f_vix():
    v, _, t, _, src = vix_pair()
    return dict(value=round(v, 2), display=f'{v:.1f}', points=pts(v, 28, 35, False), as_of=iso_ts(t), source=f'{src} VIX')

def f_vix_ratio():
    a, b, ta, tb, src = vix_pair()
    r = a / b
    return dict(value=round(r, 3), display=f'{r:.2f}', points=pts(r, 1.0, 1.10, False),
                note=f'VIX3M {b:.1f}', as_of=iso_ts(min(ta, tb)), vix3m=round(b, 2), source=f'{src} VIX, VIX3M')

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
    """1) compute it ourselves from Yahoo daily bars of the Wikipedia constituents list; during US hours the last
          bar is today's live (intraday) price, so the value is current as of this run (~every 30 min).
       2) fallback: ChartRow public breadth page (% of S&P 500 members above 50-day MA, end of day only)."""
    try:
        return s5fi_compute()
    except Exception as e:
        log('S5FI compute failed -> ChartRow:', repr(e))
    page = get('https://chartrow.com/sp500/market-breadth', H_WEB, tries=2)
    t = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', re.sub(r'(?s)<script.*?</script>|<style.*?</style>', ' ', page))))
    m = re.search(r'Above 50-day MA\s*([\d.]+)%\s*(\d+) of (\d+) eligible', t)
    dm = re.search(r'as of market close,? (\w+ \d{1,2}, \d{4})', t)
    if not m or not dm: raise ValueError('ChartRow: pattern not found')
    d = datetime.datetime.strptime(dm.group(1), '%b %d, %Y').date()
    if (datetime.datetime.now(NY).date() - d).days > 5: raise ValueError(f'ChartRow: stale ({d})')
    v = int(m.group(2)) / int(m.group(3)) * 100
    return dict(value=round(v, 1), display=f'{v:.0f}%', points=pts(v, 20, 5), as_of=iso_date_ny(d),
                source='ChartRow — אחוז מניות S&P 500 מעל ממוצע 50 יום', kind='live', date_only=True,
                note=f'{m.group(2)} מתוך {m.group(3)} מניות')

def is_us_session():
    n = datetime.datetime.now(NY)
    return n.weekday() < 5 and datetime.time(9, 30) <= n.time() <= datetime.time(16, 15)

def s5fi_compute():
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
    intraday = last >= datetime.datetime.now(NY).date() and is_us_session()
    when = 'מחושב ממחירים תוך-יומיים · מתעדכן כל כ־30 דקות' if intraday else f'מחושב לפי סגירת {last.day}.{last.month}'
    return dict(value=round(v, 1), display=f'{v:.0f}%', points=pts(v, 20, 5), as_of=iso(now_utc()) if intraday else iso_date_ny(last),
                source='אחוז מניות S&P 500 מעל ממוצע 50 יום — חישוב עצמי מ־Yahoo ורשימת ויקיפדיה', kind='computed', date_only=not intraday,
                note=f'{when} · {above} מתוך {len(res)} מניות')

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
    if d['id'] in GRADED and s.get('value') is not None and s.get('status') != 'na':
        s['step'] = step_pts(s, s['value'])
        s['points'] = round(frac(s['base'], s['full'], s['value']), 4)
        s['scoring'] = 'graded'
    return bars(s)

# ------------------------------------------------------------------ info rows / yields
def run_quote(key, sym, label, fmt, prev, fetched_at, rng='1mo'):
    try:
        q = cnbc(key)
        return dict(id=key, label=label, value=round(q['last'], 3), display=fmt(q['last']),
                    change=round((q['last'] / q['prev'] - 1) * 100, 2), as_of=iso_ts(q['time']), fetched_at=fetched_at, status='live', source='CNBC')
    except Exception as e:
        log(f'[{key}] CNBC failed -> Yahoo:', repr(e))
    try:
        y = yahoo(sym, rng); c = y['c']
        return dict(id=key, label=label, value=round(c[-1], 3), display=fmt(c[-1]),
                    change=round((c[-1] / c[-2] - 1) * 100, 2), as_of=iso_ts(y['time']), fetched_at=fetched_at, status='live', source='Yahoo')
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

# ------------------------------------------------------------------ quarterly momentum heatmap (data/quarterly.json)
# Static table, recomputed ONLY when a new calendar quarter has completed (as_of != last completed quarter).
# Values = % price change, close-to-close (Yahoo 'close', not dividend-adjusted):
#   quarter = last close of the prior quarter -> last close of the quarter
#   month   = last month of the as_of quarter (last close of the prior month -> last close of that month)
#   ytd     = last close of the prior year -> last close of the as_of quarter
# If any symbol fails or looks incomplete, the file is left untouched and the next run retries.
Q_ROWS = [('NDX', '%5ENDX', 'נאסד״ק 100'), ('SPX', '%5EGSPC', 'S&P 500'), ('INDU', '%5EDJI', 'דאו ג׳ונס'),
          ('RSP', 'RSP', 'S&P 500 שווה משקל'), ('IWM', 'IWM', 'ראסל 2000')]
HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']

def month_end(y, m):
    return (datetime.date(y + (m == 12), m % 12 + 1, 1) - datetime.timedelta(days=1)) if m else datetime.date(y - 1, 12, 31)

def last_completed_month(today=None):
    today = today or datetime.datetime.now(NY).date()
    return (today.year, today.month - 1) if today.month > 1 else (today.year - 1, 12)

def close_on_or_before(y, d, sym):
    best = None
    for dt, c in zip(y['dates'], y['c']):
        if dt <= d: best = (dt, c)
        else: break
    if best is None: raise ValueError(f'{sym}: no close on/before {d}')
    if (d - best[0]).days > 5: raise ValueError(f'{sym}: last close before {d} is {best[0]} (data gap)')
    return best

def update_quarterly(force=False):
    # Recomputed whenever a new calendar MONTH has completed. The current quarter is shown "to date"
    # (through the end of the last completed month) and flagged with 'partial_q'.
    path = os.path.join(DATA, 'quarterly.json')
    year, m = last_completed_month()
    label = f'{year}-{m:02d}'
    old = load_json(path, {})
    if not force and old.get('as_of') == label:
        print(f'quarterly: up to date ({label}) - untouched'); return False
    q = (m - 1) // 3 + 1  # quarter containing the last completed month
    partial = (m % 3 != 0)
    q_end = [month_end(year, 0)] + [month_end(year, min(3 * i, m)) for i in range(1, q + 1)]
    rows = []
    for tid, sym, name in Q_ROWS:
        y = yahoo(sym, '2y')
        base = close_on_or_before(y, q_end[0], sym)
        ends = [close_on_or_before(y, q_end[i], sym) for i in range(1, q + 1)]
        prev_m = close_on_or_before(y, month_end(year, m - 1), sym)
        pct = lambda a, b: round((b[1] / a[1] - 1) * 100, 4)
        chain = [base] + ends
        rows.append({'id': tid, 'symbol': sym.replace('%5E', '^'), 'name': name, 'label': f'{name} ({tid})',
                     'ytd': pct(base, ends[-1]),
                     'q': [pct(chain[i - 1], chain[i]) if i <= q else None for i in range(1, 5)],
                     'month': pct(prev_m, ends[-1]),
                     'closes': {'prior_year_end': [base[0].isoformat(), round(base[1], 4)],
                                'quarter_ends': [[e[0].isoformat(), round(e[1], 4)] for e in ends],
                                'prior_month_end': [prev_m[0].isoformat(), round(prev_m[1], 4)]}})
    out = {'as_of': label, 'year': year, 'quarter': q, 'partial_q': q if partial else None,
           'period_end': month_end(year, m).isoformat(),
           'month': {'num': m, 'label': f'{HE_MONTHS[m - 1]} {year}'},
           'method': 'close-to-close % price change (Yahoo Finance chart API, unadjusted for dividends)',
           'generated_at': iso(now_utc()), 'rows': rows}
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f'quarterly: recomputed -> {label}'); return True

def main():
    os.makedirs(DATA, exist_ok=True)
    cfg = load_json(os.path.join(ROOT, 'config.json'), {})
    count_spx = bool(cfg.get('count_spx_in_score', False))
    old = load_json(os.path.join(DATA, 'latest.json'), {})
    prev = {s['id']: s for s in old.get('signals', []) + old.get('spx_signals', []) + old.get('yields', []) + old.get('info', []) + old.get('info_signals', [])}
    started = now_utc(); fetched_at = iso(started)

    signals = [run_signal(d, prev, fetched_at) for d in DEFS]
    spx = [run_signal(d, prev, fetched_at) for d in SPX_DEFS]
    info_signals = [run_signal(d, prev, fetched_at) for d in INFO_DEFS]  # shown only, never scored
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
    norm = lambda p, n: round(p / n * 10, 1) if n else 0.0
    core = round(core, 4)
    core_norm = norm(core, len(avail)); with_spx = norm(core + spx_pts, len(avail) + len(spx_avail))
    total = with_spx if count_spx else core_norm
    tier_i = next(i for i, (lim, _) in enumerate(TIERS) if total < lim)
    ndx_q = next(q for q in info if q['id'] == 'ndx')
    market_time = ndx_q.get('as_of') if ndx_q.get('status') != 'na' else None
    out = {
        'generated_at': fetched_at,
        'market_time': market_time,
        'score': total, 'score_max': 10, 'score_method': 'graded: sum(clamp((value-base)/(full-base),0,1)) / available x 10',
        'score_core': core_norm, 'score_with_spx': with_spx, 'count_spx_in_score': count_spx,
        'points': core, 'points_available': len(avail), 'signals_count': len(signals), 'score_spx': spx_pts,
        'tier_index': tier_i, 'tier': TIERS[tier_i][1],
        'missing': [s['id'] for s in signals + spx if s['status'] == 'na'],
        'kept': [s['id'] for s in signals + spx if s['status'] == 'kept'],
        'signals': signals, 'spx_signals': spx, 'info_signals': info_signals, 'yields': yields, 'info': info,
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
             'spx': spx_pts, 'tier': tier_i, 'missing': len(out['missing']), 't': fetched_at, 'v': 8}
    hist = [h for h in hist if h.get('d') != day] + [entry]
    hist.sort(key=lambda h: h['d'])
    with open(hist_path, 'w', encoding='utf-8') as f:
        json.dump(hist[-3000:], f, ensure_ascii=False, indent=0)

    print(f'score {total:g}/10 ({TIERS[tier_i][1]}) | points {core:g}/{len(avail)} available of {len(signals)} | S&P rows {spx_pts:g} | '
          f'missing {out["missing"]} | kept {out["kept"]}')
    for s in signals + spx + info_signals:
        print(f'  {s["points"]:>6}  {s["id"]:<10} {s["display"]:<10} {s["status"]}')
    for y in yields + info:
        print(f'       {y["id"]:<10} {y.get("display")} {y.get("status")}')
    try:
        update_quarterly()
    except Exception as e:  # never breaks the daily update; the old quarterly.json stays as is
        log('[quarterly] FAILED (file left untouched):', repr(e)); traceback.print_exc(file=sys.stderr)

if __name__ == '__main__':
    if '--quarterly-only' in sys.argv:
        os.makedirs(DATA, exist_ok=True); update_quarterly(force='--force' in sys.argv)
    else:
        main()
