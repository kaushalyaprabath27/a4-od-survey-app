/* =====================================================================
   A4 survey admin dashboard: live progress of the roadside O-D survey
   against the sampling targets, bus counts, and the answers analysed.

   The password is checked by each Apps Script backend (Script property
   ADMIN_PASSWORD); nothing secret is stored in this file. The same page is
   in both apps (a4-od-survey-app and a4-bus-survey-app).
   ===================================================================== */

const SURVEYS = [
    { id: 'od', label: 'Vehicle O-D', icon: 'fa-car-side', url: 'https://script.google.com/macros/s/AKfycby-59ey8nmTd0EuS5ASO_VhR3tZuOAP5AeMsvjKf6TBpP-6GBd5gO5XTnk1oP8WcgmG/exec' },
    { id: 'bus', label: 'Bus survey', icon: 'fa-bus', url: 'https://script.google.com/macros/s/AKfycbxwvFHRKiUrdsHqi1wcGSWProQOpt5HlxhCbHFL9EZeb44alcswaAxnSxPap1kG_740/exec' }
];
const REFRESH_MS = 120000;
const PW_KEY = 'a4admin_pw';      // sessionStorage: kept only until the browser tab is closed
const VIEW_KEY = 'a4admin_view';  // localStorage: last tab / station / date
const OCCUPANCY = ['Empty', 'Less than 10', '10 – 20', '20 – 30', '30 – 40', '40 – 50', '50 – 60', '60 – 80', 'More than 80'];

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Math.round(n).toLocaleString('en-US');
const pct = (a, b) => b > 0 ? Math.round(100 * a / b) : 0;
function store(kind, key, value) {
    try { value === undefined ? kind.removeItem(key) : kind.setItem(key, value); } catch (e) { /* private mode */ }
}
function load(kind, key) { try { return kind.getItem(key); } catch (e) { return null; } }

const state = Object.assign({ survey: 'od', station: 'all', date: 'all' }, JSON.parse(load(localStorage, VIEW_KEY) || '{}'));
let password = load(sessionStorage, PW_KEY) || '';
const data = {};    // survey id -> stats from the backend
const errors = {};  // survey id -> message
let editing = false;
let timer = null;

// ---------------------------------------------------------------------
// Backend calls
// ---------------------------------------------------------------------
async function call(survey, body) {
    const res = await fetch(survey.url, { method: 'POST', body: JSON.stringify(Object.assign({ password }, body)), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
}
// "Towards Avissawella" is now "Towards Rathnapura": rename it in what the backend sends
// (older script versions, and interviews saved before the change) so both count as one.
const renameDir = v => String(v).replace(/^Towards Avissawella/i, 'Towards Rathnapura');
const cleanStation = v => { const m = /^o?d\s*[-_.]?\s*0*(\d+)$/i.exec(String(v || '').trim()); return m ? `OD ${m[1]}` : String(v || '').trim(); };
function renameDirections(r) {
    if (Array.isArray(r.directions)) r.directions = [...new Set(r.directions.map(renameDir))];
    if (Array.isArray(r.recorders)) r.recorders.forEach(x => { x.station = cleanStation(x.station); });
    if (Array.isArray(r.counts)) r.counts.forEach(c => {
        c[0] = cleanStation(c[0]);
        if (c[2] === 'direction') c[3] = renameDir(c[3]);
        else if (c[2] === 'classDir' || c[2] === 'recDir' || c[2] === 'typeDir') c[3] = String(c[3]).replace(/\|Towards Avissawella$/i, '|Towards Rathnapura');
    });
    return r;
}

async function fetchSurvey(survey, body) {
    try {
        const r = await call(survey, body || { action: 'admin_stats' });
        if (r.status === 'success') { data[survey.id] = survey.id === 'od' ? renameDirections(r) : r; delete errors[survey.id]; return true; }
        errors[survey.id] = r.message || 'Error';
        if (r.auth === false) return false;
    } catch (e) {
        errors[survey.id] = e.message === 'Failed to fetch' ? 'No connection to the backend.' : e.message;
    }
    return null;
}
async function refreshAll() {
    $('refresh').disabled = true;
    await Promise.all(SURVEYS.map(s => fetchSurvey(s)));
    $('refresh').disabled = false;
    render();
}

// ---------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------
$('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    password = $('pw').value;
    $('login-btn').disabled = true;
    $('login-msg').textContent = '';
    const results = await Promise.all(SURVEYS.map(s => fetchSurvey(s)));
    $('login-btn').disabled = false;
    if (results.some(r => r === true)) { store(sessionStorage, PW_KEY, password); showDash(); return; }
    $('login-msg').textContent = errors.od || errors.bus || 'Could not log in.';
});
$('logout').addEventListener('click', () => {
    password = '';
    store(sessionStorage, PW_KEY);
    clearInterval(timer);
    Object.keys(data).forEach(k => delete data[k]);
    $('dash').classList.add('hidden');
    $('login').classList.remove('hidden');
    $('pw').value = '';
});
$('refresh').addEventListener('click', refreshAll);
$('view').addEventListener('click', e => {
    const b = e.target.closest('.enum-btn');
    if (!b) return;
    const name = b.dataset.enum;
    openEnums.has(name) ? openEnums.delete(name) : openEnums.add(name);
    render();
});

function showDash() {
    $('login').classList.add('hidden');
    $('dash').classList.remove('hidden');
    render();
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden && !editing) refreshAll(); }, REFRESH_MS);
}

