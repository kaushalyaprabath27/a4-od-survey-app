/* =====================================================================
   A4 Godagama – Avissawella widening (feasibility study): roadside O-D survey
   ---------------------------------------------------------------------
   One form per vehicle stopped. The recorder, survey station and direction
   are set once per shift; every saved interview records them with its own
   date, time, Form No. and GPS position. Passenger and freight vehicles get
   their own questions (as on the paper forms); origin and destination are a
   village / town plus its district. The last questions collect the data for
   the Value of Time (VOT): household income (passenger vehicle owners) and
   the value of the goods carried (freight vehicles).

   Offline-first, like the other survey apps: each saved interview goes to
   localStorage first and is sent to the Apps Script backend in batches
   (every 15 s and on reconnect). The half-filled form is kept as a draft.
   ===================================================================== */

const CONFIG = Object.assign({
    appsScriptUrl: '',
    googlePlacesApiKey: '',
    placeSearchBbox: [79.4, 5.8, 82.0, 10.0],
    placeSearchCountry: 'lk',
    presetLocations: [],
    surveyLocations: [],
    directions: []
}, window.A4_CONFIG || {});

const PLACEHOLDER_URL = 'YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE';
const SURVEY_TYPE = 'a4-roadside-od';
// v3: commodity groups + details, load amount + unit. v2: district only (no DSD),
// no parking / ownership; trip purpose, 6+ count, owner income, commodity value.
const SYNC_ACTION = 'submit_a4od_v3';
const BATCH_SIZE = 50;
const SYNC_INTERVAL_MS = 15000;

const QUEUE_KEY = 'a4od_queue';      // interviews waiting to sync
const BACKUP_KEY = 'a4od_backup';    // every interview saved on this device
const SESSION_KEY = 'a4od_session';  // recorder, station, direction
const DRAFT_KEY = 'a4od_draft';      // the form currently being filled in
const HISTORY_KEY = 'a4od_history';  // undo stack (eventIds)
const RECENT_KEY = 'a4od_recent';    // places used before on this device
const SEQ_KEY = 'a4od_seq';          // Form No. counters per recorder and day
const THEME_KEY = 'a4od_theme';

// ---------------------------------------------------------------------
// The questionnaire. Edit option lists here; the form is built from this.
//   single - pick one        multi - pick any number
//   place  - village / town with suggestions (keeps coordinates when picked)
//            presets: true offers config.js presetLocations first
//            recent: true also offers places used before on this phone
//            cities: true = Sri Lankan cities and towns first
//   district - district picked from the list (or 'Not known')
//   amount - a number (rupees by default), or 'Not known'
//            decimals: true allows 2.5;  units: [...] asks for the unit too
//            (unitOther: true adds 'Other' with a text box)
//   detail: { except, placeholder }  a single question that also needs the
//            item typed in for every answer except those listed
//   other: true adds "Other" with a text box (it must be filled in)
//   more: { option, min, placeholder }  picking that option asks for the
//            exact number (e.g. '6+' then the number of persons)
//   grid: true lays the options out in columns
//   optional: true  not counted in progress and never listed as missing
//   showIf: answers => boolean  shows the question only when true
//   sub: true  numbered as a sub-question of the one before (e.g. 5a)
//   section: 'Title'  starts a new section of the form with this heading
// Question numbers follow the questions actually shown (passenger and
// freight forms are each numbered 1, 2, 3 ...).
// An option can carry an icon: a Font Awesome name or inline SVG.
// ---------------------------------------------------------------------
const TUKTUK_SVG = '<svg class="svg-icon" viewBox="1.8 1.4 28.4 23" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path d="M2.5 13V6.2Q2.5 2 7 2H24.2Q26.4 2 26.7 3.8L27.9 12.4H26.1L25.1 4.3H7.6Q5.3 4.3 5.3 6.6V13Z"/><path d="M3.5 12.6H27.4Q29.7 12.6 29.7 15Q29.7 16.4 28.6 17.6L27.8 18.6H10.77A3.6 3.6 0 0 0 5.23 18.6H4.6Q2.4 18.6 2.4 16.2V13.7Q2.4 12.6 3.5 12.6ZM27.5 14.6a0.85 0.85 0 1 0 1.7 0a0.85 0.85 0 1 0 -1.7 0Z"/><path d="M22.6 12.6L24.6 8.4L25.5 8.8L23.8 12.6Z"/><path d="M5 20.9a3 3 0 1 0 6 0a3 3 0 1 0 -6 0ZM6.9 20.9a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0 -2.2 0ZM24 21.4a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0ZM25.6 21.4a0.9 0.9 0 1 0 1.8 0a0.9 0.9 0 1 0 -1.8 0Z"/><path d="M26.05 18.4H26.95V20.5H26.05Z"/></svg>';

const PASSENGER = 'Passenger vehicle';
const FREIGHT = 'Freight vehicle';
const isPax = a => a.vehicleCategory === PASSENGER;
const isFreight = a => a.vehicleCategory === FREIGHT;

const TRIP_ENDS = [
    ['Home', 'fa-house'], ['Work', 'fa-briefcase'], ['School / Education', 'fa-graduation-cap'], ['Business', 'fa-store'],
    ['Health', 'fa-hospital-user'], ['Shopping / Social', 'fa-bag-shopping'], ['Tourism / Leisure', 'fa-camera']
];
const IS_OWNER = 'Yes, the owner';
const RS = n => 'Rs. ' + n.toLocaleString('en-US');

const DISTRICTS = [
    'Ampara', 'Anuradhapura', 'Badulla', 'Batticaloa', 'Colombo', 'Galle', 'Gampaha', 'Hambantota', 'Jaffna', 'Kalutara',
    'Kandy', 'Kegalle', 'Kilinochchi', 'Kurunegala', 'Mannar', 'Matale', 'Matara', 'Moneragala', 'Mullaitivu', 'Nuwara Eliya',
    'Polonnaruwa', 'Puttalam', 'Ratnapura', 'Trincomalee', 'Vavuniya'
];

