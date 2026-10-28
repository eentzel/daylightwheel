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
    { label: 'MST', offset: -420 },
    { label: 'MDT', offset: -360 },
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

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');

function fmtClock(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

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

const legalFmt = (timeZone) => new Intl.DateTimeFormat('en-US', {
  timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
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
  });

  $('day-label').textContent = dateFmt.format(dayStart);
  $('offset').textContent = offsetText(offset, loc.refs);

  const legal = legalFmt(loc.timeZone);
  $('readout-body').replaceChildren(...EVENTS.map(([key, label]) => {
    const tr = document.createElement('tr');
    const cells = events[key]
      ? [label, fmtClock(minutes[key] + offset), legal.format(events[key])]
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
initSlider();
update();
