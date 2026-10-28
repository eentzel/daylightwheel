// Sun position and rise/set times, after the NOAA Solar Calculator
// (https://gml.noaa.gov/grad/solcalc/). Pure functions, no DOM.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

// Zenith angles (degrees) at which each event happens.
const ZENITH = {
  sunrise: 90.833, // geometric horizon + refraction + solar radius
  civil: 96,
};

export function dayOfYearToDate(year, doy) {
  return new Date(Date.UTC(year, 0, doy));
}

export function daysInYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

export function dayOfYear(date) {
  return Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
    Date.UTC(date.getFullYear(), 0, 0)) / 86400000);
}

// Minutes since 00:00 UTC on the day `dayStart`; may be negative or exceed 1440.
export function minutesUTC(date, dayStart) {
  return (date - dayStart) / 60000;
}

function julianDay(ms) {
  return ms / 86400000 + 2440587.5;
}

// Equation of time (minutes) and declination (radians) at an instant.
function sunParams(ms) {
  const T = (julianDay(ms) - 2451545) / 36525;
  const L0 = ((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360) * RAD;
  const M = (357.52911 + T * (35999.05029 - 0.0001537 * T)) * RAD;
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * M) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * M) * 0.000289;
  const omega = (125.04 - 1934.136 * T) * RAD;
  const lambda = (L0 * DEG + C - 0.00569 - 0.00478 * Math.sin(omega)) * RAD;
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = (eps0 + 0.00256 * Math.cos(omega)) * RAD;

  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const y = Math.tan(eps / 2) ** 2;
  const eqTime = 4 * DEG * (y * Math.sin(2 * L0) -
    2 * e * Math.sin(M) +
    4 * e * y * Math.sin(M) * Math.cos(2 * L0) -
    0.5 * y * y * Math.sin(4 * L0) -
    1.25 * e * e * Math.sin(2 * M));
  return { eqTime, decl };
}

// UTC minutes of solar noon, refined by evaluating the sun at the estimate.
function solarNoonMin(dayMs, lon) {
  let t = 720 - 4 * lon;
  for (let i = 0; i < 2; i++) {
    t = 720 - 4 * lon - sunParams(dayMs + t * 60000).eqTime;
  }
  return t;
}

// UTC minutes when the sun crosses `zenith` (degrees); dir -1 = morning, +1 = evening.
// If it never does, returns 'day' (sun stays above) or 'night' (stays below).
function crossingMin(dayMs, lat, lon, zenith, dir) {
  let t = solarNoonMin(dayMs, lon) + dir * 360;
  for (let i = 0; i < 3; i++) {
    const { eqTime, decl } = sunParams(dayMs + t * 60000);
    const cosH = Math.cos(zenith * RAD) / (Math.cos(lat * RAD) * Math.cos(decl)) -
      Math.tan(lat * RAD) * Math.tan(decl);
    if (cosH < -1) return 'day';
    if (cosH > 1) return 'night';
    const ha = Math.acos(cosH) * DEG;
    t = 720 - 4 * (lon - dir * ha) - eqTime;
  }
  return t;
}

// Event instants for the UTC calendar day starting at `dayStart` (a Date at 00:00 UTC).
// lon is degrees east (negative for the Americas). Events that don't happen
// (polar day/night) are null.
export function solarEvents(dayStart, lat, lon) {
  const dayMs = dayStart.getTime();
  const at = (min) => (typeof min === 'number' ? new Date(dayMs + min * 60000) : null);
  return {
    dawn: at(crossingMin(dayMs, lat, lon, ZENITH.civil, -1)),
    sunrise: at(crossingMin(dayMs, lat, lon, ZENITH.sunrise, -1)),
    solarNoon: at(solarNoonMin(dayMs, lon)),
    sunset: at(crossingMin(dayMs, lat, lon, ZENITH.sunrise, 1)),
    dusk: at(crossingMin(dayMs, lat, lon, ZENITH.civil, 1)),
  };
}

// For days without sunrise/sunset (or dawn/dusk): whether the sun stays above
// ('day') or below ('night') that threshold all day; null when it crosses.
export function polarConditions(dayStart, lat, lon) {
  const dayMs = dayStart.getTime();
  const state = (zenith) => {
    const v = crossingMin(dayMs, lat, lon, zenith, -1);
    return typeof v === 'number' ? null : v;
  };
  return { sun: state(ZENITH.sunrise), civil: state(ZENITH.civil) };
}
