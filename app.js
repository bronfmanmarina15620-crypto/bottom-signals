'use strict';
const TZ = 'Asia/Jerusalem';
const TIERS = [ // [from, to(excl), name, color, range label]
  [0, 3, 'אין פחד עדיין', '#8a94a6', '0–2.9'],
  [3, 5, 'פחד מצטבר — להתכונן', '#f2c94c', '3–4.9'],
  [5, 7, 'פחד אמיתי — אזור קנייה', '#f2994a', '5–6.9'],
  [7, 999, 'כניעה', '#27ae60', '7–10'],
];
// The 6 scored signals (NDX drawdown, NDX vs 200d, HY OAS and macro relief were removed on 1.10.2026).
// Score = points earned / points available (signals with data) x 10.
const SCORED = ['vix', 'vix_ratio', 'fng', 's5fi', 'aaii', 'putcall'];
const hasData = (s) => s && s.status !== 'na' && s.value != null;
function normScore(list) {
  const av = list.filter(hasData), pts = av.reduce((a, s) => a + (s.points || 0), 0);
  return { pts, n: av.length, score: av.length ? pts / av.length * 10 : 0 };
}
const COLORS = { gray: '#6b7280', yellow: '#f2c94c', green: '#27ae60' };
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- text helpers
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Latin / numeric runs inside Hebrew text are isolated as LTR so the bidi algorithm never reorders them.
const LTR_RUN = /(?:[≤≥+\-−$^]\s?)?[A-Za-z0-9][A-Za-z0-9&\/.,:%$^+\-−]*(?:\s+[A-Za-z0-9&^][A-Za-z0-9&\/.,:%$^+\-−]*)*|[≤≥+\-−$][0-9][0-9.,]*%?/g;
function bidi(text) {
  const s = String(text ?? ''); let out = '', pos = 0;
  if (!/[\u0590-\u05FF]/.test(s)) return s ? `<bdi dir="ltr">${esc(s)}</bdi>` : '';
  for (const m of s.matchAll(LTR_RUN)) {
    out += esc(s.slice(pos, m.index)) + `<bdi dir="ltr">${esc(m[0])}</bdi>`; pos = m.index + m[0].length;
  }
  return out + esc(s.slice(pos));
}
const fmtNum = (x) => (Math.round(x * 10) / 10).toString();