const FORM = [
    // ---------------- Vehicle ----------------
    {
        id: 'vehicleCategory', section: 'Vehicle', label: 'Vehicle category', type: 'single', grid: true, hint: 'Observe',
        options: [[PASSENGER, 'fa-car-side'], [FREIGHT, 'fa-truck']]
    },
    {
        id: 'paxType', label: 'Vehicle type', type: 'single', grid: true, hint: 'Observe', showIf: isPax,
        options: [
            ['Motorcycle', 'fa-motorcycle'],
            ['3-wheeler', TUKTUK_SVG],
            ['Taxi', 'fa-taxi'],
            ['Car / Jeep', 'fa-car-side'],
            ['Passenger van', 'fa-van-shuttle'],
            ['Office van', 'fa-van-shuttle'],
            ['School van', 'fa-bus-simple'],
            ['Minibus', 'fa-van-shuttle'],
            ['Large bus', 'fa-bus']
        ]
    },
    {
        id: 'freightType', label: 'Vehicle type', type: 'single', grid: true, other: true, hint: 'Observe', showIf: isFreight,
        options: [
            ['Delivery van', 'fa-van-shuttle'],
            ['Small lorry', 'fa-truck-pickup'],
            ['Truck (2 axle)', 'fa-truck'],
            ['Container (20 ft / 3 axle)', 'fa-truck-moving'],
            ['Multi-axle container (40 ft)', 'fa-truck-ramp-box']
        ]
    },
    {
        id: 'occupancy', label: 'Occupancy', type: 'single', hint: 'Persons in the vehicle, including the driver',
        options: ['1', '2', '3', '4', '5', '6+'], more: { option: '6+', min: 6, placeholder: 'Number of persons (6 or more)' }
    },

    // ---------------- Origin ----------------
    {
        id: 'origin', section: 'Origin', label: 'Where did this trip start?', type: 'place', presets: true, recent: true, recentGroup: 'odPlaces', cities: true,
        hint: 'Village / town / location', placeholder: 'Type a village, town or place'
    },
    { id: 'originDistrict', label: 'District of the origin', type: 'district', sub: true },
    { id: 'originType', label: 'Type of origin', type: 'single', grid: true, other: true, showIf: isPax, options: TRIP_ENDS },

    // ---------------- Destination ----------------
    {
        id: 'destination', section: 'Destination', label: 'Where will this trip end?', type: 'place', presets: true, recent: true, recentGroup: 'odPlaces', cities: true,
        hint: 'Village / town / location', placeholder: 'Type a village, town or place'
    },
    { id: 'destinationDistrict', label: 'District of the destination', type: 'district', sub: true },
    { id: 'destinationType', label: 'Type of destination', type: 'single', grid: true, other: true, showIf: isPax, options: TRIP_ENDS },

    // ---------------- Trip details ----------------
    {
        id: 'frequency', section: 'Trip details', label: 'How often do you make this trip?', type: 'single', grid: true, other: true,
        options: [
            ['Daily', 'fa-calendar-day'],
            ['Several days a week', 'fa-calendar-week'],
            ['About once a week', 'fa-calendar'],
            ['Once in 2 weeks', 'fa-calendar'],
            ['Monthly', 'fa-calendar-days'],
            ['Less frequently', 'fa-hourglass-half'],
            ['First time', 'fa-star']
        ]
    },
    {
        id: 'commodity', label: 'Commodity carried', type: 'single', grid: true, showIf: isFreight,
        options: [
            ['Empty', 'fa-box-open'],
            ['Vegetables / Fruits', 'fa-carrot'],
            ['Essential food items', 'fa-wheat-awn'],
            ['Building materials', 'fa-trowel-bricks'],
            ['Industrial products', 'fa-industry'],
            ['Other', 'fa-ellipsis']
        ],
        detail: { except: ['Empty'], placeholder: 'Type the goods, e.g. potatoes, rice, cement' }
    },
    { id: 'load', label: 'Load condition', type: 'single', hint: 'Observe', showIf: isFreight, options: ['Empty', '1/4', '1/2', '3/4', 'Full', 'Overloaded'] },
    {
        id: 'tripPurpose', label: 'What is the main purpose of this trip?', type: 'single', grid: true, other: true, showIf: isPax,
        options: [
            ['Work', 'fa-briefcase'],
            ['Business', 'fa-store'],
            ['Education', 'fa-graduation-cap'],
            ['Healthcare', 'fa-hospital-user'],
            ['Shopping', 'fa-bag-shopping'],
            ['Religious activity', 'fa-place-of-worship'],
            ['Recreation / tourism', 'fa-camera'],
            ['Accompanying / assisting someone', 'fa-people-arrows']
        ]
    },
    {
        id: 'expressway', label: 'In future, would you use the Kahathuduwa – Ingiriya Expressway on this route?', type: 'single', yesno: true,
        hint: 'Future use of the expressway', options: [['Yes', 'fa-circle-check'], ['No', 'fa-circle-xmark'], ['Not sure', 'fa-circle-question']]
    },

    // ---------------- Value of Time (VOT) ----------------
    {
        id: 'isOwner', section: 'Value of time', label: 'Is the respondent the owner of this vehicle?', type: 'single', yesno: true, showIf: isPax,
        hint: 'Income is asked from the owner only', options: [[IS_OWNER, 'fa-user-check'], ['No', 'fa-user-xmark']]
    },
    {
        id: 'income', label: 'Monthly household income', type: 'single', grid: true, sub: true, showIf: a => isPax(a) && a.isOwner === IS_OWNER,
        hint: 'Rupees per month, for the Value of Time in the economic analysis',
        options: [
            'Less than ' + RS(30000), RS(30000) + ' – ' + RS(50000), RS(50000) + ' – ' + RS(75000), RS(75000) + ' – ' + RS(120000),
            RS(120000) + ' – ' + RS(200000), RS(200000) + ' – ' + RS(300000), RS(300000) + ' – ' + RS(500000), 'More than ' + RS(500000),
            'Prefer not to say'
        ]
    },
    {
        id: 'commodityValue', label: 'Approximate value of the goods carried', type: 'amount', showIf: a => isFreight(a) && a.load !== 'Empty' && a.commodity !== 'Empty',
        hint: 'Rupees, for the Value of Time in the economic analysis', placeholder: 'e.g. 250000'
    },
    {
        id: 'loadQty', label: 'Approximate load carried', type: 'amount', decimals: true,
        units: ['tonnes', 'kg', 'bags', 'units', 'litres', 'cubes'], unitOther: true,
        showIf: a => isFreight(a) && a.load !== 'Empty' && a.commodity !== 'Empty',
        hint: 'Amount and unit, e.g. 2.5 tonnes or 40 bags', placeholder: 'e.g. 2.5'
    }
];

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------
function readJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
        return fallback;
    }
}

function writeJSON(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (e) {
        console.error('localStorage write failed for', key, e);
        showStorageWarning();
        return false;
    }
}

function generateId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

const pad2 = n => String(n).padStart(2, '0');
function formatDate(ts) { const d = new Date(ts); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function formatTime(ts) { const d = new Date(ts); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; }
function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
}
function optionLabel(o) { return Array.isArray(o) ? o[0] : o; }
function optionIcon(o) { return Array.isArray(o) ? o[1] : null; }

const $ = id => document.getElementById(id);

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------
let session = readJSON(SESSION_KEY, null);
let answers = readJSON(DRAFT_KEY, {});
let isSyncing = false;
let inFlightIds = new Set();
let lastSyncError = null;

const screens = { welcome: $('screen-welcome'), setup: $('screen-setup'), survey: $('screen-survey') };
function showScreen(name) {
    Object.keys(screens).forEach(k => screens[k].classList.toggle('active', k === name));
    document.body.classList.toggle('on-survey', name === 'survey');
}
function saveSession() { writeJSON(SESSION_KEY, session); }
function saveDraft() { writeJSON(DRAFT_KEY, answers); }

// Where to rank places from: the latest GPS fix, else the survey area centre.
function sessionLatLon() {
    if (lastFix) return { lat: lastFix.lat, lon: lastFix.lon };
    const c = CONFIG.surveyAreaCenter;
    return (c && isFinite(c.lat) && isFinite(c.lon)) ? { lat: c.lat, lon: c.lon } : null;
}

// ---------------------------------------------------------------------
// Toasts, modal, storage warning
// ---------------------------------------------------------------------
let toastTimer = null;
function showToast(message, type = 'success') {
    const c = $('toast-container');
    c.innerHTML = '';
    const t = el('div', `toast ${type}`);
    t.textContent = message;
    c.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 2200);
}

function openModal({ title, html, okLabel = 'OK', cancelLabel = 'Cancel', danger = false, showCancel = true, onOpen = null }) {
    return new Promise(resolve => {
        const modal = $('modal'), ok = $('modal-ok'), cancel = $('modal-cancel');
        $('modal-title').textContent = title;
        $('modal-body').innerHTML = html;
        ok.textContent = okLabel;
        ok.classList.toggle('danger', danger);
        cancel.textContent = cancelLabel;
        cancel.classList.toggle('hidden', !showCancel);
        modal.classList.remove('hidden');
        if (onOpen) onOpen($('modal-body'));
        const close = r => {
            modal.classList.add('hidden');
            ok.removeEventListener('click', onOk);
            cancel.removeEventListener('click', onCancel);
            resolve(r);
        };
        const onOk = () => close(true);
        const onCancel = () => close(false);
        ok.addEventListener('click', onOk);
        cancel.addEventListener('click', onCancel);
    });
}

let storageWarningEl = null;
function showStorageWarning() {
    if (storageWarningEl && document.body.contains(storageWarningEl)) return;
    storageWarningEl = el('div', 'storage-warning', 'DEVICE STORAGE FULL: new responses may NOT be saved. Sync or export a backup now. <button type="button">Dismiss</button>');
    storageWarningEl.setAttribute('role', 'alert');
    storageWarningEl.querySelector('button').addEventListener('click', () => { storageWarningEl.remove(); storageWarningEl = null; });
    document.body.prepend(storageWarningEl);
    if (navigator.onLine) syncQueue();
}

// ---------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------
function applyTheme(theme) {
    const isLight = theme === 'light';
    document.body.classList.toggle('light-theme', isLight);
    $('theme-toggle').querySelector('i').className = isLight ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    document.querySelector('meta[name="theme-color"]').setAttribute('content', isLight ? '#f1f5f9' : '#0f172a');
}
$('theme-toggle').addEventListener('click', () => {
    const next = document.body.classList.contains('light-theme') ? 'dark' : 'light';
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    applyTheme(next);
});

// ---------------------------------------------------------------------
// Welcome + shift setup (recorder, station, direction)
// ---------------------------------------------------------------------
const inputName = $('surveyor-name');
const inputLocation = $('survey-location');
const inputDirection = $('survey-direction');
const btnStart = $('btn-start');

$('btn-next').addEventListener('click', () => showScreen('setup'));

