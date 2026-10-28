import { solarEvents, polarConditions, dayOfYearToDate, dayOfYear, daysInYear, minutesUTC } from './solar.js';
import { createWheel } from './wheel.js';
import { lookupZip, tzRefs } from './location.js';

// Shown until the user picks a ZIP; matches its row in data/zips.txt.
const DEFAULT_LOCATION = {
  zip: '80005',
  place: 'Arvada',
  state: 'CO',
  lat: 39.84,
  lon: -105.11,
  timeZone: 'America/Denver',
};

const EVENTS = [
  ['dawn', 'Dawn'],
  ['sunrise', 'Sunrise'],
  ['solarNoon', 'Solar noon'],
  ['sunset', 'Sunset'],
  ['dusk', 'Dusk'],
];

const year = new Date().getFullYear();

// Offset (minutes from UTC) that puts clock noon at the selected day's solar noon.
function solarNoonOffset({ loc, year, doy }) {
  const dayStart = dayOfYearToDate(year, doy);
  const noon = solarEvents(dayStart, loc.lat, loc.lon).solarNoon;
  return Math.round(720 - minutesUTC(noon, dayStart));
}

const withRefs = (loc) => ({ ...loc, refs: tzRefs(loc.timeZone, year) });

// Preferences are remembered per browser when storage is available.
const HOUR12_KEY = 'daylight.hour12';
const ZIP_KEY = 'daylight.zip';

function readPref(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode etc.); the choice just won't persist.
  }
}

const state = {
  loc: withRefs(DEFAULT_LOCATION),
  year,
  doy: Math.min(dayOfYear(new Date()), daysInYear(year)),
  hour12: readPref(HOUR12_KEY) !== 'false', // 12-hour (AM/PM) is the default
};
state.offset = solarNoonOffset(state);

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');

function fmtClock(min, hour12) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return hour12
    ? `${h % 12 || 12}:${pad(m % 60)} ${h < 12 ? 'AM' : 'PM'}`
    : `${pad(h)}:${pad(m % 60)}`;
}

// Intl truncates seconds; round instead so it agrees with fmtClock.
const roundToMinute = (date) => new Date(Math.round(date / 60000) * 60000);

function fmtDuration(min) {
  const m = Math.round(min);
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}

function fmtOffset(offset) {
  const sign = offset < 0 ? '−' : '+';
  const a = Math.abs(offset);
  return `UTC${sign}${Math.floor(a / 60)}:${pad(a % 60)}`;
}

function offsetText(offset, refs) {
  const ref = refs.find((r) => r.offset === offset);
  return ref ? `${fmtOffset(offset)} (= ${ref.label})` : fmtOffset(offset);
}

const legalFmt = (timeZone, hour12) => new Intl.DateTimeFormat('en-US', {
  timeZone,
  timeZoneName: 'short',
  minute: '2-digit',
  ...(hour12 ? { hour: 'numeric', hour12: true } : { hour: '2-digit', hourCycle: 'h23' }),
});
const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const wheel = createWheel($('wheel'), {
  onOffsetChange(offset) {
    state.offset = offset;
    update();
  },
});