function parts(d, opts) {
  const o = {}; new Intl.DateTimeFormat('en-GB', { hourCycle: 'h23', ...opts }).formatToParts(d).forEach((p) => (o[p.type] = p.value)); return o;
}
function fmtIL(iso, withYear) { // "1.10.2026 17:05" in Israel time
  if (!iso) return '';
  const p = parts(new Date(iso), { timeZone: TZ, day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `${+p.day}.${+p.month}${withYear ? '.' + p.year : ''} ${p.hour}:${p.minute}`;
}
function fmtDateNY(iso) { // EOD data: show the US market date
  const p = parts(new Date(iso), { timeZone: 'America/New_York', day: 'numeric', month: 'numeric' });
  return `${+p.day}.${+p.month}`;
}
function weekdayIL(iso) {
  return new Intl.DateTimeFormat('he-IL', { timeZone: TZ, weekday: 'long' }).format(new Date(iso));
}
// hours elapsed counting only US weekdays (so weekends never trigger the stale warning)
function weekdayHours(iso) {
  if (!iso) return Infinity;
  let t = new Date(iso).getTime(); const now = Date.now(); let h = 0;
  const wd = (ms) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date(ms));
  while (t < now && h < 1000) { const step = Math.min(3600e3, now - t); if (!['Sat', 'Sun'].includes(wd(t))) h += step / 3600e3; t += 3600e3; }
  return h;
}

// ---------------------------------------------------------------- gauge (0 on the right, max on the left)
function gaugeSVG(total, max, tierColor, threshold) {
  const W = 860, R = 300, w = 60, cx = W / 2, cy = R + w / 2 + 62, H = cy + 30;
  const pt = (v, r) => { const a = Math.PI * v / max; return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; };
  const f = (n) => n.toFixed(1);
  const arc = (v0, v1, col, op) => { const [x0, y0] = pt(v0, R), [x1, y1] = pt(v1, R);
    return `<path d="M${f(x0)},${f(y0)} A${R},${R} 0 0 0 ${f(x1)},${f(y1)}" stroke="${col}" stroke-width="${w}" fill="none" opacity="${op}"/>`; };
  let s = '';
  const bounds = [[0, 3], [3, 5], [5, 7], [7, max]];
  bounds.forEach(([a, b], i) => {
    const active = (total >= a && total < b) || (i === 3 && total >= 7);
    s += arc(a + (a ? 0.05 : 0), b - (b < max ? 0.05 : 0), TIERS[i][3], active ? 1 : 0.5);
  });
  for (let v = 0; v <= max; v++) {
    const major = [0, 3, 5, 7, max].includes(v);
    const [x0, y0] = pt(v, R + w / 2 + 6), [x1, y1] = pt(v, R + w / 2 + (major ? 22 : 13));
    s += `<line x1="${f(x0)}" y1="${f(y0)}" x2="${f(x1)}" y2="${f(y1)}" stroke="#9aa3b2" stroke-width="${major ? 4 : 2}"/>`;
    if (major) { const [tx, ty] = pt(v, R + w / 2 + 46); s += `<text x="${f(tx)}" y="${f(ty + 11)}" font-size="32" font-weight="700" fill="#cfd6e2" text-anchor="middle">${v}</text>`; }
  }
  if (threshold != null && threshold >= 0 && threshold <= max) { // full-buy marker (only when configured)
    const [a0, b0] = pt(threshold, R - w / 2 - 4), [a1, b1] = pt(threshold, R + w / 2 + 4);
    s += `<line x1="${f(a0)}" y1="${f(b0)}" x2="${f(a1)}" y2="${f(b1)}" stroke="#6fdc9a" stroke-width="8" stroke-linecap="round"/>`;
  }
  const tv = Math.max(0, Math.min(max, total));
  const [nx, ny] = pt(tv, R - w / 2 - 14), a = Math.PI * tv / max, px = Math.sin(a) * 14, py = Math.cos(a) * 14;
  s += `<polygon points="${f(nx)},${f(ny)} ${f(cx + px)},${f(cy + py)} ${f(cx - px)},${f(cy - py)}" fill="#fff"/>`;
  s += `<circle cx="${cx}" cy="${cy}" r="22" fill="#fff"/><circle cx="${cx}" cy="${cy}" r="9" fill="${tierColor}"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" direction="ltr" font-family="Heebo, sans-serif" role="img" aria-label="מד ציון">${s}</svg>`;
}

// ---------------------------------------------------------------- rows
function metaLine(s) {
  const bits = [];
  if (s.status === 'na') {
    bits.push(`מקור לא זמין: ${bidi(s.source)}`);
  } else {
    let when = '';
    if (s.as_of) when = s.date_only ? `נתון ל־${fmtDateNY(s.as_of)}` : fmtIL(s.as_of);
    bits.push(bidi(s.source) + (when ? ' · ' + bidi(when) : ''));
    if (s.note) bits.push(bidi(s.note));
    if (s.status === 'kept') bits.push(`<span class="kept">המקור נכשל — מוצג הנתון האחרון${s.fetched_at ? ' (נמשך ' + bidi(fmtIL(s.fetched_at)) + ')' : ''}</span>`);
    if (s.status === 'computed' || s.kind === 'computed') bits.unshift('<span class="comp">מחושב</span>');
  }
  return bits.join(' · ');
}

function rowHTML(s, num, extraClass) {
  const na = s.status === 'na' || s.value == null;
  const p = na ? 0 : s.bar_p, h = s.bar_h ?? 0.5, col = COLORS[s.color] || COLORS.gray;
  const pt = s.points || 0;
  const dotBg = pt >= 1 ? COLORS.green : pt >= 0.5 ? 'linear-gradient(to left, #27ae60 50%, #2a3140 50%)' : '#2a3140';
  const dotBd = pt >= 0.5 ? COLORS.green : '#4b5563';
  const shift = h > 0.72 ? '100%' : h < 0.12 ? '0%' : '50%';
  const curColor = s.color === 'gray' || !s.color ? '#ffffff' : col;
  const ptsTxt = pt >= 1 ? 'נקודה' : pt >= 0.5 ? 'חצי נקודה' : '0 נקודות';
  return `<div class="row ${extraClass || ''}">
  <div class="r1"><div class="lab"><span class="num">${num}</span>${bidi(s.label)}</div>
    ${na ? '<div class="cur na">אין נתון</div><span class="dot na" aria-label="אין נתון"></span>'
         : `<div class="cur" style="color:${curColor}">${esc(s.display)}</div><span class="dot" style="background:${dotBg};border-color:${dotBd}" title="${ptsTxt}" aria-label="${ptsTxt}"></span>`}
  </div>
  <div class="meta">${metaLine(s)}</div>
  <div class="barwrap"><div class="bar${na ? ' na' : ''}"><div class="fill" style="width:${(p * 100).toFixed(1)}%;background:${col}"></div></div>
    <div class="tick" style="right:${(h * 100).toFixed(1)}%"></div>
    <div class="tl half" style="right:${(h * 100).toFixed(1)}%;transform:translateX(${shift})">${bidi(s.half_display)}</div>
    <div class="tl full">${bidi(s.full_display)}</div></div>
</div>`;
}


// ---------------------------------------------------------------- top-3 quick-glance cards
const STATUS = { // by points of the live signal
  calm: ['רגוע', '#8a94a6'], near: ['מתקרב', '#f2c94c'], extreme: ['פחד קיצוני', '#27ae60'], na: ['אין נתון', '#6b7280'],
};
const stKey = (s) => (!s || s.status === 'na' || s.value == null) ? 'na' : (s.points >= 1 ? 'extreme' : s.points >= 0.5 ? 'near' : 'calm');
const TOP3 = [
  { id: 'vix', name: 'VIX', sub: 'מדד הפחד', full: '≥35', half: '≥28' },
  { id: 's5fi', name: 'S5FI', sub: 'מניות מעל ממוצע 50 יום', full: '≤5%', half: '≤15%' },
  { id: 'fng', name: 'פחד וחמדנות', sub: 'CNN', full: '≤10', half: '≤25',
    second: { id: 'vix_ratio', name: 'VIX/VIX3M', full: '≥1.10', half: '≥1.00' } },
];
function pill(k, small) {
  const [t, c] = STATUS[k]; return `<span class="pill${small ? ' sm' : ''}" style="background:${c}">${t}</span>`;
}
function cardHTML(c, byId) {
  const s = byId[c.id], k = stKey(s), col = STATUS[k][1];
  const val = k === 'na' ? '<span class="cvna">אין נתון</span>' : esc(s.display);
  const kept = s && s.status === 'kept' ? '<span class="ck">נתון אחרון</span>' : '';
  const p = k === 'na' ? 0 : (s.bar_p || 0);
  let second = '';
  if (c.second) {
    const s2 = byId[c.second.id], k2 = stKey(s2);
    const v2 = k2 === 'na' ? 'אין נתון' : `<b style="color:${k2 === 'calm' ? '#eef2f7' : STATUS[k2][1]}"><bdi dir="ltr">${esc(s2.display)}</bdi></b>`;
    second = `<div class="c2"><span class="c2n"><bdi dir="ltr">${c.second.name}</bdi></span> ${v2}
      <span class="c2t">מלאה <bdi dir="ltr">${c.second.full}</bdi> · חצי <bdi dir="ltr">${c.second.half}</bdi></span>${pill(k2, true)}</div>`;
  }
  return `<div class="card" style="--c:${col}">
  <div class="ctop"><div class="cl"><div class="cn">${bidi(c.name)} <span class="csub">${bidi(c.sub)}</span></div>
      <div class="ct">נקודה מלאה <b><bdi dir="ltr">${c.full}</bdi></b> · חצי <bdi dir="ltr">${c.half}</bdi></div>
      <div class="cst">${pill(k)}${kept}</div></div>
    <div class="cv" style="color:${k === 'calm' ? '#ffffff' : col}">${val}</div></div>
  <div class="cbar"><div style="width:${(p * 100).toFixed(1)}%;background:${col}"></div></div>${second}
</div>`;
}

// ---------------------------------------------------------------- reliability ranking (static backtest stats)
const BADGE = { high: ['גבוהה', '#27ae60'], medium: ['בינונית', '#f2c94c'], low: ['נמוכה', '#eb5757'] };
function rankHTML(r, live) {
  const [bt, bc] = BADGE[r.badge] || BADGE.low;
  const sgn = (x) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x);
  const since = r.history_from && r.history_from > '2001' ? ` (מאז <bdi dir="ltr">${r.history_from.slice(0, 4)}</bdi>)` : '';
  const lead = r.lead_days == null ? '' : r.lead_days >= 0
    ? ` · כ־<bdi dir="ltr">${r.lead_days}</bdi> ימים לפני השפל` : ` · כ־<bdi dir="ltr">${-r.lead_days}</bdi> ימים אחרי השפל`;
  const lk = live ? stKey(live) : null;
  return `<div class="rk">
  <span class="rn">${r.rank}</span>
  <div class="rb"><div class="rt"><span class="rname">${bidi(r.name)} <span class="rthr">${(r.full_threshold || []).map((t) => `<bdi dir="ltr">${esc(t)}</bdi>`).join(' + ')}</span></span><span class="badge" style="color:${bc};border-color:${bc}">${bt}</span></div>
    <div class="rs">תפס <b><bdi dir="ltr">${r.caught}/${r.episodes}</bdi></b> ירידות${since}${lead}</div>
    <div class="rs">אחרי שנה: <b><bdi dir="ltr">${r.pct_pos_1y}%</bdi></b> חיובי · חציון <b class="${r.median_1y >= 0 ? 'up' : 'dn'}"><bdi dir="ltr">${sgn(r.median_1y)}%</bdi></b>${r.pct_days_full_on >= 10 ? ` · דלוק ב־<bdi dir="ltr">${Math.round(r.pct_days_full_on)}%</bdi> מהימים` : ''}</div>
    ${r.data_note ? `<div class="rd">${bidi(r.data_note)}</div>` : ''}</div>
  ${lk ? `<span class="rlive" title="מצב עכשיו">${pill(lk, true)}</span>` : ''}
</div>`;
}
function renderRank(st, byId) {
  if (!st || !Array.isArray(st.signals)) {
    $('rankbase').innerHTML = ''; $('ranknote').innerHTML = ''; $('rank').innerHTML = '<div class="rd">אין נתון לדירוג כרגע.</div>'; return;
  }
  const b = st.baseline || {};
  $('rankbase').innerHTML = `לפי בדיקה היסטורית על <bdi dir="ltr">${st.big_drops}</bdi> ירידות של <bdi dir="ltr">15%+</bdi> בנאסד״ק <bdi dir="ltr">100</bdi> מאז <bdi dir="ltr">2000</bdi>, כשהסימן בנקודה מלאה. התג בצד = המצב עכשיו. ` +
    `<span class="rbl">לשם השוואה, יום אקראי: <b><bdi dir="ltr">${b.pct_pos_1y}%</bdi></b> חיובי אחרי שנה · חציון <b><bdi dir="ltr">+${b.median_1y}%</bdi></b> (<bdi dir="ltr">QQQ</bdi>)</span>`;
  $('rank').innerHTML = st.signals.filter((r) => SCORED.includes(r.id)).slice().sort((a, c) => a.rank - c.rank).map((r) => rankHTML(r, byId[r.id])).join('');
  $('ranknote').innerHTML = '<b>מגבלות הנתונים:</b> בפועל יש רק כ־<bdi dir="ltr">11</bdi> אירועים, והימים הדלוקים סמוכים זה לזה — כלומר המדגם קטן. ' +
    'ל־<bdi dir="ltr">VIX/VIX3M</bdi> יש נתונים רק מ־<bdi dir="ltr">2006</bdi>, ולפחד וחמדנות רק מ־<bdi dir="ltr">2011</bdi>. ' +
    'ההיסטוריה של <bdi dir="ltr">S5FI</bdi> משוחזרת ממניות המדד של היום, ולכן היא מקורבת ואופטימית. ' +
    'את פוט/קול בדקנו דרך מדד תחליף לתקופה קצרה. ' +
    '"ימים לפני השפל" = חציון הימים מהנקודה המלאה הראשונה ועד השפל; ככל שהמספר גבוה יותר, הסימן מקדים מדי. עבר אינו מבטיח עתיד.';
}