// ---------------------------------------------------------------------
// Counting helpers: rows are [station, date, what, value, n]
// ---------------------------------------------------------------------
function rowsFor(d, what) {
    return (d.counts || []).filter(r => r[2] === what && (state.station === 'all' || r[0] === state.station) && (state.date === 'all' || r[1] === state.date));
}
function tally(d, what) {
    const m = new Map();
    rowsFor(d, what).forEach(r => m.set(r[3], (m.get(r[3]) || 0) + r[4]));
    return m;
}
function sortedDesc(m) { return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))); }

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------
function render() {
    const tabs = $('tabs');
    tabs.innerHTML = '';
    SURVEYS.forEach(s => {
        const b = document.createElement('button');
        b.className = 'tab';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(state.survey === s.id));
        const total = data[s.id] ? ` (${fmt(data[s.id].total)})` : '';
        b.innerHTML = `<i class="fa-solid ${s.icon}"></i> ${esc(s.label)}${total}`;
        b.addEventListener('click', () => { state.survey = s.id; editing = false; saveView(); render(); });
        tabs.appendChild(b);
    });
    const d = data[state.survey];
    renderFilters(d);
    $('updated').textContent = d ? `Updated ${d.generated.slice(11, 16)}` : '';
    const view = $('view');
    if (!d) {
        view.innerHTML = `<section class="card wide error-card"><h2><i class="fa-solid fa-triangle-exclamation"></i> ${esc(errors[state.survey] || 'Loading…')}</h2></section>`;
        return;
    }
    view.innerHTML = (errors[state.survey] ? `<section class="card wide error-card">Showing the last data: ${esc(errors[state.survey])}</section>` : '') +
        (state.survey === 'od' ? odView(d) : busView(d));
    if (state.survey === 'od') wireTargets(d);
}

function renderFilters(d) {
    const stations = d ? [...new Set((d.stations || []).concat((d.counts || []).map(r => r[0])))].sort() : [];
    const dates = d ? [...new Set((d.counts || []).map(r => r[1]))].sort().reverse() : [];
    if (state.station !== 'all' && !stations.includes(state.station)) state.station = 'all';
    if (state.date !== 'all' && !dates.includes(state.date)) state.date = 'all';
    $('f-station').innerHTML = `<option value="all">All stations</option>` + stations.map(s => `<option${s === state.station ? ' selected' : ''}>${esc(s)}</option>`).join('');
    $('f-date').innerHTML = `<option value="all">All dates</option>` + dates.map(s => `<option${s === state.date ? ' selected' : ''}>${esc(s)}</option>`).join('');
}
$('f-station').addEventListener('change', e => { state.station = e.target.value; editing = false; saveView(); render(); });
$('f-date').addEventListener('change', e => { state.date = e.target.value; saveView(); render(); });
function saveView() { store(localStorage, VIEW_KEY, JSON.stringify({ survey: state.survey, station: state.station, date: state.date })); }

function kpi(label, value, sub) {
    return `<div class="kpi"><div class="k-label">${esc(label)}</div><div class="k-value">${value}</div><div class="k-sub">${sub || '&nbsp;'}</div></div>`;
}
function progress(done, target) {
    if (!(target > 0)) return '<span class="muted">no target</span>';
    const p = pct(done, target);
    return `<div class="prog" title="${fmt(done)} of ${fmt(target)}"><div class="track"><div class="fill${p >= 100 ? ' done' : ''}" style="width:${Math.min(p, 100)}%"></div></div><span class="pct ${p >= 100 ? 'met' : ''}">${p >= 100 ? '✓ ' : ''}${p}%</span></div>`;
}
function bars(title, m, opts = {}) {
    let rows = opts.order ? opts.order.filter(k => m.has(k)).map(k => [k, m.get(k)]).concat(sortedDesc(m).filter(([k]) => !opts.order.includes(k))) : sortedDesc(m);
    const total = rows.reduce((s, r) => s + r[1], 0);
    const more = opts.top && rows.length > opts.top ? rows.length - opts.top : 0;
    if (more) rows = rows.slice(0, opts.top);
    const max = Math.max(1, ...rows.map(r => r[1]));
    const body = rows.length ? rows.map(([k, n]) =>
        `<div class="bar-row" title="${esc(k)}: ${fmt(n)} (${pct(n, total)}%)"><span class="b-label">${esc(k)}</span><div class="track"><div class="fill" style="width:${100 * n / max}%"></div></div><span class="b-val"><b>${fmt(n)}</b> · ${pct(n, total)}%</span></div>`).join('')
        : '<p class="empty">No answers yet.</p>';
    return `<section class="card"><h2>${esc(title)}</h2><div class="bars">${body}</div>${more ? `<p class="muted small card-note">+ ${more} more</p>` : ''}</section>`;
}
function recordersCard(d, noun) {
    const n = tally(d, 'recorder');
    const latest = new Map((d.recorders || []).map(r => [r.name, r]));
    const rows = sortedDesc(n).map(([name, c]) => {
        const r = latest.get(name) || {};
        return `<tr><td>${esc(name)}</td><td>${esc(r.station || '')}</td><td class="num">${fmt(c)}</td><td>${esc(r.last || '')}</td></tr>`;
    }).join('');
    return `<section class="card"><h2><i class="fa-solid fa-user"></i> Recorders</h2><div class="table-wrap"><table><tr><th>Recorder</th><th>Station (last)</th><th class="num">${esc(noun)}</th><th>Last record</th></tr>${rows || '<tr><td colspan="4" class="empty">Nothing recorded yet.</td></tr>'}</table></div></section>`;
}