function buildSetupLists() {
    $('location-list').innerHTML = (CONFIG.surveyLocations || []).map(l => `<option value="${escapeHtml(l)}"></option>`).join('');
    const box = $('dir-chips');
    box.innerHTML = '';
    (CONFIG.directions || []).forEach(d => {
        const b = el('button', 'chip-opt', `<i class="fa-solid fa-arrow-right"></i><span>${escapeHtml(d)}</span>`);
        b.type = 'button';
        b.dataset.value = d;
        b.setAttribute('role', 'radio');
        b.addEventListener('click', () => { inputDirection.value = d; checkSetupForm(); });
        box.appendChild(b);
    });
}

function checkSetupForm() {
    const dir = inputDirection.value.trim();
    $('dir-chips').querySelectorAll('.chip-opt').forEach(b => {
        const on = b.dataset.value === dir;
        b.classList.toggle('selected', on);
        b.setAttribute('aria-checked', String(on));
    });
    const ok = !!(inputName.value.trim() && inputLocation.value.trim() && dir);
    btnStart.disabled = !ok;
    btnStart.classList.toggle('btn-disabled', !ok);
}
[inputName, inputLocation, inputDirection].forEach(i => i.addEventListener('input', checkSetupForm));

btnStart.addEventListener('click', () => {
    if (btnStart.disabled) return;
    session = {
        id: generateId(), active: true, name: inputName.value.trim(), location: inputLocation.value.trim(),
        direction: inputDirection.value.trim(), startedAt: Date.now()
    };
    saveSession();
    writeJSON(HISTORY_KEY, []);
    startGps();
    startSurveyScreen();
});

function showSessionInfo() {
    $('info-name').textContent = session.name;
    $('info-location').textContent = session.location || '-';
    $('info-direction-text').textContent = session.direction || '-';
}

function startSurveyScreen() {
    showSessionInfo();
    renderAllFromAnswers();
    updateCount();
    updateAutoInfo();
    updateGpsStatus();
    updateSyncStatus();
    showScreen('survey');
}

// Switch the direction surveyed during a shift (e.g. when the team crosses over).
$('info-direction').addEventListener('click', async () => {
    const opts = (CONFIG.directions || []).slice();
    if (session.direction && !opts.includes(session.direction)) opts.push(session.direction);
    let picked = session.direction;
    const ok = await openModal({
        title: 'Direction surveyed',
        html: '<div class="chips modal-chips">' + opts.map(d => `<button type="button" class="chip-opt${d === picked ? ' selected' : ''}" data-value="${escapeHtml(d)}"><i class="fa-solid fa-arrow-right"></i><span>${escapeHtml(d)}</span></button>`).join('') +
            '</div><input type="text" class="other-input" id="dir-typed" placeholder="or type another direction">',
        okLabel: 'Use this direction',
        onOpen: body => {
            const typed = body.querySelector('#dir-typed');
            body.querySelectorAll('.chip-opt').forEach(b => b.addEventListener('click', () => {
                picked = b.dataset.value;
                typed.value = '';
                body.querySelectorAll('.chip-opt').forEach(x => x.classList.toggle('selected', x === b));
            }));
            typed.addEventListener('input', () => {
                picked = typed.value.trim();
                body.querySelectorAll('.chip-opt').forEach(x => x.classList.remove('selected'));
            });
        }
    });
    if (!ok || !picked || picked === session.direction) return;
    session.direction = picked;
    saveSession();
    showSessionInfo();
    showToast(`Direction: ${picked}`);
});

// ---------------------------------------------------------------------
// Location: watched while surveying. Each interview saves the position
// taken when it is saved.
// ---------------------------------------------------------------------
const GPS_FRESH_MS = 60000;   // a fix this recent is used as it is
const GPS_WAIT_MS = 8000;     // otherwise wait up to this long for a new one
let lastFix = null;           // { lat, lon, acc, ts }
let gpsWatch = null;
let gpsError = '';

function onFix(pos) {
    lastFix = {
        lat: +pos.coords.latitude.toFixed(6),
        lon: +pos.coords.longitude.toFixed(6),
        acc: Math.round(pos.coords.accuracy),
        ts: pos.timestamp || Date.now()
    };
    gpsError = '';
    updateGpsStatus();
}
function onFixError(err) {
    gpsError = err && err.code === 1 ? 'denied' : 'unavailable';
    updateGpsStatus();
}
function startGps() {
    if (gpsWatch !== null || !('geolocation' in navigator)) { updateGpsStatus(); return; }
    gpsWatch = navigator.geolocation.watchPosition(onFix, onFixError, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
}
function fixIsFresh() { return !!lastFix && Date.now() - lastFix.ts < GPS_FRESH_MS; }

function updateGpsStatus() {
    const chip = $('gps-chip');
    if (!chip) return;
    let cls = 'chip gps-chip', text;
    if (!('geolocation' in navigator)) { cls += ' bad'; text = 'No GPS'; }
    else if (fixIsFresh()) { cls += lastFix.acc <= 30 ? ' good' : ' fair'; text = `GPS ±${lastFix.acc} m`; }
    else if (gpsError === 'denied') { cls += ' bad'; text = 'GPS blocked'; }
    else { cls += ' wait'; text = lastFix ? 'GPS (old fix)' : 'GPS searching…'; }
    chip.className = cls;
    chip.querySelector('.gps-text').textContent = text;
    chip.title = gpsError === 'denied' ? 'Location is blocked: allow location for this site in the browser settings.' : 'Saved with each interview';
    const loc = $('auto-location');
    if (loc) {
        loc.textContent = lastFix ? `${lastFix.lat}, ${lastFix.lon} (±${lastFix.acc} m)`
            : gpsError === 'denied' ? 'Location blocked' : 'Waiting for GPS…';
    }
}

// The position saved with an interview: the recent fix, else wait briefly for
// a new one, else the last known fix (marked "stale"), else none.
function interviewFix() {
    if (fixIsFresh()) return Promise.resolve(Object.assign({}, lastFix, { status: 'ok' }));
    if (!('geolocation' in navigator)) return Promise.resolve(null);
    return new Promise(resolve => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            resolve(lastFix ? Object.assign({}, lastFix, { status: fixIsFresh() ? 'ok' : 'stale' }) : null);
        };
        navigator.geolocation.getCurrentPosition(p => { onFix(p); finish(); }, finish,
            { enableHighAccuracy: true, timeout: GPS_WAIT_MS, maximumAge: GPS_FRESH_MS });
        setTimeout(finish, GPS_WAIT_MS + 500);
    });
}

// Form No.: recorder initials, date and a counter on this device, e.g. KW-20261102-003.
function initials(name) {
    const letters = String(name || '').trim().split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return (letters || 'X').slice(0, 3);
}
function interviewIdKey() { return `${initials(session.name)}-${formatDate(Date.now()).replace(/-/g, '')}`; }
function nextInterviewId(take) {
    const key = interviewIdKey();
    const seq = readJSON(SEQ_KEY, {});
    const n = (seq[key] || 0) + 1;
    if (take) { seq[key] = n; writeJSON(SEQ_KEY, seq); }
    return `${key}-${String(n).padStart(3, '0')}`;
}
function releaseInterviewId(id) {
    // Undoing the most recent interview frees its number again.
    const m = /^(.*)-(\d+)$/.exec(id || '');
    if (!m) return;
    const seq = readJSON(SEQ_KEY, {});
    if (seq[m[1]] === +m[2]) { seq[m[1]] = +m[2] - 1; writeJSON(SEQ_KEY, seq); }
}

// ---------------------------------------------------------------------
// Automatic fields: date, time
// ---------------------------------------------------------------------
function updateAutoInfo() {
    const now = Date.now();
    $('auto-date').textContent = formatDate(now);
    $('auto-time').textContent = formatTime(now).slice(0, 5);
    if (session) $('auto-id').textContent = nextInterviewId(false);
}

// ---------------------------------------------------------------------
// Build the form from FORM
// ---------------------------------------------------------------------
const formEl = $('interview-form');
const renderers = {}; // id -> function that refreshes that question from `answers`
const numEls = {};    // id -> the number badge of that question
const sectionEls = []; // { el, ids } one per section heading

function buildForm() {
    formEl.innerHTML = '';
    sectionEls.length = 0;
    FORM.forEach(f => {
        if (f.section) {
            const h = el('h2', 'form-section', escapeHtml(f.section));
            formEl.appendChild(h);
            sectionEls.push({ el: h, ids: [] });
        }
        if (sectionEls.length) sectionEls[sectionEls.length - 1].ids.push(f.id);
        const q = el('section', 'q');
        q.dataset.q = f.id;
        const label = el('div', 'q-label',
            `<span class="q-num"></span><span>${escapeHtml(f.label)}</span>` +
            (f.hint ? `<span class="q-hint">${escapeHtml(f.hint)}</span>` : ''));
        label.id = `lbl-${f.id}`;
        numEls[f.id] = label.querySelector('.q-num');
        q.appendChild(label);
        if (f.type === 'place') buildPlaceField(q, f);
        else if (f.type === 'district') buildDistrictField(q, f);
        else if (f.type === 'amount') buildAmountField(q, f);
        else buildChoiceField(q, f);
        formEl.appendChild(q);
    });
}