// ---------------------------------------------------------------- history chart
function histSVG(hist, max) {
  const W = 600, H = 190, L = 30, Rr = 10, T = 10, B = 26;
  const pts = hist.filter((x) => typeof x.score === 'number');
  const y = (v) => T + (H - T - B) * (1 - v / max);
  let s = '';
  [[0, 3], [3, 5], [5, 7], [7, max]].forEach(([a, b], i) => {
    s += `<rect x="${L}" y="${y(b).toFixed(1)}" width="${W - L - Rr}" height="${(y(a) - y(b)).toFixed(1)}" fill="${TIERS[i][3]}" opacity="0.13"/>`;
  });
  [0, 3, 5, 7, max].forEach((v) => { s += `<text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" font-size="12" fill="#7d8696" text-anchor="end">${v}</text>`; });
  if (!pts.length) return `<svg viewBox="0 0 ${W} ${H}" direction="ltr">${s}</svg>`;
  // RTL time axis: newest on the left? Keep the natural reading for Hebrew: oldest on the right, newest on the left.
  const n = pts.length, x = (i) => n === 1 ? (L + W - Rr) / 2 : (W - Rr) - (W - Rr - L) * (i / (n - 1));
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(Math.min(max, p.score)).toFixed(1)}`).join(' ');
  if (n > 1) s += `<path d="${d}" fill="none" stroke="#eef2f7" stroke-width="2.5" stroke-linejoin="round"/>`;
  pts.forEach((p, i) => { if (n <= 60 || i === n - 1) s += `<circle cx="${x(i).toFixed(1)}" cy="${y(Math.min(max, p.score)).toFixed(1)}" r="${i === n - 1 ? 5 : 3}" fill="${TIERS[tierIndex(p.score)][3]}" stroke="#0f141c" stroke-width="1.5"/>`; });
  const lab = (p) => { const [Y, M, D] = p.d.split('-'); return `${+D}.${+M}`; };
  s += `<text x="${(W - Rr).toFixed(1)}" y="${H - 6}" font-size="12" fill="#7d8696" text-anchor="end">${lab(pts[0])}</text>`;
  if (n > 1) s += `<text x="${L}" y="${H - 6}" font-size="12" fill="#7d8696" text-anchor="start">${lab(pts[n - 1])}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" direction="ltr" font-family="Heebo, sans-serif" role="img" aria-label="היסטוריית ציון">${s}</svg>`;
}
const tierIndex = (t) => TIERS.findIndex(([a, b]) => t < b);