// ---------------------------------------------------------------------
// Vehicle O-D: progress against targets (as in the sampling plan) + answers
// ---------------------------------------------------------------------
// Vehicle types as the enumerators record them in the app (shown under their class even before any interview).
const APP_TYPES = [
    'Motorcycle', '3-wheeler', 'Taxi', 'Car / Jeep', 'Passenger van', 'Office van', 'School van', 'Minibus', 'Large bus',
    'Delivery van', 'Light truck (2 axles / 4 wheels)', 'Medium truck (2 axles / 6 wheels)', 'Large truck (2 axles / 6 wheels)',
    'Heavy vehicle (3 axles / 10 wheels)', 'Container with trailer', 'Other'
];

// Daily target for ONE enumerator, per vehicle line of the sampling plan (OD 5: 18 enumerators).
// Each line lists the app vehicle types (and older names) counted in it.
const ENUM_LINES = [
    ['Motor Cycles', ['Motorcycle']],
    ['Three Wheeler', ['3-wheeler']],
    ['Car/Jeep/SUV/Double Cab', ['Taxi', 'Car / Jeep']],
    ['Van', ['Passenger van', 'Office van', 'School van']],
    ['Medium Bus', ['Minibus']],
    ['Large bus', ['Large bus']],
    ['Light Truck (2 axles / 4 wheels)', ['Light truck (2 axles / 4 wheels)', 'Delivery van', 'Small lorry']],
    ['Medium Truck (2 axles / 6 wheels)', ['Medium truck (2 axles / 6 wheels)', 'Medium truck (2 axle)', 'Truck (2 axle)']],
    ['Large Truck (2 axles / 6 wheels)', ['Large truck (2 axles / 6 wheels)', 'Heavy truck (2 axle)']],
    ['Heavy Vehicle (3 axles / 10 wheels)', ['Heavy vehicle (3 axles / 10 wheels)']],
    ['Container with trailer (20 ft + 40 ft)', ['Container with trailer', 'Container (20 ft / 3 axle)', 'Multi-axle container (40 ft)']],
    ['Other freight', ['Other']]
];
const ENUM_TARGETS = {
    'OD 5': { enumerators: 18, byLine: {
        'Motor Cycles': 50, 'Three Wheeler': 23, 'Car/Jeep/SUV/Double Cab': 25, 'Van': 7, 'Medium Bus': 2,
        'Light Truck (2 axles / 4 wheels)': 8, 'Medium Truck (2 axles / 6 wheels)': 7, 'Large Truck (2 axles / 6 wheels)': 9,
        'Heavy Vehicle (3 axles / 10 wheels)': 2, 'Container with trailer (20 ft + 40 ft)': 2 } }
};
const openEnums = new Set(); // enumerators whose vehicle counts are open

// One enumerator's count of each vehicle type at each station, against the per-enumerator target.
function enumDetail(d, name) {
    const mine = (d.counts || []).filter(r => r[2] === 'recType' && r[3].startsWith(name + '|') &&
        (state.station === 'all' || r[0] === state.station) && (state.date === 'all' || r[1] === state.date));
    if (!(d.version >= 4)) return '<p class="muted small">Update the Apps Script to see each enumerator\'s vehicle types.</p>';
    const stations = [...new Set(mine.map(r => r[0]))].sort();
    if (!stations.length) return '<p class="muted small">No interviews for the station and date picked.</p>';
    return stations.map(st => {
        const n = new Map();
        mine.filter(r => r[0] === st).forEach(r => { const ty = r[3].slice(name.length + 1); n.set(ty, (n.get(ty) || 0) + r[4]); });
        const days = state.date === 'all'
            ? new Set((d.counts || []).filter(r => r[2] === 'recorder' && r[3] === name && r[0] === st).map(r => r[1])).size || 1 : 1;
        const plan = ENUM_TARGETS[st];
        const lines = ENUM_LINES.concat([...n.keys()].filter(ty => !ENUM_LINES.some(l => l[1].includes(ty))).map(ty => [ty, [ty]]));
        let rows = '', tTot = 0, cTot = 0, cTarg = 0;
        lines.forEach(([line, types]) => {
            const got = types.reduce((s, ty) => s + (n.get(ty) || 0), 0);
            const target = plan && plan.byLine[line] ? plan.byLine[line] * days : 0;
            if (!got && !target) return;
            tTot += target; cTot += got; cTarg += target ? Math.min(got, target) : 0;
            rows += `<tr class="cls"><td>${esc(line)}</td><td class="num">${target ? fmt(target) : '–'}</td><td class="num">${fmt(got)}</td>` +
                `<td class="num ${target && got >= target ? 'met' : ''}">${target ? pct(got, target) + '%' : '–'}</td><td class="bar">${target ? progress(Math.min(got, target), target) : ''}</td></tr>`;
            // The recorded types under the line, unless it is just the line's own type again.
            const seen = types.filter(ty => n.get(ty));
            if (seen.length > 1 || (seen.length === 1 && seen[0] !== types[0])) seen.forEach(ty => {
                rows += `<tr class="sub"><td>${esc(ty)}</td><td></td><td class="num">${fmt(n.get(ty))}</td><td></td><td class="bar"></td></tr>`;
            });
        });
        rows += `<tr class="grand"><td>All vehicles</td><td class="num">${tTot ? fmt(tTot) : '–'}</td><td class="num">${fmt(cTot)}</td><td class="num ${tTot && cTarg >= tTot ? 'met' : ''}">${tTot ? pct(cTarg, tTot) + '%' : '–'}</td><td class="bar">${tTot ? progress(cTarg, tTot) : ''}</td></tr>`;
        const note = plan
            ? `Target for one enumerator (${plan.enumerators} enumerators at ${esc(st)})${days > 1 ? ` × ${days} days worked` : ' per day'}. Progress counts each line up to its target.`
            : `No per-enumerator target set for ${esc(st)}.`;
        return `<div class="enum-detail"><h3>${esc(name)} · ${esc(st)}${state.date !== 'all' ? ' · ' + esc(state.date) : ''}</h3>
            <div class="table-wrap"><table><tr><th>Type of vehicle</th><th class="num">Target</th><th class="num">Surveyed</th><th class="num">%</th><th class="bar">Progress</th></tr>${rows}</table></div>
            <p class="muted small">${note}</p></div>`;
    }).join('');
}