function isAnswered(f) {
    const v = answers[f.id];
    if (f.type === 'place') return !!(v && v.text && v.text.trim());
    if (f.type === 'district') return !!(v && v.district);
    if (f.type === 'amount') {
        if (!v) return false;
        if (v.unknown) return true;
        if (!(+v.amount > 0)) return false;
        if (!f.units) return true;
        return !!v.unit && (v.unit !== 'Other' || !!(v.unitOther || '').trim());
    }
    if (f.type === 'multi') return Array.isArray(v) && v.length > 0;
    if (!(v && String(v).trim())) return false;
    // "Other" needs its text, and e.g. '6+' needs the exact number.
    if (f.other && v === 'Other' && !(answers[f.id + 'Other'] || '').trim()) return false;
    if (f.more && v === f.more.option && !(+answers[f.id + 'More'] >= (f.more.min || 0))) return false;
    if (f.detail && !(f.detail.except || []).includes(v) && !(answers[f.id + 'Detail'] || '').trim()) return false;
    return true;
}

function isVisible(f) { return !f.showIf || !!f.showIf(answers); }
function visibleQuestions() { return FORM.filter(f => isVisible(f) && !f.optional); }

// Numbers follow the questions on screen: 1, 2, 3 ... with sub-questions 2a.
function renumber() {
    let num = 0, sub = 0;
    FORM.forEach(f => {
        if (!isVisible(f)) return;
        if (f.sub && num) numEls[f.id].textContent = num + 'abcdefgh'[sub++];
        else { sub = 0; numEls[f.id].textContent = String(++num); }
    });
    sectionEls.forEach(s => s.el.classList.toggle('hidden', !s.ids.some(id => isVisible(FORM.find(f => f.id === id)))));
}

function refreshProgress() {
    let n = 0;
    FORM.forEach(f => {
        const shown = isVisible(f);
        const ok = shown && isAnswered(f);
        if (ok && !f.optional) n++;
        const q = formEl.querySelector(`[data-q="${f.id}"]`);
        if (q) { q.classList.toggle('answered', ok); q.classList.toggle('hidden', !shown); }
    });
    renumber();
    $('progress').textContent = `${n} of ${visibleQuestions().length} answered`;
    return n;
}

function renderAllFromAnswers() {
    Object.values(renderers).forEach(r => r());
    refreshProgress();
}

function changed() {
    saveDraft();
    refreshProgress();
}

// ----- Choice fields -----
function choiceOptions(f) {
    const opts = f.options.slice();
    if (f.other) opts.push(['Other', 'fa-ellipsis']);
    return opts.map(o => ({ value: optionLabel(o), label: optionLabel(o), icon: optionIcon(o) }));
}

function buildChoiceField(q, f) {
    const box = el('div', 'chips' + (f.type === 'multi' ? ' multi' : '') + (f.grid ? ' grid' : '') + (f.yesno ? ' yesno' : ''));
    box.setAttribute('role', f.type === 'multi' ? 'group' : 'radiogroup');
    box.setAttribute('aria-labelledby', `lbl-${f.id}`);
    const exclusives = f.exclusive ? [].concat(f.exclusive) : [];

    let otherInput = null;
    choiceOptions(f).forEach(o => {
        const icon = o.icon;
        const iconHtml = !icon ? '' : icon.startsWith('<') ? icon : `<i class="fa-solid ${icon}"></i>`;
        const b = el('button', 'chip-opt', iconHtml + `<span>${escapeHtml(o.label)}</span>`);
        b.type = 'button';
        b.dataset.value = o.value;
        b.setAttribute('role', f.type === 'multi' ? 'checkbox' : 'radio');
        b.addEventListener('click', () => {
            const value = o.value;
            if (f.type === 'multi') {
                let arr = Array.isArray(answers[f.id]) ? answers[f.id].slice() : [];
                if (arr.includes(value)) arr = arr.filter(x => x !== value);
                else if (exclusives.includes(value)) arr = [value];
                else arr = arr.filter(x => !exclusives.includes(x)).concat(value);
                answers[f.id] = arr;
            } else {
                answers[f.id] = answers[f.id] === value ? '' : value; // tap again to clear
            }
            renderers[f.id]();
            changed();
            if (value === 'Other' && otherInput && isSelected(f, 'Other')) setTimeout(() => otherInput.focus(), 50);
            if (f.more && value === f.more.option && moreInput && isSelected(f, value)) setTimeout(() => moreInput.focus(), 50);
            if (detailInput && needsDetail()) setTimeout(() => detailInput.focus(), 50);
        });
        box.appendChild(b);
    });
    q.appendChild(box);

    if (f.other) {
        otherInput = el('input', 'other-input hidden');
        otherInput.type = 'text';
        otherInput.placeholder = 'Please specify';
        otherInput.setAttribute('aria-label', `${f.label}: other, please specify`);
        otherInput.addEventListener('input', () => { answers[f.id + 'Other'] = otherInput.value; changed(); });
        q.appendChild(otherInput);
    }
    let detailInput = null;
    if (f.detail) {
        detailInput = el('input', 'other-input hidden');
        detailInput.type = 'text';
        detailInput.placeholder = f.detail.placeholder || 'Please specify';
        detailInput.setAttribute('aria-label', `${f.label}: details`);
        detailInput.addEventListener('input', () => { answers[f.id + 'Detail'] = detailInput.value; changed(); });
        q.appendChild(detailInput);
    }
    const needsDetail = () => !!f.detail && !!answers[f.id] && !(f.detail.except || []).includes(answers[f.id]);
    let moreInput = null;
    if (f.more) {
        moreInput = el('input', 'other-input hidden');
        moreInput.type = 'number';
        moreInput.inputMode = 'numeric';
        moreInput.min = String(f.more.min || 0);
        moreInput.step = '1';
        moreInput.placeholder = f.more.placeholder || 'Enter the number';
        moreInput.setAttribute('aria-label', `${f.label}: exact number`);
        moreInput.addEventListener('input', () => { answers[f.id + 'More'] = moreInput.value.replace(/[^0-9]/g, ''); changed(); });
        q.appendChild(moreInput);
    }

    renderers[f.id] = () => {
        box.querySelectorAll('.chip-opt').forEach(b => {
            const on = isSelected(f, b.dataset.value);
            b.classList.toggle('selected', on);
            b.setAttribute('aria-checked', String(on));
        });
        if (otherInput) {
            otherInput.classList.toggle('hidden', !isSelected(f, 'Other'));
            if (document.activeElement !== otherInput) otherInput.value = answers[f.id + 'Other'] || '';
        }
        if (detailInput) {
            detailInput.classList.toggle('hidden', !needsDetail());
            if (document.activeElement !== detailInput) detailInput.value = answers[f.id + 'Detail'] || '';
        }
        if (moreInput) {
            moreInput.classList.toggle('hidden', !isSelected(f, f.more.option));
            if (document.activeElement !== moreInput) moreInput.value = answers[f.id + 'More'] || '';
        }
    };
}

function isSelected(f, value) {
    const v = answers[f.id];
    return f.type === 'multi' ? (Array.isArray(v) && v.includes(value)) : v === value;
}

