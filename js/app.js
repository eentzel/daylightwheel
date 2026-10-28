import { solarEvents, dayOfYearToDate, dayOfYear, daysInYear, minutesUTC } from './solar.js';
import { createWheel } from './wheel.js';

// Hardcoded until the ZIP picker exists.
const LOCATION = {
  zip: '80005',
  name: 'Arvada, CO',
  lat: 39.85,
  lon: -105.11,
  timeZone: 'America/Denver',
  refs: [
    { label: 'MST', name: 'Standard time', offset: -420 },
    { label: 'MDT', name: 'Daylight Saving time', offset: -360 },
  ],
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

const state = {
  loc: LOCATION,
  year,
  doy: Math.min(dayOfYear(new Date()), daysInYear(year)),
};
state.offset = solarNoonOffset(state);

// 12-hour (AM/PM) is the default; the choice is remembered per browser.
const HOUR12_KEY = 'daylight.hour12';
try {
  state.hour12 = localStorage.getItem(HOUR12_KEY) !== 'false';
} catch {
  state.hour12 = true;
}

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

  wheel.render({
    T0: minutes.solarNoon,
    events: minutes,
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
    ? fmtDuration(minutes.sunset - minutes.sunrise) : '—';
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

$('location').textContent = `${state.loc.name} (${state.loc.zip})`;
$('reset').addEventListener('click', () => {
  state.offset = solarNoonOffset(state);
  update();
});
$('reset').after(...state.loc.refs.map((ref) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = `Snap to ${ref.name} (${ref.label})`;
  button.addEventListener('click', () => {
    state.offset = ref.offset;
    update();
  });
  return button;
}));
$('hour-format').addEventListener('click', () => {
  state.hour12 = !state.hour12;
  try {
    localStorage.setItem(HOUR12_KEY, state.hour12);
  } catch {
    // Storage unavailable (private mode etc.); the choice just won't persist.
  }
  update();
});
initSlider();
update();