function odTargets(d) {
    // Sum of the targets of the selected station(s): per class, per group, and per hour per group.
    const sts = state.station === 'all' ? Object.keys(d.targets || {}) : [state.station];
    const byClass = {}, group = {}, perHour = {};
    sts.forEach(st => {
        const t = (d.targets || {})[st];
        if (!t) return;
        d.classes.forEach(c => {
            const v = t.byClass[c.name];
            if (!(v > 0)) return;
            byClass[c.name] = (byClass[c.name] || 0) + v;
            group[c.group] = (group[c.group] || 0) + v;
            perHour[c.group] = (perHour[c.group] || 0) + v / (t.hours || 12);
        });
    });
    return { byClass, group, perHour };
}

function odView(d) {
    const done = tally(d, 'class');
    const t = odTargets(d);
    const hours = tally(d, 'hour'); // "07|Passenger" -> n
    const hourList = [...new Set([...hours.keys()].map(k => k.split('|')[0]))].sort();
    const totalDone = [...done.values()].reduce((s, n) => s + n, 0);
    const totalTarget = Object.values(t.group).reduce((s, n) => s + n, 0);
    const station = state.station === 'all' ? 'all stations' : state.station;
    const singleStation = state.station !== 'all';
    const tg = singleStation ? (d.targets[state.station] || { hours: 12, byClass: {} }) : null;

    // Half of each target towards Colombo, half towards Rathnapura.
    const DIRS = d.directions || ['Towards Colombo', 'Towards Rathnapura'];
    const hasDir = d.version >= 2;
    const byDir = tally(d, 'classDir'); // "class|direction" -> n
    const byType = tally(d, 'type');       // recorded vehicle type -> n
    const hasTypeDir = d.version >= 3;
    const byTypeDir = tally(d, 'typeDir'); // "type|direction" -> n
    const dirDone = (cls, i) => byDir.get(`${cls}|${DIRS[i]}`) || 0;
    const half = (target, i) => i === 0 ? Math.ceil(target / 2) : Math.floor(target / 2);
    // Still needed: each direction up to its half (more in one direction does not make up for the other).
    const remainingOf = (cls, target) => !target ? 0 : hasDir
        ? DIRS.reduce((s, dir, i) => s + Math.max(0, half(target, i) - dirDone(cls, i)), 0)
        : Math.max(0, target - (done.get(cls) || 0));
    const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
    const targeted = d.classes.filter(c => (t.byClass[c.name] || 0) > 0);
    const totalRemaining = sum(targeted, c => remainingOf(c.name, t.byClass[c.name]));
    const dirTotals = DIRS.map((dir, i) => ({
        dir,
        done: sum([...byDir.entries()].filter(([k]) => k.endsWith('|' + dir)), e => e[1]),
        need: sum(targeted, c => half(t.byClass[c.name], i)),
        counted: sum(targeted, c => Math.min(dirDone(c.name, i), half(t.byClass[c.name], i)))
    }));

    let html = `<div class="kpis">` +
        kpi('Interviews', fmt(totalDone), `${esc(station)}${state.date !== 'all' ? ' · ' + esc(state.date) : ''}`) +
        kpi('Target', totalTarget ? fmt(totalTarget) : '–', totalTarget ? 'half each direction' : 'set targets for this station') +
        (hasDir ? dirTotals.map(x => kpi(x.dir, `${fmt(x.done)}<span class="k-of"> / ${x.need ? fmt(x.need) : '–'}</span>`, x.need ? `${pct(x.counted, x.need)}% of its half · ${fmt(Math.max(0, x.need - x.counted))} still needed` : '')).join('') : '') +
        kpi('Target reached', totalTarget ? pct(totalTarget - totalRemaining, totalTarget) + '%' : '–', 'each class and direction up to its target') +
        kpi('Still needed', totalTarget ? fmt(totalRemaining) : '–', '') + `</div>`;

    // Progress table: total, then each direction as surveyed / needed
    const dirCell = (n, need) => need
        ? `<td class="num ${n >= need ? 'met' : ''}">${n >= need ? '✓ ' : ''}${fmt(n)} <span class="muted small">/ ${fmt(need)}</span></td>`
        : `<td class="num">${fmt(n)}</td>`;
    const dirCells = (list, target) => hasDir
        ? DIRS.map((dir, i) => dirCell(sum(list, c => dirDone(c.name, i)), sum(list, c => half(target(c), i)))).join('')
        : '';
    // Each vehicle type recorded in the app, under the class it counts in.
    const typeRows = c => c.types
        .filter(ty => APP_TYPES.includes(ty) || (byType.get(ty) || 0) > 0)
        .map(ty => {
            const n = byType.get(ty) || 0;
            const old = APP_TYPES.includes(ty) ? '' : ' <span class="muted small">(earlier form)</span>';
            const dcells = hasDir ? DIRS.map(dir => `<td class="num">${hasTypeDir ? fmt(byTypeDir.get(`${ty}|${dir}`) || 0) : '<span class="muted">·</span>'}</td>`).join('') : '';
            return `<tr class="sub"><td>${esc(ty)}${old}</td><td></td><td class="num">${fmt(n)}</td>${dcells}<td></td><td></td></tr>`;
        }).join('');
    const groups = ['Passenger', 'Freight'];
    let rows = '';
    groups.forEach(g => {
        const cls = d.classes.filter(c => c.group === g);
        cls.forEach(c => {
            const n = done.get(c.name) || 0, target = t.byClass[c.name] || 0;
            const tcell = editing ? `<input type="number" min="0" step="1" data-class="${esc(c.name)}" value="${tg && tg.byClass[c.name] !== undefined ? tg.byClass[c.name] : ''}" aria-label="Target ${esc(c.name)}">` : (target ? fmt(target) : '–');
            const rem = remainingOf(c.name, target);
            rows += `<tr class="cls"><td>${esc(c.name)}</td><td class="num">${tcell}</td><td class="num">${fmt(n)}</td>${dirCells([c], x => t.byClass[x.name] || 0)}<td class="num">${target ? fmt(rem) : '–'}</td><td>${progress(target - rem, target)}</td></tr>`;
            rows += typeRows(c);
        });
        const gDone = sum(cls, c => done.get(c.name) || 0);
        const gT = t.group[g] || 0;
        const gRem = sum(cls, c => remainingOf(c.name, t.byClass[c.name] || 0));
        const ph = t.perHour[g] || 0;
        rows += `<tr class="group"><td>${g} total${ph ? ` <span class="muted small">· ${fmt(ph)} per hour</span>` : ''}</td><td class="num">${gT ? fmt(gT) : '–'}</td><td class="num">${fmt(gDone)}</td>${dirCells(cls, x => t.byClass[x.name] || 0)}<td class="num">${gT ? fmt(gRem) : '–'}</td><td>${progress(gT - gRem, gT)}</td></tr>`;
    });
    const others = sortedDesc(done).filter(([k]) => !d.classes.some(c => c.name === k));
    others.forEach(([k, n]) => {
        const o = [{ name: k }];
        rows += `<tr><td>${esc(k)}</td><td class="num">–</td><td class="num">${fmt(n)}</td>${dirCells(o, () => 0)}<td class="num">–</td><td></td></tr>`;
    });
    const all = d.classes.concat(others.map(([k]) => ({ name: k })));
    rows += `<tr class="grand"><td>All vehicles</td><td class="num">${totalTarget ? fmt(totalTarget) : '–'}</td><td class="num">${fmt(totalDone)}</td>${dirCells(all, x => t.byClass[x.name] || 0)}<td class="num">${totalTarget ? fmt(totalRemaining) : '–'}</td><td>${progress(totalTarget - totalRemaining, totalTarget)}</td></tr>`;
    const editBtn = singleStation
        ? (editing
            ? `<label class="small">Survey hours <input type="number" min="1" max="24" step="0.5" id="t-hours" value="${tg.hours}"></label><button class="btn" id="t-save"><i class="fa-solid fa-floppy-disk"></i> Save targets</button><button class="btn-ghost" id="t-cancel">Cancel</button>`
            : `<button class="btn-ghost" id="t-edit"><i class="fa-solid fa-pen"></i> Edit targets</button>`)
        : '<span class="muted small">Pick one station to edit its targets</span>';
    const mapping = d.classes.map(c => `<li><b>${esc(c.name)}</b>: ${c.types.map(esc).join(', ')}</li>`).join('');
    const dirHead = hasDir ? DIRS.map(x => `<th class="num">${esc(x)}<br><span class="small">surveyed / needed</span></th>`).join('') : '';
    html += `<section class="card wide"><h2><i class="fa-solid fa-bullseye"></i> Progress: ${esc(station)}<span class="spacer"></span>${editBtn}</h2>
        <div class="table-wrap"><table><tr><th>Type of vehicle</th><th class="num">Total to be surveyed</th><th class="num">Surveyed</th>${dirHead}<th class="num">Still needed</th><th>Progress</th></tr>${rows}</table></div>
        <p class="muted small card-note">${hasDir ? 'Half of each target is needed towards Colombo and half towards Rathnapura; extra interviews in one direction do not count for the other.' : 'Update the Apps Script to see the counts by direction.'} The indented rows are the vehicle types as recorded in the app${hasDir && !hasTypeDir ? ' (update the Apps Script to see each type by direction)' : ''}.</p>
        <details class="map card-note"><summary class="small">Which app vehicle types count in each class</summary><ul class="small">${mapping}</ul></details></section>`;

    // Per hour
    const hourRows = hourList.map(h => {
        const cells = groups.map(g => {
            const n = hours.get(`${h}|${g}`) || 0, need = t.perHour[g] || 0;
            const cls = need && state.date !== 'all' ? (n >= need ? 'met' : 'below') : '';
            return `<td class="num ${cls}">${fmt(n)}${need && state.date !== 'all' ? ` <span class="muted small">/ ${fmt(need)}</span>` : ''}</td>`;
        }).join('');
        const tot = groups.reduce((s, g) => s + (hours.get(`${h}|${g}`) || 0), 0) + (hours.get(`${h}|Other`) || 0);
        return `<tr><td>${esc(h)}:00</td>${cells}<td class="num">${fmt(tot)}</td></tr>`;
    }).join('');
    html += `<section class="card"><h2><i class="fa-solid fa-clock"></i> Interviews per hour</h2>
        <div class="table-wrap"><table><tr><th>Hour</th><th class="num">Passenger</th><th class="num">Freight</th><th class="num">Total</th></tr>${hourRows || '<tr><td colspan="4" class="empty">Nothing recorded yet.</td></tr>'}</table></div>
        <p class="muted small card-note">${state.date === 'all' ? 'Pick a date to compare each hour with the per-hour target.' : 'Shown as surveyed / needed per hour.'}</p></section>`;
    html += hasDir ? odEnumerators(d, DIRS) : recordersCard(d, 'Interviews');

    // Answers
    html += bars('Direction', tally(d, 'direction'));
    html += bars('Vehicle type', tally(d, 'type'));
    html += bars('Origin district', tally(d, 'originDistrict'), { top: 12 });
    html += bars('Destination district', tally(d, 'destinationDistrict'), { top: 12 });
    html += bars('Trip purpose', tally(d, 'tripPurpose'));
    html += bars('Trip frequency', tally(d, 'frequency'));
    html += bars('Future use of the Kahathuduwa – Ingiriya Expressway', tally(d, 'expressway'));
    html += bars('Commodity (freight)', tally(d, 'commodity'));
    html += bars('Load condition (freight)', tally(d, 'load'));
    html += bars('Monthly household income (owners)', tally(d, 'income'));
    return html;
}