// ----- Shared type-ahead list (place and district fields) -----
// Builds the input, clear button, suggestion list and status line, and
// handles keyboard / tap selection. The caller supplies the rows.
function typeahead(q, f, icon) {
    const wrap = el('div', 'place');
    wrap.innerHTML = `<i class="fa-solid ${icon} place-icon"></i>`;
    const input = el('input');
    input.type = 'text';
    input.placeholder = f.placeholder || '';
    input.setAttribute('aria-labelledby', `lbl-${f.id}`);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    const clear = el('button', 'place-clear hidden', '<i class="fa-solid fa-xmark"></i>');
    clear.type = 'button';
    clear.setAttribute('aria-label', `Clear ${f.label}`);
    const list = el('ul', 'suggest hidden');
    list.id = `suggest-${f.id}`;
    list.setAttribute('role', 'listbox');
    input.setAttribute('aria-controls', list.id);
    wrap.append(input, clear, list);
    const status = el('div', 'place-status');
    q.append(wrap, status);

    const ta = { input, clear, list, status, items: [], active: -1, onChoose: null };
    ta.hide = () => { list.classList.add('hidden'); input.setAttribute('aria-expanded', 'false'); ta.active = -1; };
    ta.show = (rows, info, attrib) => {
        ta.items = rows;
        ta.active = -1;
        list.innerHTML = '';
        rows.forEach((r, i) => {
            const li = el('li', r.cls || '',
                `<div class="s-main">${r.iconHtml || ''}${escapeHtml(r.main)}${r.tag ? `<span class="s-tag">${escapeHtml(r.tag)}</span>` : ''}</div>` +
                (r.sub ? `<div class="s-sub">${escapeHtml(r.sub)}</div>` : ''));
            li.setAttribute('role', 'option');
            li.id = `${list.id}-${i}`;
            // Keep focus in the input and choose on a completed tap/click.
            li.addEventListener('mousedown', e => e.preventDefault());
            li.addEventListener('click', () => ta.onChoose(i));
            list.appendChild(li);
        });
        if (info) list.appendChild(el('li', 's-info', escapeHtml(info)));
        if (attrib) list.appendChild(el('li', 's-attrib', escapeHtml(attrib)));
        const open = rows.length > 0 || !!info;
        list.classList.toggle('hidden', !open);
        input.setAttribute('aria-expanded', String(open));
    };
    const highlight = i => {
        const lis = list.querySelectorAll('li[role="option"]');
        lis.forEach((li, k) => li.classList.toggle('active', k === i));
        ta.active = i;
        if (lis[i]) { input.setAttribute('aria-activedescendant', lis[i].id); lis[i].scrollIntoView({ block: 'nearest' }); }
    };
    input.addEventListener('blur', () => setTimeout(ta.hide, 120));
    input.addEventListener('keydown', e => {
        const n = list.querySelectorAll('li[role="option"]').length;
        if (e.key === 'ArrowDown' && n) { e.preventDefault(); highlight((ta.active + 1) % n); }
        else if (e.key === 'ArrowUp' && n) { e.preventDefault(); highlight((ta.active - 1 + n) % n); }
        else if (e.key === 'Enter') {
            e.preventDefault();
            if (ta.active >= 0 && ta.items[ta.active]) ta.onChoose(ta.active);
            else if (ta.onEnter) ta.onEnter();
        }
        else if (e.key === 'Escape') ta.hide();
    });
    // Bring the question to the top so the list has room above the keyboard.
    input.addEventListener('focus', () => setTimeout(() => q.scrollIntoView({ block: 'start', behavior: 'smooth' }), 150));
    return ta;
}

// ----- Place fields (village / town, with suggestions) -----
function recentKey(f) { return f.recentGroup || f.id; }
function recentFor(f, text) {
    if (!f.recent) return [];
    const t = text.toLowerCase();
    return (readJSON(RECENT_KEY, {})[recentKey(f)] || [])
        .filter(r => !t || r.label.toLowerCase().includes(t))
        .slice(0, 4)
        .map(r => Object.assign({}, r, { main: r.label, sub: 'Used before on this phone', tag: 'recent' }));
}
function rememberRecent(f, v) {
    if (!f.recent || !v || !v.text || !v.text.trim()) return;
    const all = readJSON(RECENT_KEY, {});
    const key = recentKey(f);
    const label = v.text.trim();
    all[key] = [{ label, lat: v.lat ?? null, lon: v.lon ?? null, source: v.source || 'typed' }]
        .concat((all[key] || []).filter(r => r.label.toLowerCase() !== label.toLowerCase()))
        .slice(0, 15);
    writeJSON(RECENT_KEY, all);
}
function presetFor(f, text) {
    if (!f.presets) return [];
    const words = text.toLowerCase().split(/[\s\-–]+/).filter(Boolean);
    return (CONFIG.presetLocations || [])
        .filter(name => words.every(w => name.toLowerCase().includes(w)))
        .map(name => ({ main: name, sub: CONFIG.presetSub || 'Nearby town', label: name, lat: null, lon: null, source: 'list', iconHtml: '<i class="fa-solid fa-map-pin"></i> ' }));
}

function buildPlaceField(q, f) {
    const ta = typeahead(q, f, 'fa-location-dot');
    const { input, clear, status } = ta;
    let timer = null, controller = null;

    const setStatus = () => {
        const v = answers[f.id];
        if (v && v.lat != null) { status.textContent = '✓ Place selected from map suggestions'; status.className = 'place-status ok'; }
        else if (v && v.text && v.confirmed) { status.textContent = v.source === 'list' ? `✓ ${CONFIG.presetSub || 'Nearby town'}` : '✓ Saved as typed'; status.className = 'place-status ok'; }
        else if (v && v.text) { status.textContent = 'Typed text will be saved as written'; status.className = 'place-status'; }
        else { status.textContent = ''; status.className = 'place-status'; }
    };
    // The recorder's own text is always the first choice.
    const typedItem = () => {
        const t = input.value.trim();
        return t ? [{ main: t, sub: 'Use as typed', label: t, lat: null, lon: null, source: 'typed', cls: 's-typed', iconHtml: '<i class="fa-solid fa-keyboard"></i> ' }] : [];
    };
    const showRows = (rows, info) => {
        const typed = typedItem();
        const typedKey = typed.length ? typed[0].label.toLowerCase() : null;
        // One row per name; a map match with coordinates replaces a list entry without.
        const rest = [], at = {};
        rows.forEach(r => {
            const k = r.label.toLowerCase();
            if (k === typedKey && r.lat == null) return;
            if (!(k in at)) { at[k] = rest.length; rest.push(r); }
            else if (rest[at[k]].lat == null && r.lat != null) rest[at[k]] = Object.assign({}, r, { sub: rest[at[k]].sub || r.sub });
        });
        const attrib = rest.some(r => r.source === 'osm' || r.source === 'google') && !info
            ? (CONFIG.googlePlacesApiKey ? 'Powered by Google' : 'Suggestions © OpenStreetMap contributors') : null;
        ta.show(typed.concat(rest), info, attrib);
    };
    ta.onChoose = async i => {
        const r = ta.items[i];
        if (!r) return;
        clearTimeout(timer);
        if (controller) controller.abort();
        input.value = r.label;
        answers[f.id] = { text: r.label, lat: r.lat ?? null, lon: r.lon ?? null, source: r.source, placeId: r.placeId || '', confirmed: true };
        ta.hide();
        clear.classList.remove('hidden');
        changed();
        setStatus();
        if (r.source === 'google' && r.placeId && r.lat == null) {
            const loc = await googlePlaceLocation(r.placeId).catch(() => null);
            if (loc && answers[f.id] && answers[f.id].placeId === r.placeId) {
                answers[f.id].lat = loc.lat;
                answers[f.id].lon = loc.lon;
                saveDraft();
                setStatus();
            }
        }
    };
    ta.onEnter = () => { if (input.value.trim()) { ta.items = typedItem(); ta.onChoose(0); } else ta.hide(); };

    const search = async text => {
        const qText = text.trim();
        const local = recentFor(f, qText).concat(presetFor(f, qText));
        if (!qText) { local.length ? showRows(local) : ta.hide(); return; }
        if (qText.length < 2) { showRows(local); return; }
        if (!navigator.onLine) { showRows(local, 'Offline: no map suggestions.'); return; }
        if (controller) controller.abort();
        controller = new AbortController();
        showRows(local, 'Searching…');
        try {
            const [cities, places] = await Promise.all([
                f.cities && !CONFIG.googlePlacesApiKey ? citySuggestions(qText, controller.signal).catch(e => { if (e.name === 'AbortError') throw e; return []; }) : [],
                placeSuggestions(qText, controller.signal)
            ]);
            const cityNames = new Set(cities.map(c => c.main.toLowerCase()));
            const found = cities.concat(places.filter(p => !(p.city && cityNames.has(p.main.toLowerCase()))));
            showRows(local.concat(found), found.length || local.length ? null : 'No map matches.');
        } catch (e) {
            if (e.name === 'AbortError') return;
            showRows(local, 'Map suggestions unavailable right now.');
        }
    };

    input.addEventListener('input', () => {
        answers[f.id] = { text: input.value, lat: null, lon: null, source: 'typed', placeId: '' };
        changed();
        setStatus();
        clear.classList.toggle('hidden', !input.value);
        clearTimeout(timer);
        // Refresh straight away so no stale suggestion from the previous text can be picked.
        const t = input.value.trim();
        if (t) showRows(recentFor(f, t).concat(presetFor(f, t)), t.length >= 2 ? 'Searching…' : null); else search('');
        timer = setTimeout(() => search(input.value), 350);
    });
    input.addEventListener('focus', () => {
        const v = answers[f.id];
        if (!(v && (v.lat != null || v.confirmed))) search(input.value);
    });
    clear.addEventListener('click', () => {
        input.value = '';
        answers[f.id] = null;
        clear.classList.add('hidden');
        ta.hide();
        changed();
        setStatus();
        input.focus();
    });
    renderers[f.id] = () => {
        const v = answers[f.id];
        input.value = (v && v.text) || '';
        clear.classList.toggle('hidden', !input.value);
        setStatus();
    };
}

