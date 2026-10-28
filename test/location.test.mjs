// Checks ZIP lookups against data/zips.txt and tzRefs() against known zones.
import { lookupZip, tzRefs } from '../js/location.js';
import { solarEvents, polarConditions, dayOfYearToDate } from '../js/solar.js';

// [zip, place, state, time zone, lat, lon] from GeoNames.
const ZIPS = [
  ['80005', 'Arvada', 'CO', 'America/Denver', 39.84, -105.11],
  ['85001', 'Phoenix', 'AZ', 'America/Phoenix', 33.45, -112.07],
  ['79901', 'El Paso', 'TX', 'America/Denver', 31.76, -106.48],
  ['32501', 'Pensacola', 'FL', 'America/Chicago', 30.42, -87.22],
  ['46401', 'Gary', 'IN', 'America/Chicago', 41.59, -87.32],
  ['83814', "Coeur d'Alene", 'ID', 'America/Los_Angeles', 47.69, -116.78],
  ['96813', 'Honolulu', 'HI', 'Pacific/Honolulu', 21.32, -157.85],
  ['10001', 'New York', 'NY', 'America/New_York', 40.75, -74.00],
  ['00501', 'Holtsville', 'NY', 'America/New_York', 40.82, -73.05],
];

const near = (a, b) => Math.abs(a - b) <= 0.011;

export async function run() {
  const results = [];
  const check = (name, pass, detail) => results.push({ name, pass, detail });

  for (const [zip, place, st, tz, lat, lon] of ZIPS) {
    const loc = await lookupZip(zip);
    check(`lookupZip ${zip}`,
      loc != null && loc.place === place && loc.state === st && loc.timeZone === tz &&
        near(loc.lat, lat) && near(loc.lon, lon),
      JSON.stringify(loc));
  }
  check('lookupZip 00000 not found', (await lookupZip('00000')) === null, '');

  const refs = (tz) => tzRefs(tz, 2026).map((r) => `${r.label}${r.offset}`).join(',');
  check('tzRefs Denver', refs('America/Denver') === 'MST-420,MDT-360', refs('America/Denver'));
  check('tzRefs New York', refs('America/New_York') === 'EST-300,EDT-240', refs('America/New_York'));
  check('tzRefs Phoenix', refs('America/Phoenix') === 'MST-420', refs('America/Phoenix'));
  check('tzRefs Honolulu', refs('Pacific/Honolulu') === 'HST-600', refs('Pacific/Honolulu'));

  // Utqiagvik (71.29N): midnight sun in June, polar night in December.
  const lat = 71.29;
  const lon = -156.79;
  const june = dayOfYearToDate(2026, 172);
  const dec = dayOfYearToDate(2026, 355);
  const pj = polarConditions(june, lat, lon);
  const pd = polarConditions(dec, lat, lon);
  check('polar day in June', pj.sun === 'day' && solarEvents(june, lat, lon).sunrise === null,
    JSON.stringify(pj));
  check('polar night in December', pd.sun === 'night' && pd.civil === null,
    JSON.stringify(pd));
  const denver = polarConditions(june, 39.84, -105.11);
  check('no polar conditions in Denver', denver.sun === null && denver.civil === null,
    JSON.stringify(denver));
  return results;
}