// Counts of each enumerator: by direction, passenger / freight, and by vehicle class.
function odEnumerators(d, DIRS) {
    const total = tally(d, 'recorder');
    const byDir = tally(d, 'recDir');     // "name|direction" -> n
    const byClass = tally(d, 'recClass'); // "name|class" -> n
    const latest = new Map((d.recorders || []).map(r => [r.name, r]));
    const groupOf = name => (d.classes.find(c => c.name === name) || {}).group || 'Other';
    const names = sortedDesc(total).map(e => e[0]);
    const per = name => {
        const cls = new Map();
        byClass.forEach((n, k) => { if (k.startsWith(name + '|')) cls.set(k.slice(name.length + 1), n); });
        return cls;
    };
    const rows = names.map(name => {
        const cls = per(name), r = latest.get(name) || {};
        const g = grp => [...cls.entries()].filter(([c]) => groupOf(c) === grp).reduce((s, e) => s + e[1], 0);
        const open = openEnums.has(name);
        // The total is the button: tap it to open this enumerator's count of each vehicle type.
        const totalBtn = `<button type="button" class="enum-btn enum-total" data-enum="${esc(name)}" aria-expanded="${open}" title="${open ? 'Close' : 'Open'} ${esc(name)}'s vehicle types">${fmt(total.get(name))} <i class="fa-solid fa-${open ? 'chevron-up' : 'chevron-down'}"></i></button>`;
        const closeBtn = `<button type="button" class="btn-ghost enum-btn enum-close" data-enum="${esc(name)}"><i class="fa-solid fa-xmark"></i> Close</button>`;
        return `<tr${open ? ' class="enum-row-open"' : ''}><td>${esc(name)}</td><td>${esc(r.station || '')}</td><td class="num">${totalBtn}</td>${DIRS.map(dir => `<td class="num">${fmt(byDir.get(`${name}|${dir}`) || 0)}</td>`).join('')}<td class="num">${fmt(g('Passenger'))}</td><td class="num">${fmt(g('Freight'))}</td><td>${esc(r.last || '')}</td></tr>` +
            (open ? `<tr class="enum-open"><td colspan="${DIRS.length + 6}"><div class="enum-wrap"><div class="enum-bar"><b>${esc(name)}: vehicle types</b>${closeBtn}</div>${enumDetail(d, name)}</div></td></tr>` : '');
    }).join('');
    // Enumerator x vehicle class (only classes with interviews)
    const usedClasses = d.classes.map(c => c.name).concat([...new Set([...byClass.keys()].map(k => k.slice(k.indexOf('|') + 1)))].filter(c => !d.classes.some(x => x.name === c)))
        .filter(c => [...byClass.keys()].some(k => k.endsWith('|' + c)));
    const matrix = names.map(name => {
        const cls = per(name);
        return `<tr><td>${esc(name)}</td>${usedClasses.map(c => `<td class="num">${cls.get(c) ? fmt(cls.get(c)) : '<span class="muted">0</span>'}</td>`).join('')}<td class="num"><b>${fmt(total.get(name))}</b></td></tr>`;
    }).join('');
    const empty = '<tr><td colspan="9" class="empty">Nothing recorded yet.</td></tr>';
    return enumeratorTypes(d, names, total) + `<section class="card wide"><h2><i class="fa-solid fa-users"></i> Enumerators (${names.length})</h2>
        <div class="table-wrap"><table><tr><th>Enumerator</th><th>Station (last)</th><th class="num">Total<br><span class="small">tap to open</span></th>${DIRS.map(x => `<th class="num">${esc(x)}</th>`).join('')}<th class="num">Passenger</th><th class="num">Freight</th><th>Last record</th></tr>${rows || empty}</table></div>
        <details class="map card-note"${names.length ? '' : ' hidden'}><summary class="small">Each enumerator by vehicle class</summary>
        <div class="table-wrap"><table><tr><th>Enumerator</th>${usedClasses.map(c => `<th class="num">${esc(c)}</th>`).join('')}<th class="num">Total</th></tr>${matrix}</table></div></details></section>`;
}