// ----- District fields (picked from the list) -----
const NOT_KNOWN = 'Not known';
function buildDistrictField(q, f) {
    f.placeholder = f.placeholder || 'Type or pick the district';
    const ta = typeahead(q, f, 'fa-map');
    const { input, clear, status } = ta;
    const setStatus = () => {
        const v = answers[f.id];
        if (v && v.district) { status.textContent = v.district === NOT_KNOWN ? '✓ Not known' : `✓ ${v.district} District`; status.className = 'place-status ok'; }
        else if (v && v.text) { status.textContent = 'Pick a district from the list'; status.className = 'place-status warn'; }
        else { status.textContent = ''; status.className = 'place-status'; }
    };
    const show = () => {
        const t = input.value.trim().toLowerCase();
        const rows = DISTRICTS.filter(d => !t || d.toLowerCase().includes(t))
            .sort((x, y) => (x.toLowerCase().startsWith(t) ? 0 : 1) - (y.toLowerCase().startsWith(t) ? 0 : 1) || x.localeCompare(y))
            .map(d => ({ main: d, district: d }));
        rows.push({ main: NOT_KNOWN, sub: 'Respondent does not know the district', district: NOT_KNOWN, cls: 's-typed', iconHtml: '<i class="fa-solid fa-circle-question"></i> ' });
        ta.show(rows, rows.length === 1 ? 'No district matches - check the spelling.' : null);
    };
    ta.onChoose = i => {
        const r = ta.items[i];
        if (!r) return;
        answers[f.id] = { district: r.district, text: r.district };
        input.value = r.district;
        ta.hide();
        clear.classList.remove('hidden');
        changed();
        setStatus();
    };
    ta.onEnter = () => { if (ta.items.length > 1) ta.onChoose(0); };   // the best match
    input.addEventListener('input', () => {
        answers[f.id] = { district: '', text: input.value };
        changed();
        setStatus();
        clear.classList.toggle('hidden', !input.value);
        show();
    });
    input.addEventListener('focus', () => { const v = answers[f.id]; if (!(v && v.district)) show(); });
    clear.addEventListener('click', () => {
        input.value = '';
        answers[f.id] = null;
        clear.classList.add('hidden');
        changed();
        setStatus();
        input.focus();
    });
    renderers[f.id] = () => {
        const v = answers[f.id];
        input.value = !v ? '' : (v.district || v.text || '');
        clear.classList.toggle('hidden', !input.value);
        setStatus();
    };
}

// ----- Amount fields (rupees or another unit, or 'Not known') -----
function amountText(f, v) {
    const n = +v;
    return f.unit ? `${n.toLocaleString('en-US', { maximumFractionDigits: 3 })} ${f.unit}` : 'Rs. ' + n.toLocaleString('en-US');
}
function cleanAmount(f, text) {
    if (!f.decimals) return text.replace(/[^0-9]/g, '');
    const t = text.replace(/,/g, '.').replace(/[^0-9.]/g, '');
    const i = t.indexOf('.');
    return i < 0 ? t : t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, '');
}
function buildAmountField(q, f) {
    const wrap = el('div', 'amount');
    if (!f.unit && !f.units) wrap.innerHTML = '<span class="amount-unit">Rs.</span>';
    const input = el('input');
    input.type = 'text';
    input.inputMode = f.decimals ? 'decimal' : 'numeric';
    input.placeholder = f.placeholder || '';
    input.setAttribute('aria-labelledby', `lbl-${f.id}`);
    const nk = el('button', 'chip-opt amount-nk', `<i class="fa-solid fa-circle-question"></i><span>${NOT_KNOWN}</span>`);
    nk.type = 'button';
    wrap.append(input);
    if (f.unit) wrap.appendChild(el('span', 'amount-unit', escapeHtml(f.unit)));
    wrap.appendChild(nk);
    const status = el('div', 'place-status');
    q.append(wrap);
    // Unit chips (and 'Other' with a text box) for amounts that need a unit.
    let unitBox = null, unitOther = null;
    if (f.units) {
        unitBox = el('div', 'chips unit-chips');
        unitBox.setAttribute('role', 'radiogroup');
        f.units.concat(f.unitOther ? ['Other'] : []).forEach(u => {
            const b = el('button', 'chip-opt', `<span>${escapeHtml(u)}</span>`);
            b.type = 'button';
            b.dataset.value = u;
            b.setAttribute('role', 'radio');
            b.addEventListener('click', () => {
                const v = Object.assign({ amount: '' }, answers[f.id] || {}, { unknown: false });
                v.unit = v.unit === u ? '' : u;
                answers[f.id] = v;
                renderers[f.id]();
                changed();
                if (v.unit === 'Other' && unitOther) setTimeout(() => unitOther.focus(), 50);
            });
            unitBox.appendChild(b);
        });
        q.appendChild(unitBox);
        if (f.unitOther) {
            unitOther = el('input', 'other-input hidden');
            unitOther.type = 'text';
            unitOther.placeholder = 'Type the unit, e.g. barrels, crates';
            unitOther.setAttribute('aria-label', `${f.label}: other unit`);
            unitOther.addEventListener('input', () => {
                answers[f.id] = Object.assign({}, answers[f.id] || {}, { unitOther: unitOther.value });
                changed();
                setStatus();
            });
            q.appendChild(unitOther);
        }
    }
    q.appendChild(status);
    const unitName = v => v.unit === 'Other' ? (v.unitOther || '').trim() : (v.unit || '');
    const setStatus = () => {
        const v = answers[f.id] || {};
        if (v.unknown) { status.textContent = '✓ Not known'; status.className = 'place-status ok'; }
        else if (+v.amount > 0 && f.units && !unitName(v)) { status.textContent = 'Pick the unit'; status.className = 'place-status warn'; }
        else if (+v.amount > 0) { status.textContent = '✓ ' + (f.units ? `${(+v.amount).toLocaleString('en-US', { maximumFractionDigits: 3 })} ${unitName(v)}` : amountText(f, v.amount)); status.className = 'place-status ok'; }
        else { status.textContent = ''; status.className = 'place-status'; }
    };
    input.addEventListener('input', () => {
        const digits = cleanAmount(f, input.value);
        if (digits !== input.value) input.value = digits;
        answers[f.id] = Object.assign({}, answers[f.id] || {}, { amount: digits, unknown: false });
        nk.classList.remove('selected');
        changed();
        setStatus();
    });
    nk.addEventListener('click', () => {
        const on = !(answers[f.id] && answers[f.id].unknown);
        answers[f.id] = on ? { amount: '', unknown: true } : null;
        renderers[f.id]();
        changed();
    });
    renderers[f.id] = () => {
        const v = answers[f.id] || {};
        if (document.activeElement !== input) input.value = v.amount || '';
        nk.classList.toggle('selected', !!v.unknown);
        nk.setAttribute('aria-pressed', String(!!v.unknown));
        if (unitBox) unitBox.querySelectorAll('.chip-opt').forEach(b => {
            const on = !v.unknown && v.unit === b.dataset.value;
            b.classList.toggle('selected', on);
            b.setAttribute('aria-checked', String(on));
        });
        if (unitOther) {
            unitOther.classList.toggle('hidden', v.unknown || v.unit !== 'Other');
            if (document.activeElement !== unitOther) unitOther.value = v.unitOther || '';
        }
        setStatus();
    };
}

// ---------------------------------------------------------------------
// Place suggestion providers
// ---------------------------------------------------------------------
function placeSuggestions(text, signal) {
    return CONFIG.googlePlacesApiKey ? googleSuggestions(text, signal) : photonSuggestions(text, signal);
}