function update() {
  const { loc, offset } = state;
  const dayStart = dayOfYearToDate(state.year, state.doy);
  const events = solarEvents(dayStart, loc.lat, loc.lon);
  const minutes = Object.fromEntries(Object.entries(events)
    .map(([k, d]) => [k, d && minutesUTC(d, dayStart)]));
  const polar = polarConditions(dayStart, loc.lat, loc.lon);

  wheel.render({
    T0: minutes.solarNoon,
    events: minutes,
    polar,
    offset,
    refs: loc.refs,
    offsetText: offsetText(offset, loc.refs),
    hour12: state.hour12,
  });

  $('hour-format').dataset.mode = state.hour12 ? '12' : '24';
  $('day-label').textContent = dateFmt.format(dayStart);
  $('offset').textContent = offsetText(offset, loc.refs);

  const legal = legalFmt(loc.timeZone, state.hour12);
  $('readout-body').replaceChildren(...EVENTS.map(([key, label]) => {
    const tr = document.createElement('tr');
    const cells = events[key]
      ? [label, fmtClock(minutes[key] + offset, state.hour12), legal.format(roundToMinute(events[key]))]
      : [label, '—', '—'];
    for (const text of cells) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    return tr;
  }));

  const dayLength = minutes.sunrise != null && minutes.sunset != null
    ? fmtDuration(minutes.sunset - minutes.sunrise)
    : { day: '24h 00m (sun never sets)', night: '0h 00m (sun never rises)' }[polar.sun] ?? '—';
  const noonDrift = Math.round(minutes.solarNoon + offset - 720);
  $('day-length').textContent = dayLength;
  $('noon-drift').textContent = noonDrift === 0 ? 'at clock noon'
    : `${Math.abs(noonDrift)} min ${noonDrift > 0 ? 'after' : 'before'} clock noon`;
}

function initSlider() {
  const slider = $('day');
  const n = daysInYear(state.year);
  slider.max = n;
  slider.value = state.doy;
  const marks = [[2, 20], [5, 21], [8, 22], [11, 21]]; // approx. equinoxes and solstices
  $('day-marks').replaceChildren(...marks.map(([month, day]) => {
    const opt = document.createElement('option');
    opt.value = dayOfYear(new Date(state.year, month, day));
    return opt;
  }));
  slider.addEventListener('input', () => {
    state.doy = Number(slider.value);
    update();
  });
}

function renderRefButtons() {
  for (const old of document.querySelectorAll('.ref-button')) old.remove();
  $('reset').after(...state.loc.refs.map((ref) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ref-button';
    button.textContent = `Snap to ${ref.name} (${ref.label})`;
    button.addEventListener('click', () => {
      state.offset = ref.offset;
      update();
    });
    return button;
  }));
}

// A new location gets its own time zone references, and the clock is
// realigned to its solar noon.
function setLocation(loc) {
  state.loc = withRefs(loc);
  state.offset = solarNoonOffset(state);
  $('zip').value = loc.zip;
  $('place').textContent = `${loc.place}, ${loc.state}`;
  renderRefButtons();
  update();
}

let lookupSeq = 0;

async function lookupAndSet(zip) {
  const seq = ++lookupSeq;
  const status = $('zip-status');
  status.textContent = 'Loading…';
  try {
    const loc = await lookupZip(zip);
    if (seq !== lookupSeq) return; // a newer lookup superseded this one
    if (!loc) {
      status.textContent = 'ZIP not found';
      return;
    }
    status.textContent = '';
    writePref(ZIP_KEY, zip);
    setLocation(loc);
  } catch {
    if (seq === lookupSeq) status.textContent = "Couldn't load ZIP data";
  }
}

function initZipInput() {
  const input = $('zip');
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 5);
    if (input.value.length === 5 && input.value !== state.loc.zip) lookupAndSet(input.value);
    else $('zip-status').textContent = '';
  });
  input.addEventListener('keydown', (evt) => {
    if (evt.key !== 'Enter') return;
    if (input.value.length === 5) lookupAndSet(input.value);
    else $('zip-status').textContent = 'Enter a 5-digit ZIP';
  });
}

$('reset').addEventListener('click', () => {
  state.offset = solarNoonOffset(state);
  update();
});
$('hour-format').addEventListener('click', () => {
  state.hour12 = !state.hour12;
  writePref(HOUR12_KEY, state.hour12);
  update();
});
initSlider();
initZipInput();
setLocation(DEFAULT_LOCATION);

const savedZip = readPref(ZIP_KEY);
if (savedZip && savedZip !== DEFAULT_LOCATION.zip) lookupAndSet(savedZip);