// Each enumerator x each vehicle type as recorded in the app (script version 4 and later).
function enumeratorTypes(d, names, total) {
    const head = `<section class="card wide"><h2><i class="fa-solid fa-table-cells"></i> Enumerators by vehicle type</h2>`;
    if (!(d.version >= 4)) {
        return head + '<p class="muted small">Update the Apps Script (Deploy > Manage deployments > New version) to see how many of each vehicle type every enumerator recorded.</p></section>';
    }
    const byType = tally(d, 'recType'); // "name|type" -> n
    const used = new Set([...byType.keys()].map(k => k.slice(k.indexOf('|') + 1)));
    const classOf = ty => d.classes.find(c => c.types.includes(ty));
    // Columns: the app's types in class order, then older type names that have interviews.
    const cols = [];
    ['Passenger', 'Freight'].forEach(g => {
        d.classes.filter(c => c.group === g).forEach(c => c.types.forEach(ty => {
            if (APP_TYPES.includes(ty) || used.has(ty)) cols.push({ ty, group: g, old: !APP_TYPES.includes(ty) });
        }));
    });
    used.forEach(ty => { if (!cols.some(c => c.ty === ty)) cols.push({ ty, group: 'Other', old: !APP_TYPES.includes(ty) }); });
    const label = c => c.old ? c.ty : c.ty.replace(/\s*\(.*\)$/, '');
    const sub = c => c.old ? 'earlier form' : (c.ty.match(/\((.*)\)$/) || [])[1] || '';
    const n = (name, ty) => byType.get(`${name}|${ty}`) || 0;
    const cell = v => `<td class="num">${v ? fmt(v) : '<span class="muted">0</span>'}</td>`;
    const groups = ['Passenger', 'Freight', 'Other'].filter(g => cols.some(c => c.group === g));
    const gsum = (name, g) => cols.filter(c => c.group === g).reduce((s, c) => s + n(name, c.ty), 0);
    const bandTitle = { Passenger: 'Passenger vehicles', Freight: 'Freight vehicles', Other: 'Other' };
    const band = groups.map(g => `<th class="band" colspan="${cols.filter(c => c.group === g).length + (g === 'Other' ? 0 : 1)}">${bandTitle[g]}</th>`).join('');
    const ths = groups.map(g => cols.filter(c => c.group === g).map(c => `<th class="num" title="${esc(c.ty)}">${esc(label(c))}${sub(c) ? `<br><span class="small">${esc(sub(c))}</span>` : ''}</th>`).join('') +
        (g === 'Other' ? '' : `<th class="num gt">${g}<br><span class="small">total</span></th>`)).join('');
    const rowFor = (name, get) => groups.map(g => cols.filter(c => c.group === g).map(c => cell(get(c.ty))).join('') +
        (g === 'Other' ? '' : `<td class="num gt"><b>${fmt(cols.filter(c => c.group === g).reduce((s, c) => s + get(c.ty), 0))}</b></td>`)).join('');
    const rows = names.map(name => `<tr><td>${esc(name)}</td>${rowFor(name, ty => n(name, ty))}<td class="num"><b>${fmt(total.get(name) || 0)}</b></td></tr>`).join('');
    const colTotal = ty => names.reduce((s, name) => s + n(name, ty), 0);
    const totalRow = names.length ? `<tr class="grand"><td>All enumerators</td>${rowFor('', colTotal)}<td class="num"><b>${fmt(names.reduce((s, name) => s + (total.get(name) || 0), 0))}</b></td></tr>` : '';
    const span = cols.length + groups.filter(g => g !== 'Other').length + 2;
    return head + `<div class="table-wrap"><table class="enum-types"><tr><th></th>${band}<th></th></tr><tr><th>Enumerator</th>${ths}<th class="num">Total</th></tr>${rows || `<tr><td colspan="${span}" class="empty">Nothing recorded yet.</td></tr>`}${totalRow}</table></div>
        <p class="muted small card-note">For the station and date picked above. Scroll sideways for the freight types.</p></section>`;
}