// Every city and town in Sri Lanka (OpenStreetMap place=city / town).
async function citySuggestions(text, signal) {
    const p = new URLSearchParams({ q: text, limit: '6', lang: 'en' });
    p.append('osm_tag', 'place:city');
    p.append('osm_tag', 'place:town');
    if (Array.isArray(CONFIG.placeSearchBbox) && CONFIG.placeSearchBbox.length === 4) p.set('bbox', CONFIG.placeSearchBbox.join(','));
    const res = await fetch('https://photon.komoot.io/api/?' + p.toString(), { signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return (data.features || []).map(ft => {
        const pr = ft.properties || {};
        const [lon, lat] = (ft.geometry && ft.geometry.coordinates) || [null, null];
        const sub = [pr.osm_value === 'city' ? 'City' : 'Town', pr.county || pr.state].filter(Boolean).join(' · ');
        return { main: pr.name || '', sub, label: pr.name || '', lat, lon, source: 'osm', city: true };
    }).filter(r => r.main);
}

// Free: Photon (komoot) over OpenStreetMap data. No key needed. Villages
// and towns anywhere in Sri Lanka, gently biased towards the survey site.
async function photonSuggestions(text, signal) {
    const p = new URLSearchParams({ q: text, limit: '6', lang: 'en' });
    const box = CONFIG.placeSearchBbox;
    if (Array.isArray(box) && box.length === 4) p.set('bbox', box.join(','));
    const here = sessionLatLon();
    if (here) {
        p.set('lat', here.lat);
        p.set('lon', here.lon);
        p.set('zoom', '10');
        p.set('location_bias_scale', '0.2');
    }
    const res = await fetch('https://photon.komoot.io/api/?' + p.toString(), { signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return (data.features || []).map(ft => {
        const pr = ft.properties || {};
        const main = pr.name || [pr.housenumber, pr.street].filter(Boolean).join(' ') || pr.city || pr.county || '';
        const parts = [];
        [pr.name ? pr.street : null, pr.district, pr.city, pr.county, pr.state].forEach(x => {
            if (x && x !== main && !parts.includes(x)) parts.push(x);
        });
        const sub = parts.join(', ');
        const [lon, lat] = (ft.geometry && ft.geometry.coordinates) || [null, null];
        return { main, sub, label: sub ? `${main}, ${sub}` : main, lat, lon, source: 'osm', city: pr.osm_key === 'place' && (pr.osm_value === 'city' || pr.osm_value === 'town') };
    }).filter(r => r.main);
}

// Optional: Google Places API (New). Used only when a key is set in config.js.
let googleSessionToken = null;
async function googleSuggestions(text, signal) {
    if (!googleSessionToken) googleSessionToken = generateId();
    const body = { input: text, sessionToken: googleSessionToken, includedRegionCodes: [CONFIG.placeSearchCountry || 'lk'] };
    const here = sessionLatLon();
    if (here) body.locationBias = { circle: { center: { latitude: here.lat, longitude: here.lon }, radius: 50000 } };
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': CONFIG.googlePlacesApiKey },
        body: JSON.stringify(body),
        signal
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return (data.suggestions || []).filter(s => s.placePrediction).map(s => {
        const pp = s.placePrediction;
        const main = (pp.structuredFormat && pp.structuredFormat.mainText && pp.structuredFormat.mainText.text) || (pp.text && pp.text.text) || '';
        const sub = (pp.structuredFormat && pp.structuredFormat.secondaryText && pp.structuredFormat.secondaryText.text) || '';
        return { main, sub, label: (pp.text && pp.text.text) || main, lat: null, lon: null, source: 'google', placeId: pp.placeId };
    });
}

async function googlePlaceLocation(placeId) {
    const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(googleSessionToken || '')}`;
    googleSessionToken = null; // a session ends with the details call
    const res = await fetch(url, { headers: { 'X-Goog-Api-Key': CONFIG.googlePlacesApiKey, 'X-Goog-FieldMask': 'location' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    return d.location ? { lat: d.location.latitude, lon: d.location.longitude } : null;
}

// ---------------------------------------------------------------------
// Save / clear / undo
// ---------------------------------------------------------------------
// The answer to a question shown on this form; '' when the question is hidden.
function shown(id) { const f = FORM.find(x => x.id === id); return !!f && isVisible(f); }
function singleValue(id) {
    if (!shown(id)) return '';
    const f = FORM.find(x => x.id === id);
    const v = answers[id] || '';
    if (v === 'Other') {
        const o = (answers[id + 'Other'] || '').trim();
        return o ? `Other: ${o}` : 'Other';
    }
    if (f.more && v === f.more.option && +answers[id + 'More'] >= (f.more.min || 0)) return String(+answers[id + 'More']);
    return v;
}
function placeCols(id, prefix) {
    const v = answers[id] || {};
    return { [prefix]: (v.text || '').trim(), [prefix + 'Lat']: v.lat ?? '', [prefix + 'Lon']: v.lon ?? '' };
}
function districtValue(id) { const v = answers[id] || {}; return v.district || ''; }
function amountValue(id) {
    if (!shown(id)) return '';
    const v = answers[id] || {};
    return v.unknown ? NOT_KNOWN : (+v.amount > 0 ? +v.amount : '');
}
function amountUnit(id) {
    if (!shown(id)) return '';
    const v = answers[id] || {};
    if (v.unknown) return '';
    return v.unit === 'Other' ? ((v.unitOther || '').trim() ? `Other: ${(v.unitOther || '').trim()}` : 'Other') : (v.unit || '');
}
function detailValue(id) {
    const f = FORM.find(x => x.id === id);
    if (!shown(id) || !f.detail || (f.detail.except || []).includes(answers[id])) return '';
    return (answers[id + 'Detail'] || '').trim();
}

function buildRecord(fix, interviewId, ts) {
    const now = ts || Date.now();
    const g = fix || {};
    return {
        action: 'submit',
        surveyType: SURVEY_TYPE,
        eventId: generateId(),
        sessionId: session.id,
        interviewId,
        name: session.name,
        surveyLocation: session.location,
        direction: session.direction,
        shiftStart: session.startedAt ? `${formatDate(session.startedAt)} ${formatTime(session.startedAt).slice(0, 5)}` : '',
        date: formatDate(now),
        time: formatTime(now),
        gpsLat: g.lat ?? '',
        gpsLon: g.lon ?? '',
        gpsAccuracyM: g.acc ?? '',
        gpsFixTime: g.ts ? formatTime(g.ts) : '',
        gpsStatus: fix ? fix.status : 'unavailable',
        locationMapLink: fix ? `https://www.google.com/maps?q=${g.lat},${g.lon}` : '',
        // Vehicle
        vehicleCategory: singleValue('vehicleCategory'),
        vehicleType: singleValue('paxType') || singleValue('freightType'),
        occupancy: singleValue('occupancy'),
        // Origin / destination
        ...placeCols('origin', 'origin'),
        originDistrict: districtValue('originDistrict'),
        originType: singleValue('originType'),
        ...placeCols('destination', 'destination'),
        destinationDistrict: districtValue('destinationDistrict'),
        destinationType: singleValue('destinationType'),
        // Trip details
        frequency: singleValue('frequency'),
        commodity: singleValue('commodity'),
        commodityDetail: detailValue('commodity'),
        load: singleValue('load'),
        tripPurpose: singleValue('tripPurpose'),
        expressway: singleValue('expressway'),
        // Value of Time
        isOwner: singleValue('isOwner'),
        income: singleValue('income'),
        commodityValue: amountValue('commodityValue'),
        loadQty: amountValue('loadQty'),
        loadUnit: amountUnit('loadQty')
    };
}

function resetForm() {
    answers = {};
    saveDraft();
    renderAllFromAnswers();
    updateAutoInfo();
    $('form-scroll').scrollTo({ top: 0, behavior: 'smooth' });
}

let saving = false;
$('btn-save').addEventListener('click', async () => {
    const n = refreshProgress();
    if (n === 0) { showToast('Nothing answered yet', 'error'); return; }
    if (!answers.vehicleCategory) { showToast('Pick the vehicle category first', 'error'); return; }
    const total = visibleQuestions().length;
    if (n < total) {
        const missing = visibleQuestions().filter(f => !isAnswered(f)).map(f => `<li>${escapeHtml(f.label)}</li>`).join('');
        const ok = await openModal({
            title: `Save with ${total - n} unanswered?`,
            html: `These questions are blank:<ul style="margin:0.5rem 0 0 1.2rem">${missing}</ul>`,
            okLabel: 'Save anyway',
            cancelLabel: 'Go back'
        });
        if (!ok) return;
    }
    if (saving) return;
    saving = true;
    const btn = $('btn-save');
    btn.disabled = true;
    const savedAt = Date.now();
    if (!fixIsFresh()) showToast('Getting the interview location…', 'info');
    let fix = null;
    try { fix = await interviewFix(); } finally { saving = false; btn.disabled = false; }
    const record = buildRecord(fix, nextInterviewId(true), savedAt);
    const queue = readJSON(QUEUE_KEY, []);
    queue.push(record);
    if (!writeJSON(QUEUE_KEY, queue)) { showToast('STORAGE FULL: response NOT saved!', 'error'); return; }
    const backup = readJSON(BACKUP_KEY, []);
    backup.push(record);
    writeJSON(BACKUP_KEY, backup);
    const history = readJSON(HISTORY_KEY, []);
    history.push(record.eventId);
    writeJSON(HISTORY_KEY, history.slice(-50));
    FORM.forEach(f => { if (f.recent) rememberRecent(f, answers[f.id]); });

    resetForm();
    updateCount();
    updateSyncStatus();
    showToast(fix ? `Form ${record.interviewId} saved` : `Form ${record.interviewId} saved (no GPS location)`, fix ? 'success' : 'error');
    syncQueue();
});

$('btn-clear').addEventListener('click', async () => {
    if (refreshProgress() === 0) return;
    const ok = await openModal({ title: 'Clear this form?', html: 'All answers on the form will be removed. Saved interviews are not affected.', okLabel: 'Clear', danger: true });
    if (ok) resetForm();
});

$('btn-undo').addEventListener('click', async () => {
    const history = readJSON(HISTORY_KEY, []);
    const id = history[history.length - 1];
    if (!id) { showToast('Nothing to undo', 'error'); return; }
    if (inFlightIds.has(id)) { showToast('Sending it right now. Try again in a moment.', 'error'); return; }
    const record = readJSON(QUEUE_KEY, []).find(r => r.eventId === id);
    if (!record) {
        history.pop();
        writeJSON(HISTORY_KEY, history);
        showToast('Already synced to the sheet. Cannot undo.', 'error');
        return;
    }
    const ok = await openModal({
        title: 'Delete the last saved interview?',
        html: `${escapeHtml(record.interviewId)} (${escapeHtml(record.vehicleType || record.vehicleCategory || 'vehicle')}), saved at ${escapeHtml(record.time)}.`,
        okLabel: 'Delete',
        danger: true
    });
    if (!ok) return;
    history.pop();
    writeJSON(HISTORY_KEY, history);
    writeJSON(QUEUE_KEY, readJSON(QUEUE_KEY, []).filter(r => r.eventId !== id));
    writeJSON(BACKUP_KEY, readJSON(BACKUP_KEY, []).filter(r => r.eventId !== id));
    releaseInterviewId(record.interviewId);
    updateCount();
    updateAutoInfo();
    updateSyncStatus();
    showToast('Last interview deleted');
});

function sessionRecords() {
    if (!session) return [];
    return readJSON(BACKUP_KEY, []).filter(r => r.sessionId === session.id);
}
function updateCount() { $('count-session').textContent = sessionRecords().length; }

// ---------------------------------------------------------------------
// End shift
// ---------------------------------------------------------------------
$('btn-end').addEventListener('click', async () => {
    const records = sessionRecords();
    const draftN = refreshProgress();
    const ok = await openModal({
        title: 'End shift?',
        html: `<b>${escapeHtml(session.name)}</b> at <b>${escapeHtml(session.location)}</b>: ${records.length} interview(s) saved.` +
            (draftN ? '<br><b>The form on screen is not saved yet</b> and will be kept as a draft.' : ''),
        okLabel: 'End shift',
        danger: true
    });
    if (!ok) return;
    session.active = false;
    saveSession();
    writeJSON(HISTORY_KEY, []);
    syncQueue();
    const pending = readJSON(QUEUE_KEY, []).length;
    const pax = records.filter(r => r.vehicleCategory === PASSENGER).length;
    await openModal({
        title: `${session.name}: shift ended`,
        html: `<table>
            <tr><td>Interviews saved</td><td>${records.length}</td></tr>
            <tr><td>Passenger / freight</td><td>${pax} / ${records.length - pax}</td></tr>
            <tr><td>Waiting to sync (this device)</td><td>${pending}</td></tr>
        </table>` + (pending ? '<p style="margin-top:0.6rem">Keep the app open with internet until everything is synced, or export a backup.</p>' : ''),
        okLabel: 'New shift',
        showCancel: false
    });
    fillSetupFromSession();
    showScreen('setup');
});

function fillSetupFromSession() {
    inputName.value = session.name || '';
    inputLocation.value = session.location || '';
    inputDirection.value = session.direction || '';
    checkSetupForm();
}

// ---------------------------------------------------------------------
// Sync (batches of 50, removed from the queue only after server success)
// ---------------------------------------------------------------------
function isBackendConfigured() { return !!CONFIG.appsScriptUrl && CONFIG.appsScriptUrl !== PLACEHOLDER_URL; }

function syncQueue() {
    if (isSyncing || !navigator.onLine || !isBackendConfigured()) { updateSyncStatus(); return; }
    const queue = readJSON(QUEUE_KEY, []);
    if (!queue.length) { updateSyncStatus(); return; }
    const batch = queue.slice(0, BATCH_SIZE);
    isSyncing = true;
    inFlightIds = new Set(batch.map(r => r.eventId));
    updateSyncStatus();

    fetch(CONFIG.appsScriptUrl, {
        method: 'POST',
        body: JSON.stringify({ action: SYNC_ACTION, payload: batch }),
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    })
        .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
        .then(result => {
            if (result.status !== 'success') throw new Error(result.message || 'Server error');
            writeJSON(QUEUE_KEY, readJSON(QUEUE_KEY, []).filter(r => !inFlightIds.has(r.eventId)));
            lastSyncError = null;
        })
        .catch(err => { lastSyncError = err.message || String(err); console.error('Sync failed:', err); })
        .finally(() => {
            isSyncing = false;
            inFlightIds = new Set();
            updateSyncStatus();
            if (!lastSyncError && readJSON(QUEUE_KEY, []).length) setTimeout(syncQueue, 800);
        });
}

function updateSyncStatus() {
    const node = $('sync-status');
    const pending = readJSON(QUEUE_KEY, []).length;
    let cls = 'sync-status', label;
    if (!isBackendConfigured()) { cls += ' unconfigured'; label = `Not linked to sheet · ${pending} on device`; }
    else if (!navigator.onLine) { cls += ' offline'; label = `Offline · ${pending} pending`; }
    else if (isSyncing) { cls += ' syncing'; label = `Syncing · ${pending} pending`; }
    else if (lastSyncError && pending) { cls += ' error'; label = `Sync error · ${pending} pending`; }
    else if (pending) { cls += ' pending'; label = `Online · ${pending} pending`; }
    else label = 'Online · Synced';
    node.className = cls;
    node.querySelector('.sync-text').textContent = label;
    node.title = lastSyncError ? `Last error: ${lastSyncError}` : '';
}
window.addEventListener('online', () => { updateSyncStatus(); syncQueue(); });
window.addEventListener('offline', updateSyncStatus);

// ---------------------------------------------------------------------
// Local backup export
// ---------------------------------------------------------------------
function exportLocalBackup() {
    const records = readJSON(BACKUP_KEY, []);
    const pending = readJSON(QUEUE_KEY, []);
    if (!records.length && !pending.length) { showToast('No responses on this device yet', 'error'); return; }
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), records, pendingSync: pending, draft: answers }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a');
    a.href = url;
    a.download = `a4_od_backup_${formatDate(Date.now())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Backup exported (${records.length} interviews)`);
}
$('btn-export').addEventListener('click', exportLocalBackup);
$('btn-export-setup').addEventListener('click', exportLocalBackup);

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------
function init() {
    let theme = 'dark';
    try { theme = localStorage.getItem(THEME_KEY) || 'dark'; } catch (e) {}
    applyTheme(theme);

    // Netlify's hosting badge sits in the bottom-right corner; the CSS keeps
    // the Save button out from under it.
    const markHostBadge = () => {
        if (/\.netlify\.app$/.test(location.hostname) || document.querySelector('script[src*="/.netlify/scripts/"]')) {
            document.body.classList.add('has-host-badge');
        }
    };
    markHostBadge();
    document.addEventListener('DOMContentLoaded', markHostBadge);

    if (CONFIG.projectName) document.querySelector('#screen-welcome .subtitle').textContent = `${CONFIG.projectName} · One form per vehicle`;

    buildSetupLists();
    buildForm();
    if (session) fillSetupFromSession();
    if (session && session.active) {
        startGps();
        startSurveyScreen();
        if (refreshProgress()) showToast('Unsaved form restored');
    }

    updateSyncStatus();
    setInterval(syncQueue, SYNC_INTERVAL_MS);
    setInterval(() => { if (screens.survey.classList.contains('active')) { updateAutoInfo(); updateGpsStatus(); } }, 15000);
    if (!isBackendConfigured()) setTimeout(() => showToast('Apps Script URL not set: data is kept on this device only', 'error'), 600);
    syncQueue();
}

init();
