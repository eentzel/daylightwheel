// Checks solarEvents() for ZIP 80005 against the U.S. Naval Observatory
// (aa.usno.navy.mil/api/rstt/oneday, coords=39.85,-105.11). USNO rounds to the
// minute, so we allow ±1 min. Open test/index.html via a local server to run.
import { solarEvents } from '../js/solar.js';

const LAT = 39.85;
const LON = -105.11;

// [date, UTC offset (h), dawn, sunrise, solar noon, sunset, dusk] in local time.
const CASES = [
  ['2026-03-20', -6, '06:37', '07:04', '13:08', '19:13', '19:40'],
  ['2026-06-21', -6, '05:00', '05:32', '13:02', '20:32', '21:05'],
  ['2026-09-22', -6, '06:21', '06:48', '12:53', '18:57', '19:24'],
  ['2026-12-21', -7, '06:48', '07:18', '11:59', '16:39', '17:09'],
];
const KEYS = ['dawn', 'sunrise', 'solarNoon', 'sunset', 'dusk'];
const TOLERANCE_MIN = 1;

export function run() {
  const results = [];
  for (const [iso, tz, ...expected] of CASES) {
    const dayStart = new Date(`${iso}T00:00Z`);
    const events = solarEvents(dayStart, LAT, LON);
    KEYS.forEach((key, i) => {
      const local = (events[key] - dayStart) / 60000 + tz * 60;
      const [eh, em] = expected[i].split(':').map(Number);
      const diff = local - (eh * 60 + em);
      const r = Math.round(local);
      results.push({
        name: `${iso} ${key}`,
        pass: Math.abs(diff) <= TOLERANCE_MIN,
        detail: `expected ${expected[i]}, got ${r / 60 | 0}:${String(r % 60).padStart(2, '0')} (${diff.toFixed(2)} min)`,
      });
    });
  }
  return results;
}