function wireTargets(d) {
    const edit = $('t-edit'), save = $('t-save'), cancel = $('t-cancel');
    if (edit) edit.addEventListener('click', () => { editing = true; render(); });
    if (cancel) cancel.addEventListener('click', () => { editing = false; render(); });
    if (save) save.addEventListener('click', async () => {
        const byClass = {};
        document.querySelectorAll('input[data-class]').forEach(i => { byClass[i.dataset.class] = i.value === '' ? '' : Math.max(0, Math.round(+i.value)); });
        save.disabled = true;
        const ok = await fetchSurvey(SURVEYS[0], { action: 'admin_set_targets', targets: { [state.station]: { hours: +$('t-hours').value, byClass } } });
        save.disabled = false;
        if (ok) editing = false;
        else alert(errors.od || 'Could not save the targets.');
        render();
    });
}

// ---------------------------------------------------------------------
// Bus survey: counts by direction, hour and route
// ---------------------------------------------------------------------
function busView(d) {
    const dir = tally(d, 'direction');
    const total = [...dir.values()].reduce((s, n) => s + n, 0);
    const routes = tally(d, 'route'); // "122 · Colombo – Avissawella|To Colombo" -> n
    const byRoute = new Map();
    routes.forEach((n, k) => {
        const i = k.lastIndexOf('|');
        const r = k.slice(0, i), dr = k.slice(i + 1);
        const o = byRoute.get(r) || { to: 0, from: 0, other: 0 };
        if (dr === 'To Colombo') o.to += n; else if (dr === 'From Colombo') o.from += n; else o.other += n;
        byRoute.set(r, o);
    });
    const station = state.station === 'all' ? 'all stations' : state.station;
    let html = `<div class="kpis">` +
        kpi('Buses counted', fmt(total), `${esc(station)}${state.date !== 'all' ? ' · ' + esc(state.date) : ''}`) +
        kpi('To Colombo', fmt(dir.get('To Colombo') || 0), total ? pct(dir.get('To Colombo') || 0, total) + '%' : '') +
        kpi('From Colombo', fmt(dir.get('From Colombo') || 0), total ? pct(dir.get('From Colombo') || 0, total) + '%' : '') +
        kpi('Routes seen', fmt(byRoute.size), '') + `</div>`;

    const hours = tally(d, 'hour');
    const hourList = [...new Set([...hours.keys()].map(k => k.split('|')[0]))].sort();
    const hourRows = hourList.map(h => {
        const to = hours.get(`${h}|To Colombo`) || 0, from = hours.get(`${h}|From Colombo`) || 0;
        const all = [...hours.entries()].filter(([k]) => k.startsWith(h + '|')).reduce((s, [, n]) => s + n, 0);
        return `<tr><td>${esc(h)}:00</td><td class="num">${fmt(to)}</td><td class="num">${fmt(from)}</td><td class="num">${fmt(all)}</td></tr>`;
    }).join('');
    html += `<section class="card"><h2><i class="fa-solid fa-clock"></i> Buses per hour</h2><div class="table-wrap"><table><tr><th>Hour</th><th class="num">To Colombo</th><th class="num">From Colombo</th><th class="num">Total</th></tr>${hourRows || '<tr><td colspan="4" class="empty">Nothing recorded yet.</td></tr>'}</table></div></section>`;
    html += recordersCard(d, 'Buses');

    const routeRows = [...byRoute.entries()].sort((a, b) => (b[1].to + b[1].from + b[1].other) - (a[1].to + a[1].from + a[1].other)).map(([r, o]) =>
        `<tr><td>${esc(r)}</td><td class="num">${fmt(o.to)}</td><td class="num">${fmt(o.from)}</td><td class="num"><b>${fmt(o.to + o.from + o.other)}</b></td></tr>`).join('');
    html += `<section class="card wide"><h2><i class="fa-solid fa-route"></i> Buses by route</h2><div class="table-wrap"><table><tr><th>Route</th><th class="num">To Colombo</th><th class="num">From Colombo</th><th class="num">Total</th></tr>${routeRows || '<tr><td colspan="4" class="empty">Nothing recorded yet.</td></tr>'}</table></div></section>`;
    html += bars('Operator', tally(d, 'operator'));
    html += bars('Bus size', tally(d, 'size'));
    html += bars('Number of passengers', tally(d, 'occupancy'), { order: OCCUPANCY });
    return html;
}

// ---------------------------------------------------------------------
// Start: log straight in if the password is kept for this browser tab.
// ---------------------------------------------------------------------
if (password) {
    showDash();
    refreshAll().then(() => { if (!SURVEYS.some(s => data[s.id])) $('logout').click(); });
}
