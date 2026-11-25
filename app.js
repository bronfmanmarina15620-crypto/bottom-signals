'use strict';
const TZ = 'Asia/Jerusalem';
const TIERS = [ // [from, to(excl), name, color, range label]
  [0, 3, 'אין פחד עדיין', '#8a94a6', '0–2.9'],
  [3, 5, 'פחד מצטבר — להתכונן', '#f2c94c', '3–4.9'],
  [5, 7, 'פחד אמיתי — אזור הזדמנות', '#f2994a', '5–6.9'],
  [7, 999, 'כניעה', '#27ae60', '7–10'],
];
// The 5 scored LIVE signals (NDX drawdown, NDX vs 200d, HY OAS and macro relief were removed on 1.10.2026;
// AAII, a weekly survey collected days earlier, was removed from the score on 20.11.2026 and is shown as info only).
// Score = points earned / points available (signals with data) x 10, one decimal.
// GRADED (20.11.2026): each counted signal scores clamp((value-base)/(full-base),0,1); half/full thresholds unchanged,
// the half mark is a reference only. s.step keeps the old 0/0.5/1 crossing state for the status pills / colors.
const SCORED = ['vix', 'vix_ratio', 'fng', 's5fi', 'putcall'];
const hasData = (s) => s && s.status !== 'na' && s.value != null;
function normScore(list) {
  const av = list.filter(hasData), pts = av.reduce((a, s) => a + (s.points || 0), 0);
  return { pts, n: av.length, score: av.length ? Math.round(pts / av.length * 100) / 10 : 0 };
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
  const pt = stepOf(s);
  const dotBg = pt >= 1 ? COLORS.green : pt >= 0.5 ? 'linear-gradient(to left, #27ae60 50%, #2a3140 50%)' : '#2a3140';
  const dotBd = pt >= 0.5 ? COLORS.green : '#4b5563';
  const shift = h > 0.72 ? '100%' : h < 0.12 ? '0%' : '50%';
  const curColor = s.color === 'gray' || !s.color ? '#ffffff' : col;
  const graded = SCORED.includes(s.id) && extraClass !== 'infoonly';
  const ptsTxt = graded ? `${(s.points || 0).toFixed(2)} נקודות` : pt >= 1 ? 'נקודה' : pt >= 0.5 ? 'חצי נקודה' : '0 נקודות';
  return `<div class="row ${extraClass || ''}">
  <div class="r1"><div class="lab"><span class="num">${num}</span>${bidi(s.label)}</div>
    ${na ? '<div class="cur na">אין נתון</div><span class="dot na" aria-label="אין נתון"></span>'
         : `<div class="cur" style="color:${curColor}">${esc(s.display)}</div>${graded ? `<span class="gpts" title="ניקוד הדרגתי מתוך 1"><bdi dir="ltr">${(s.points || 0).toFixed(2)}</bdi></span>` : ''}<span class="dot" style="background:${dotBg};border-color:${dotBd}" title="${ptsTxt}" aria-label="${ptsTxt}"></span>`}
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
const stepOf = (s) => (s && s.step != null ? s.step : (s && s.points) || 0);
const stKey = (s) => (!s || s.status === 'na' || s.value == null) ? 'na' : (stepOf(s) >= 1 ? 'extreme' : stepOf(s) >= 0.5 ? 'near' : 'calm');
const TOP3 = [
  { id: 'vix', name: 'VIX', sub: 'מדד הפחד', full: '≥35', half: '≥28' },
  { id: 's5fi', name: 'S5FI', sub: 'מניות מעל ממוצע 50 יום', full: '≤5%', half: '≤20%' },
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
  $('rank').innerHTML = st.signals.filter((r) => SCORED.includes(r.id)).slice().sort((a, c) => a.rank - c.rank).map((r, i) => rankHTML({ ...r, rank: i + 1 }, byId[r.id])).join('');
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
    (d.market_time ? ` · נתוני שוק עד ${bidi(fmtIL(d.market_time))}` : '') +
    (d.live_info ? `<br>נתונים חיים: <b>${bidi(fmtIL(new Date(d.live_info.newest).toISOString()))}</b> (${bidi(d.live_info.sources.join(', '))})` : '');
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
  $('ptsl').innerHTML = `ניקוד הדרגתי: <bdi dir="ltr">${ns.pts.toFixed(2)}</bdi> נקודות מתוך <bdi dir="ltr">${ns.n}</bdi> אפשריות` +
    (ns.n < counted.length ? ` · <bdi dir="ltr">${counted.length - ns.n}</bdi> סימנים בלי נתון` : '') + ` · <bdi dir="ltr">${counted.length}</bdi> סימנים בציון`;
  $('legend').innerHTML = TIERS.map((t, i) => `<div class="chip${i === ti ? ' on' : ''}"><span class="sw" style="background:${t[3]}"></span><span class="cn">${esc(t[2])}</span><span class="cr"><bdi dir="ltr">${t[4]}</bdi></span></div>`).join('');

  const byId = Object.fromEntries(sigs.map((s) => [s.id, s]));
  $('top3').innerHTML = TOP3.map((c) => cardHTML(c, byId)).join('');
  renderRank(stats, byId);
  // the 6 rows, ordered by the reliability rank when available (number = rank)
  const rk = Object.fromEntries(((stats && stats.signals) || []).map((r) => [r.id, r.rank]));
  const ordered = sigs.map((s, i) => ({ s, n: rk[s.id] ?? 100 + i })).sort((a, b) => a.n - b.n);
  const ranked = ordered.every((o) => o.n < 100);
  $('rows').innerHTML = ordered.map((o, i) => rowHTML(o.s, i + 1)).join('') +
    (d.info_signals || []).map((s) => rowHTML(s, '•', 'infoonly') +
      `<div class="infonote">סקר שבועי של משקיעים פרטיים, שנאסף בימים שלפני הפרסום — לא משקף את השוק ברגע זה, ולכן <b>לא נספר בציון</b>.</div>`).join('');
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
  // v7 = 5 live signals (no AAII). Entries before 20.11.2026 were recomputed without AAII from the stored per-run data.
  const h6 = h.filter((x) => x.v === 7);
  const hs = h6.map((x) => ({ ...x, score: countSpx ? (x.with_spx ?? x.score) : (x.core ?? x.score) }));
  $('hist').innerHTML = histSVG(hs, max) + `<div class="hn">${hs.length <= 1 ? 'ההיסטוריה מתחילה עכשיו — נשמרת נקודה אחת לכל יום מסחר.' : `${hs.length} ימי מסחר · ימין = הישן, שמאל = החדש · חושב לאחור בניקוד הדרגתי, בלי <bdi dir="ltr">AAII</bdi>`}</div>`;
}

// ---------------------------------------------------------------- quarterly momentum heatmap (updated after each completed month; current quarter shown to date)
function qCell(v, colMax) {
  if (v == null) return '<td class="qc qf">—</td>';
  const a = Math.abs(v), sign = v > 0 ? '+' : v < 0 ? '−' : '';
  const txt = `<bdi dir="ltr">${sign}${a.toFixed(2)}%</bdi>`;
  if (a < 0.1) return `<td class="qc qz">${txt}</td>`; // |change| < 0.1% = no change (yellow)
  const t = colMax > 0 ? Math.min(1, a / colMax) : 1, al = (0.22 + 0.63 * t).toFixed(2);
  const rgb = v > 0 ? '39,174,96' : '235,87,87';
  return `<td class="qc ${v > 0 ? 'qu' : 'qd'}" style="background:rgba(${rgb},${al})">${txt}</td>`;
}
function renderQuarterly(q) {
  const sec = $('qsec');
  if (!q || !Array.isArray(q.rows) || !q.rows.length) { sec.hidden = true; return; }
  const rows = q.rows;
  const cols = [['ytd', 'מתחילת השנה', (r) => r.ytd]]
    .concat([0, 1, 2, 3].map((i) => [`q${i + 1}`, q.partial_q === i + 1 ? `רבעון ${i + 1} (עד כה)` : `רבעון ${i + 1}`, (r) => (r.q || [])[i]]))
    .concat([['m', (q.month && q.month.label) || 'חודש אחרון', (r) => r.month]]);
  const head = '<thead><tr><th class="qn"></th>' + cols.map(([, t]) => `<th>${bidi(t)}</th>`).join('') + '</tr></thead>';
  const maxes = cols.map(([, , g]) => Math.max(0, ...rows.map(g).filter((v) => v != null).map(Math.abs)));
  const body = '<tbody>' + rows.map((r) => `<tr><th class="qn" aria-label="${esc(r.label)}">${bidi(r.name || r.label)}${r.id ? ` <span class="qtk"><bdi dir="ltr">(${esc(r.id)})</bdi></span>` : ''}</th>` +
    cols.map(([, , g], i) => qCell(g(r), maxes[i])).join('') + '</tr>').join('') + '</tbody>';
  $('qtable').innerHTML = head + body;
  $('qasof').innerHTML = q.live
    ? `מעודכן חי: <b>${bidi(q.live_as_of ? fmtIL(q.live_as_of) : '')}</b> (שעון ישראל) · "מתחילת השנה", הרבעון הנוכחי והחודש הנוכחי מחושבים מהמחיר העדכני; רבעונים שהסתיימו קבועים`
    : `מעודכן לסוף ${bidi((q.month && q.month.label) || '')} · מתעדכן אחרי כל חודש שמסתיים`;
  sec.hidden = false;
}


// ---------------------------------------------------------------- live refresh (browser-side, CORS-allowed public feeds)
// On every load/refresh the file values (data/latest.json, written by the GitHub Action) are overlaid with the freshest
// public quotes, then points/score/tier are recomputed with the SAME rules as scripts/update.py. A value is replaced
// only if the live one is newer than the file one; any failure silently keeps the file value.
const CNBC_SYM = { vix: '.VIX', vix3m: '.VIX3M', spx: '.SPX', y10: 'US10Y', y30: 'US30Y', brent: '@LCO.1', dxy: '.DXY', ndx: '.NDX', qqq: 'QQQ',
  q_dji: '.DJI', q_rsp: 'RSP', q_iwm: 'IWM' };
const CNBC_URL = 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=' +
  Object.values(CNBC_SYM).map(encodeURIComponent).join('%7C') + '&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1';
const CNN_URL = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';
function fetchTO(url, ms) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { cache: 'no-store', referrerPolicy: 'no-referrer', signal: c.signal }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).finally(() => clearTimeout(t));
}
const num = (x) => parseFloat(String(x).replace(/[,%\s]/g, ''));
const nyDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms));
function nyCloseMs(ymd, hh, mm) { // a NY wall-clock time -> epoch ms (handles EST/EDT)
  const guess = Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10), hh, mm);
  const p = parts(new Date(guess), { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return guess + (guess - asUTC);
}
function parseCNBC(j) {
  const out = {}, by = {};
  ((j && j.FormattedQuoteResult && j.FormattedQuoteResult.FormattedQuote) || []).forEach((q) => (by[q.symbol] = q));
  for (const [k, sym] of Object.entries(CNBC_SYM)) {
    const q = by[sym]; if (!q || String(q.code) !== '0') continue;
    const last = num(q.last), chg = num(q.change || 0), t = String(q.last_time || '');
    if (!(last > 0)) continue;
    const ms = t.length === 10 ? nyCloseMs(t, 16, k.startsWith('vix') ? 15 : 0) : Date.parse(t);
    if (!isFinite(ms)) continue;
    out[k] = { last, prev: last - chg, ms };
  }
  return out;
}
// same as update.py pts()/frac()/bars()
function ptsRule(s, v) { // graded for the counted signals, step for the rest (S&P rows)
  if (v == null) return 0;
  if (SCORED.includes(s.id)) return Math.round(frac(s.base, s.full, v) * 1e4) / 1e4;
  return stepRule(s, v);
}
function stepRule(s, v) {
  if (v == null) return 0;
  return s.direction === 'down' ? (v <= s.full ? 1 : v <= s.half ? 0.5 : 0) : (v >= s.full ? 1 : v >= s.half ? 0.5 : 0);
}
function frac(base, full, x) { return full === base ? (x >= full ? 1 : 0) : Math.max(0, Math.min(1, (x - base) / (full - base))); }
function rebar(s) {
  const p0 = s.progress != null ? s.progress : frac(s.base, s.full, s.value);
  const h = s.half_mark != null ? s.half_mark : frac(s.base, s.full, s.half);
  const st = stepOf(s);
  let p = p0; if (st >= 1) p = Math.max(p, 1); else if (st >= 0.5) p = Math.max(p, h);
  s.bar_p = Math.round(Math.max(0, Math.min(1, p)) * 1e4) / 1e4; s.bar_h = Math.round(h * 1e4) / 1e4;
  s.color = st >= 0.5 ? 'green' : (p >= 0.5 ? 'yellow' : 'gray');
}
const newer = (ms, iso) => !iso || ms > Date.parse(iso) + 1000;
const signedPct = (x) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(1) + '%';
function setSig(s, value, display, extra) {
  Object.assign(s, { value, display, status: 'live', live: true }, extra || {});
  setPts(s, value); rebar(s);
}
function setPts(s, v) {
  s.points = ptsRule(s, v);
  if (SCORED.includes(s.id)) s.step = stepRule(s, v); else delete s.step;
}
function applyLive(d, q, cnn) {
  const used = new Set(); let newest = 0;
  const mark = (src, ms) => { used.add(src); newest = Math.max(newest, ms); };
  const sig = (id) => d.signals.find((s) => s.id === id) || (d.spx_signals || []).find((s) => s.id === id);
  const fmtTime = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
  // VIX + VIX/VIX3M (VIX trades in Cboe global hours too; the ratio uses the latest VIX3M, exactly as the server does)
  const v = sig('vix'), r = sig('vix_ratio');
  if (q.vix && v && newer(q.vix.ms, v.as_of)) {
    setSig(v, Math.round(q.vix.last * 100) / 100, q.vix.last.toFixed(1), { as_of: fmtTime(q.vix.ms), source: 'CNBC VIX (חי)' }); setPts(v, q.vix.last); rebar(v); mark('CNBC', q.vix.ms);
    if (q.vix3m && r) {
      const ratio = q.vix.last / q.vix3m.last;
      setSig(r, Math.round(ratio * 1000) / 1000, ratio.toFixed(2), { as_of: fmtTime(Math.min(q.vix.ms, q.vix3m.ms)), note: `VIX3M ${q.vix3m.last.toFixed(1)}`, source: 'CNBC VIX, VIX3M (חי)' });
      setPts(r, ratio); rebar(r);
    }
  }
  // CNN Fear & Greed + put/call score
  if (cnn) {
    const tms = (node) => { const t = node && node.timestamp; const ms = typeof t === 'number' ? (t > 1e11 ? t : t * 1000) : Date.parse(t); return isFinite(ms) ? ms : null; };
    const fg = cnn.fear_and_greed, pc = cnn.put_call_options, f = sig('fng'), p = sig('putcall');
    const fms = tms(fg);
    if (fg && f && fms && isFinite(+fg.score) && newer(fms, f.as_of)) { const x = +fg.score; setSig(f, Math.round(x * 10) / 10, x.toFixed(1), { as_of: fmtTime(fms), source: 'CNN Fear & Greed (חי)' }); setPts(f, x); rebar(f); mark('CNN', fms); }
    const pms = tms(pc) || fms;
    if (pc && p && pms && isFinite(+pc.score) && newer(pms, p.as_of)) { const x = +pc.score; setSig(p, Math.round(x * 10) / 10, x.toFixed(0), { as_of: fmtTime(pms), source: 'CNN Fear & Greed (חי)' }); setPts(p, x); rebar(p); mark('CNN', pms); }
  }
  // S&P 500 rows: same formulas, live price replaces the last daily close (same NY date) or is appended (new date)
  const dd = sig('spx_dd'), m2 = sig('spx_200');
  if (q.spx && dd && dd.live && typeof dd.live === 'object' && newer(q.spx.ms, dd.as_of)) {
    const L = dd.live, px = q.spx.last, same = nyDate(q.spx.ms) === L.last_date;
    let ath = same ? L.ath_ex_last : L.ath_all, athDate = same ? L.ath_ex_last_date : L.ath_all_date;
    if (px >= ath) { ath = px; athDate = nyDate(q.spx.ms); }
    const ddv = (1 - px / ath) * 100, [Y, M, D] = athDate.split('-');
    setSig(dd, Math.round(ddv * 100) / 100, ddv.toFixed(2) + '%', { as_of: fmtTime(q.spx.ms), source: 'CNBC S&P 500 (חי)', note: `שיא ${Math.round(ath).toLocaleString('en-US')} (${+D}.${+M}.${Y})` });
    setPts(dd, ddv); rebar(dd); mark('CNBC', q.spx.ms);
    if (m2 && m2.live && typeof m2.live === 'object') {
      const sma = ((same ? L.sum199_prev : L.sum199_last) + px) / 200, x = (px / sma - 1) * 100;
      setSig(m2, Math.round(-x * 100) / 100, signedPct(x), { as_of: fmtTime(q.spx.ms), source: 'CNBC S&P 500 (חי)', note: `ממוצע 200 יום: ${Math.round(sma).toLocaleString('en-US')}` });
      setPts(m2, -x); rebar(m2);
    }
  }
  // yields + info rows (display formats as in update.py)
  const FMT = { y10: (x) => x.toFixed(2) + '%', y30: (x) => x.toFixed(2) + '%', brent: (x) => '$' + x.toFixed(2), dxy: (x) => x.toFixed(2),
    ndx: (x) => Math.round(x).toLocaleString('en-US'), qqq: (x) => '$' + x.toFixed(2) };
  for (const row of (d.yields || []).concat(d.info || [])) {
    const lq = q[row.id]; if (!lq || !FMT[row.id] || !newer(lq.ms, row.as_of)) continue;
    Object.assign(row, { value: Math.round(lq.last * 1000) / 1000, display: FMT[row.id](lq.last), change: Math.round((lq.last / lq.prev - 1) * 1e4) / 100,
      as_of: fmtTime(lq.ms), status: 'live', live: true });
    mark('CNBC', lq.ms);
  }
  if (used.size) d.live_info = { sources: [...used], newest };
  return d;
}
// quarterly table: ytd / current quarter / current month = stored base close -> live CNBC price (same formula as update.py)
function applyQLive(qd, q) {
  if (!qd || !qd.live || !Array.isArray(qd.rows)) return false;
  const pct = (a, b) => Math.round((b / a - 1) * 1e6) / 1e4;
  let any = false;
  for (const r of qd.rows) {
    const lq = q[r.cnbc]; if (!lq || !r.bases || !newer(lq.ms, r.live_as_of)) continue;
    if (nyDate(lq.ms).slice(0, 7) !== qd.base_key) continue; // new month: wait for the server to refresh the base closes
    r.ytd = pct(r.bases.ytd[1], lq.last); r.q[qd.quarter - 1] = pct(r.bases.q[1], lq.last); r.month = pct(r.bases.m[1], lq.last);
    r.live_as_of = new Date(lq.ms).toISOString(); any = true;
    if (!qd.live_as_of || lq.ms > Date.parse(qd.live_as_of)) qd.live_as_of = r.live_as_of;
  }
  return any;
}
async function fetchLive() {
  const [q, cnn] = await Promise.all([fetchTO(CNBC_URL, 8000).then(parseCNBC).catch(() => ({})), fetchTO(CNN_URL, 8000).catch(() => null)]);
  return { q, cnn };
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
    const [d, cfg, hist, stats, qd] = await Promise.all([getJSON('data/latest.json'), getJSON('config.json').catch(() => ({})), getJSON('data/history.json').catch(() => []), getJSON('data/indicator_stats.json').catch(() => null), getJSON('data/quarterly.json').catch(() => null)]);
    render(d, cfg || {}, hist, stats);
    try { renderQuarterly(qd); } catch (e) { console.error(e); }
    // then overlay the freshest live values and recompute (silent fallback to the file values)
    try {
      const lv = await fetchLive();
      applyLive(d, lv.q, lv.cnn);
      if (d.live_info) render(d, cfg || {}, hist, stats);
      try { if (applyQLive(qd, lv.q)) renderQuarterly(qd); } catch (e) { console.error(e); }
    } catch (e) { console.error(e); }
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

// ---------------------------------------------------------------- private visit counter (admin only)
// Counts every public open. The line is shown only after unlocking with ?admin=<token>
// (token itself is not stored; only its SHA-256 hash is in this file). After unlock,
// a localStorage flag keeps the line visible on the normal URL and the home-screen icon.
// Admin-mode opens are not counted, so Marina does not inflate the numbers.
const VISIT_HASH = '6373e6b4be26e5f5e8214a21db68848ce3abbf32527ff2ff7748af855605b843';
const VISIT_NS = 'mbrbs-f662a323';
// Abacus (abacus.jasoncameron.dev) proved unreliable (timeouts / 500s), so we use CountAPI-compatible host.
const VISIT_API = 'https://countapi.mileshilliard.com/api/v1';
const LS_ADMIN = 'bsAdmin';
const LS_DEVDAY = 'bsDevDay';

async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function israelYMD(ms) {
  const p = parts(new Date(ms), { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}
function last7IsraelDates() {
  const out = []; let t = Date.now(); let last = null;
  while (out.length < 7 && t > Date.now() - 20 * 864e5) {
    const ymd = israelYMD(t);
    if (ymd !== last) { out.push(ymd); last = ymd; }
    t -= 3600e3;
  }
  return out;
}
async function counterCall(kind, key, tries = 2) {
  const url = `${VISIT_API}/${kind}/${VISIT_NS}-${encodeURIComponent(key)}`;
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 8000);
    try {
      const r = await fetch(url, { cache: 'no-store', referrerPolicy: 'no-referrer', signal: c.signal });
      if (r.status === 404) return 0;
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      return Number(j && j.value) || 0;
    } catch (e) { lastErr = e; } finally { clearTimeout(t); }
  }
  throw lastErr;
}
const abacusGet = (key) => counterCall('get', key);
const abacusHit = (key) => counterCall('hit', key, 1);

async function unlockAdmin() {
  try {
    const u = new URL(location.href);
    const tok = u.searchParams.get('admin');
    if (tok && await sha256hex(tok) === VISIT_HASH) {
      localStorage.setItem(LS_ADMIN, '1');
      u.searchParams.delete('admin');
      const q = u.searchParams.toString();
      history.replaceState({}, '', u.pathname + (q ? '?' + q : '') + u.hash);
    }
  } catch (e) { /* ignore */ }
  try { return localStorage.getItem(LS_ADMIN) === '1'; } catch (e) { return false; }
}

async function recordPublicVisit(today) {
  const opens = await abacusHit('o-' + today);
  let already = false;
  try { already = localStorage.getItem(LS_DEVDAY) === today; } catch (e) {}
  let devices;
  if (!already) {
    devices = await abacusHit('d-' + today);
    try { localStorage.setItem(LS_DEVDAY, today); } catch (e) {}
  } else {
    devices = await abacusGet('d-' + today);
  }
  return { opens, devices };
}

function showVisits(opens, devices, week) {
  const el = $('visits');
  if (!el) return;
  el.hidden = false;
  el.textContent = `👁 סופר כניסות — היום: ${opens} כניסות · ${devices} מכשירים · 7 ימים: ${week}`;
}
function showVisitsMsg(msg) {
  const el = $('visits');
  if (!el) return;
  el.hidden = false;
  el.textContent = msg;
}

async function loadAdminVisits() {
  showVisitsMsg('👁 סופר כניסות: טוען…');
  try {
    const days = last7IsraelDates();
    const today = days[0];
    const [opens, devices] = await Promise.all([abacusGet('o-' + today), abacusGet('d-' + today)]);
    const rest = await Promise.all(days.slice(1).map((d) => abacusGet('o-' + d).catch(() => 0)));
    const week = [opens, ...rest].reduce((a, b) => a + (Number(b) || 0), 0);
    showVisits(opens, devices, week);
  } catch (e) {
    showVisitsMsg('👁 סופר כניסות לא זמין כרגע (לחצי ↻ לנסות שוב)');
  }
}

// Home-screen apps on iPhone keep separate storage from Safari, so the ?admin link opened in
// Safari does not unlock the installed app. Hidden fallback: tap the title 5 times quickly and paste the code.
(function adminTapUnlock() {
  const h = document.querySelector('.hdr h1');
  if (!h) return;
  let n = 0, t0 = 0;
  h.addEventListener('click', async () => {
    const now = Date.now();
    if (now - t0 > 3000) { n = 0; t0 = now; }
    if (++n < 5) return;
    n = 0;
    const tok = (prompt('קוד ניהול:') || '').trim().replace(/^.*[?&]admin=/, '');
    if (tok && await sha256hex(tok) === VISIT_HASH) {
      try { localStorage.setItem(LS_ADMIN, '1'); } catch (e) {}
      loadAdminVisits();
    }
  });
})();

(function initVisits() {
  Promise.resolve().then(async () => {
    const admin = await unlockAdmin();
    if (admin) {
      await loadAdminVisits();
      const rb = $('refresh');
      if (rb) rb.addEventListener('click', () => loadAdminVisits());
      return;
    }
    await recordPublicVisit(last7IsraelDates()[0]);
  }).catch(() => {});
})();

load();
