// ZIP code lookup against data/zips.txt (built by scripts/build-zips.py from
// GeoNames data), plus time zone reference offsets derived from Intl.

const DATA_URL = new URL('../data/zips.txt', import.meta.url);

let zipsPromise = null;

function parseZips(text) {
  const zips = new Map();
  let zones = [];
  let zip = 0;
  let lat = 0;
  let lon = 0;
  let place = '';
  let state = '';
  let timeZone = '';
  for (const line of text.split('\n')) {
    if (line.startsWith('#tz ')) {
      zones = line.slice(4).split('|');
      continue;
    }
    if (!line || line.startsWith('#')) continue;
    const [dz, dlat, dlon, p, s, tz] = line.split('\t');
    zip += Number(dz);
    lat += Number(dlat);
    lon += Number(dlon);
    if (p) place = p;
    if (s) state = s;
    if (tz) timeZone = zones[Number(tz)];
    const key = String(zip).padStart(5, '0');
    zips.set(key, { zip: key, place, state, lat: lat / 100, lon: lon / 100, timeZone });
  }
  return zips;
}

function loadZips() {
  zipsPromise ??= fetch(DATA_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    })
    .then(parseZips)
    .catch((err) => {
      zipsPromise = null; // allow a retry
      throw err;
    });
  return zipsPromise;
}

// Resolves to { zip, place, state, lat, lon, timeZone }, or null if unknown.
export async function lookupZip(zip) {
  const zips = await loadZips();
  return zips.get(zip) ?? null;
}

// UTC offset in minutes for `timeZone` at instant `date`.
function offsetAt(timeZone, date) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
    .formatToParts(date).find((p) => p.type === 'timeZoneName').value;
  const m = part.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!m) return 0; // plain "GMT"
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

function abbreviationAt(timeZone, date) {
  return new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
    .formatToParts(date).find((p) => p.type === 'timeZoneName').value;
}

// Standard and (if observed) daylight saving offsets for the year, as
// [{ label: 'MST', name: 'Standard time', offset: -420 }, ...].
export function tzRefs(timeZone, year) {
  const samples = [new Date(Date.UTC(year, 0, 15, 12)), new Date(Date.UTC(year, 6, 15, 12))]
    .map((date) => ({ offset: offsetAt(timeZone, date), label: abbreviationAt(timeZone, date) }))
    .sort((a, b) => a.offset - b.offset);
  const [standard, daylight] = samples;
  if (standard.offset === daylight.offset) {
    return [{ ...standard, name: 'Standard time' }];
  }
  return [
    { ...standard, name: 'Standard time' },
    { ...daylight, name: 'Daylight Saving time' },
  ];
}