// ---------------------------------------------------------------- render
function render(d, cfg, hist, stats) {
  const countSpx = cfg.count_spx_in_score ?? d.count_spx_in_score ?? false;
  const thr = cfg.full_buy_threshold !== undefined ? cfg.full_buy_threshold : d.full_buy_threshold;
  const sigs = d.signals.filter((s) => SCORED.includes(s.id));
  const counted = countSpx ? sigs.concat(d.spx_signals || []) : sigs;
  const ns = normScore(counted), total = ns.score, max = 10;
  const ti = tierIndex(total), tier = TIERS[ti];

  // updated + alerts
  const gen = d.generated_at;
  $('updated').innerHTML = `עודכן לאחרונה: <b>${esc(weekdayIL(gen))} ${bidi(fmtIL(gen, true))}</b> (שעון ישראל)` +
    (d.market_time ? ` · נתוני שוק עד ${bidi(fmtIL(d.market_time))}` : '');
  const alerts = [];
  const staleH = Math.max(weekdayHours(gen), weekdayHours(d.market_time));
  if (staleH > 30) alerts.push(`<div class="alert stale">⚠ הנתונים ישנים — העדכון האחרון לפני יותר מיום מסחר. ייתכן שהעדכון האוטומטי נתקע.</div>`);
  const all = sigs.concat(d.spx_signals || []);
  const miss = all.filter((s) => s.status === 'na'), kept = all.filter((s) => s.status === 'kept');
  if (miss.length) alerts.push(`<div class="alert miss">אין נתון ל־${miss.length} סימנים (${miss.map((s) => bidi(s.label)).join(', ')}) — לא נספרים — הציון מחושב מתוך הסימנים הזמינים.</div>`);
  if (kept.length) alerts.push(`<div class="alert miss">ל־${kept.length} סימנים מוצג הנתון התקין האחרון כי המקור נכשל בעדכון זה.</div>`);
  $('alerts').innerHTML = alerts.join('');

  // gauge
  $('gauge').innerHTML = gaugeSVG(total, max, tier[3], thr) +
    `<div class="center"><div class="big">${fmtNum(total)}<small>/${max}</small></div><span class="tier" style="background:${tier[3]}">${esc(tier[2])}</span></div>`;
  $('ptsl').innerHTML = `<bdi dir="ltr">${fmtNum(ns.pts)}</bdi> נקודות מתוך <bdi dir="ltr">${ns.n}</bdi> אפשריות` +
    (ns.n < counted.length ? ` · <bdi dir="ltr">${counted.length - ns.n}</bdi> סימנים בלי נתון` : '') + ` · <bdi dir="ltr">${counted.length}</bdi> סימנים בציון`;
  $('legend').innerHTML = TIERS.map((t, i) => `<div class="chip${i === ti ? ' on' : ''}"><span class="sw" style="background:${t[3]}"></span><span class="cn">${esc(t[2])}</span><span class="cr"><bdi dir="ltr">${t[4]}</bdi></span></div>`).join('');

  const byId = Object.fromEntries(sigs.map((s) => [s.id, s]));
  $('top3').innerHTML = TOP3.map((c) => cardHTML(c, byId)).join('');
  renderRank(stats, byId);
  // the 6 rows, ordered by the reliability rank when available (number = rank)
  const rk = Object.fromEntries(((stats && stats.signals) || []).map((r) => [r.id, r.rank]));
  const ordered = sigs.map((s, i) => ({ s, n: rk[s.id] ?? 100 + i })).sort((a, b) => a.n - b.n);
  const ranked = ordered.every((o) => o.n < 100);
  $('rows').innerHTML = ordered.map((o, i) => rowHTML(o.s, ranked ? o.n : i + 1)).join('');
  $('spxnote').textContent = countSpx ? '(נספר בציון)' : '(לא נספר בציון)';
  $('spxrows').innerHTML = (d.spx_signals || []).map((s, i) => rowHTML(s, countSpx ? sigs.length + 1 + i : '•', 'spx')).join('');

  $('yields').innerHTML = (d.yields || []).map((y) => {
    if (y.value == null) return `<div class="y">${esc(y.label)}<span class="v" style="direction:rtl">אין נתון</span><span class="yl">קו אזהרה <bdi dir="ltr">${y.line}%</bdi></span></div>`;
    const warn = y.value >= y.line;
    return `<div class="y${warn ? ' warn' : ''}">${warn ? '⚠ ' : ''}${esc(y.label)}<span class="v">${esc(y.display)}</span><span class="yl">${warn ? 'מעל קו' : 'מתחת לקו'} <bdi dir="ltr">${y.line}%</bdi>${y.status === 'kept' ? ' · נתון אחרון' : ''}</span></div>`;
  }).join('');

  $('info').innerHTML = (d.info || []).map((q) => {
    if (q.value == null) return `<div class="q"><span class="ql">${bidi(q.label)}</span><span class="qv" style="direction:rtl;color:#8a94a6">אין נתון</span></div>`;
    const c = q.change; const cls = c > 0 ? 'up' : c < 0 ? 'dn' : '';
    const ch = c == null ? '' : `<span class="qc ${cls}">${(c > 0 ? '+' : c < 0 ? '−' : '') + Math.abs(c).toFixed(2)}%</span>`;
    return `<div class="q"><span class="ql">${bidi(q.label)}</span><span class="qv">${esc(q.display)}${ch}</span></div>`;
  }).join('');

  const note = $('buynote');
  const tnote = cfg.full_buy_threshold_note ?? d.full_buy_threshold_note;
  const tn = tnote ? `<div class="tnote">${bidi(tnote)}</div>` : '';
  if (thr == null) { note.className = 'note pending'; note.innerHTML = 'סף הקנייה המלאה ב־<bdi dir="ltr">QQQ</bdi> — טרם נקבע' + tn; }
  else if (total >= thr) { note.className = 'note hit'; note.innerHTML = `✅ הגענו לסף הקנייה המלאה ב־<bdi dir="ltr">QQQ</bdi> (ציון <bdi dir="ltr">${thr}</bdi> ומעלה)` + tn; }
  else { note.className = 'note'; note.innerHTML = `סף הקנייה המלאה ב־<bdi dir="ltr">QQQ</bdi>: ציון <bdi dir="ltr">${thr}/10</bdi> ומעלה` + tn; }

  const h = Array.isArray(hist) ? hist : [];
  // v6 entries hold the normalized 6-signal score; older entries (10-signal raw score) are not comparable and are skipped
  const h6 = h.filter((x) => x.v === 6);
  const hs = h6.map((x) => ({ ...x, score: countSpx ? (x.with_spx ?? x.score) : (x.core ?? x.score) }));
  $('hist').innerHTML = histSVG(hs, max) + `<div class="hn">${hs.length <= 1 ? 'ההיסטוריה מתחילה עכשיו — נשמרת נקודה אחת לכל יום מסחר.' : `${hs.length} ימי מסחר · ימין = הישן, שמאל = החדש`}</div>`;
}

// ---------------------------------------------------------------- load / refresh
let loading = false;
async function getJSON(url) {
  const r = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json();
}
async function load() {
  if (loading) return; loading = true;
  $('refresh').classList.add('spin'); $('ptr').classList.add('loading');
  try {
    const [d, cfg, hist, stats] = await Promise.all([getJSON('data/latest.json'), getJSON('config.json').catch(() => ({})), getJSON('data/history.json').catch(() => []), getJSON('data/indicator_stats.json').catch(() => null)]);
    render(d, cfg || {}, hist, stats);
  } catch (e) {
    $('alerts').innerHTML = `<div class="alert err">לא הצלחתי לטעון את הנתונים. בדקי חיבור ונסי לרענן.</div>`;
    console.error(e);
  } finally {
    loading = false; $('refresh').classList.remove('spin'); $('ptr').classList.remove('loading'); $('ptr').style.transform = '';
  }
}
$('refresh').addEventListener('click', load);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
setInterval(() => { if (document.visibilityState === 'visible') load(); }, 5 * 60 * 1000);

// pull-to-refresh (works also inside the installed home-screen app)
(() => {
  let y0 = null, dy = 0; const ptr = $('ptr');
  addEventListener('touchstart', (e) => { y0 = scrollY <= 0 ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  addEventListener('touchmove', (e) => { if (y0 == null) return; dy = e.touches[0].clientY - y0; if (dy > 0) ptr.style.transform = `translate(-50%, ${Math.min(dy, 110) - 60}px)`; }, { passive: true });
  addEventListener('touchend', () => { if (y0 != null && dy > 80) load(); else ptr.style.transform = ''; y0 = null; });
})();

if ('serviceWorker' in navigator) {
  let reloaded = false; const hadCtrl = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadCtrl && !reloaded) { reloaded = true; location.reload(); } });
  addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {}));
}
load();
