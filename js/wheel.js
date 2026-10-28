// The sun/clock wheel. One turn = 24 h, angles clockwise from the top.
//
// The frame is the sun: angle(t) = (t_UTC - T0) / 4, where T0 is the day's
// solar noon in UTC minutes, so solar noon is always at the top. The outer
// ring (sun) is drawn in that frame; the inner ring (clock) is rotated so that
// clock time c sits over the UTC instant c - offset. With a fixed offset, the
// clock therefore drifts a few degrees through the year (equation of time).

const NS = 'http://www.w3.org/2000/svg';

const R = {
  ringOuter: 172,
  ringInner: 140,
  clock: 132,
  numeral: 112,
  label: 190,
  labelFar: 206,
};

const SNAP_TO_REF_MIN = 2;

const MARKERS = [
  { key: 'dawn', label: 'Dawn', far: true },
  { key: 'sunrise', label: 'Sunrise' },
  { key: 'solarNoon', label: 'Solar noon' },
  { key: 'sunset', label: 'Sunset' },
  { key: 'dusk', label: 'Dusk', far: true },
];

function setAttrs(node, attrs) {
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
}

function el(name, attrs, parent, text) {
  const node = document.createElementNS(NS, name);
  setAttrs(node, attrs);
  if (text != null) node.textContent = text;
  parent.appendChild(node);
  return node;
}

function polar(r, deg) {
  const a = deg * Math.PI / 180;
  return [r * Math.sin(a), -r * Math.cos(a)];
}

// Full annulus; the inner circle winds the other way to leave a hole.
function ringPath(r1, r2) {
  return `M0 ${-r2} A${r2} ${r2} 0 1 1 0 ${r2} A${r2} ${r2} 0 1 1 0 ${-r2} Z ` +
    `M0 ${-r1} A${r1} ${r1} 0 1 0 0 ${r1} A${r1} ${r1} 0 1 0 0 ${-r1} Z`;
}

// Clockwise annulus segment from angle a1 to a2 (degrees).
function annulusPath(r1, r2, a1, a2) {
  const span = ((a2 - a1) % 360 + 360) % 360;
  const large = span > 180 ? 1 : 0;
  const [x1, y1] = polar(r2, a1);
  const [x2, y2] = polar(r2, a1 + span);
  const [x3, y3] = polar(r1, a1 + span);
  const [x4, y4] = polar(r1, a1);
  return `M${x1} ${y1} A${r2} ${r2} 0 ${large} 1 ${x2} ${y2} ` +
    `L${x3} ${y3} A${r1} ${r1} 0 ${large} 0 ${x4} ${y4} Z`;
}

// Offsets are kept within one day, in [-720, 720) minutes.
function wrapOffset(offset) {
  return ((offset + 720) % 1440 + 1440) % 1440 - 720;
}

function snapOffset(raw, { coarse, refs }) {
  raw = wrapOffset(raw);
  if (coarse) return wrapOffset(Math.round(raw / 15) * 15);
  for (const ref of refs) {
    if (Math.abs(raw - ref.offset) <= SNAP_TO_REF_MIN) return ref.offset;
  }
  return Math.round(raw);
}

export function createWheel(svg, { onOffsetChange }) {
  svg.setAttribute('viewBox', '-280 -225 560 450');

  const ring = el('g', { class: 'sun-ring' }, svg);
  el('circle', { r: (R.ringOuter + R.ringInner) / 2, class: 'night',
    'stroke-width': R.ringOuter - R.ringInner, fill: 'none' }, ring);
  const twilightArc = el('path', { class: 'twilight' }, ring);
  const dayArc = el('path', { class: 'day' }, ring);

  const clock = el('g', {
    class: 'clock', tabindex: 0, role: 'slider',
    'aria-label': 'Clock alignment (UTC offset in minutes)',
  }, svg);
  el('circle', { r: R.clock, class: 'clock-face' }, clock);
  for (let m = 0; m < 1440; m += 15) {
    const deg = (m - 720) / 4;
    const len = m % 60 === 0 ? 12 : 5;
    const [x1, y1] = polar(R.clock, deg);
    const [x2, y2] = polar(R.clock - len, deg);
    el('line', { x1, y1, x2, y2, class: m % 60 === 0 ? 'tick hour' : 'tick' }, clock);
  }
  const numerals = [];
  for (let h = 0; h < 24; h++) {
    const [x, y] = polar(R.numeral, (h * 60 - 720) / 4);
    numerals.push(el('text', { x, y, class: h === 12 ? 'numeral noon' : 'numeral',
      'text-anchor': 'middle', 'dominant-baseline': 'central' }, clock));
  }
  // In 12-hour mode the left half of the dial (midnight -> noon) is AM.
  const halfLabels = ['AM', 'PM'].map((text, i) => {
    const [x, y] = polar(R.numeral - 40, i === 0 ? -90 : 90);
    return el('text', { x, y, class: 'half-label',
      'text-anchor': 'middle', 'dominant-baseline': 'central' }, clock, text);
  });
  el('path', { d: `M0 ${-R.numeral + 14} l-6 10 h12 z`, class: 'noon-pointer' }, clock);
  el('circle', { r: 3, class: 'hub' }, clock);

  // Fixed overlays, drawn above the clock: reference notches and event markers.
  const refLayer = el('g', { class: 'refs' }, svg);
  const markerLayer = el('g', { class: 'markers' }, svg);
  const markerEls = MARKERS.map((m) => {
    const g = el('g', { class: `marker ${m.key}` }, markerLayer);
    return {
      ...m,
      g,
      line: el('line', {}, g),
      text: el('text', { 'dominant-baseline': 'central' }, g, m.label),
    };
  });

  let model = null;

  function toAngle(utcMin) {
    return (utcMin - model.T0) / 4;
  }

  function clockAngle(offset) {
    return toAngle(720 - offset);
  }

  function render(next) {
    model = next;
    const { events, offset, refs } = model;
    const allDay = model.polar; // polar day/night conditions

    // An arc between the two events, or the whole ring if the sun stays
    // above the threshold all day (polar day), or nothing (polar night).
    const arc = (start, end, condition) => {
      if (start != null && end != null) {
        return annulusPath(R.ringInner, R.ringOuter, toAngle(start), toAngle(end));
      }
      return condition === 'day' ? ringPath(R.ringInner, R.ringOuter) : '';
    };
    dayArc.setAttribute('d', arc(events.sunrise, events.sunset, allDay.sun));
    twilightArc.setAttribute('d', arc(events.dawn, events.dusk, allDay.civil));

    for (const m of markerEls) {
      const t = events[m.key];
      m.g.style.display = t == null ? 'none' : '';
      if (t == null) continue;
      const deg = toAngle(t);
      const [x1, y1] = polar(R.ringOuter + 4, deg);
      const [x2, y2] = polar(R.clock - 16, deg);
      setAttrs(m.line, { x1, y1, x2, y2 });
      const [x, y] = polar(m.far ? R.labelFar : R.label, deg);
      const s = Math.sin(deg * Math.PI / 180);
      setAttrs(m.text, { x, y, 'text-anchor': Math.abs(s) < 0.2 ? 'middle' : s > 0 ? 'start' : 'end' });
    }

    refLayer.replaceChildren();
    for (const ref of refs) {
      const g = el('g', { transform: `rotate(${clockAngle(ref.offset)})`, class: 'ref' }, refLayer);
      el('path', { d: `M0 ${-R.clock - 1} l-5 -8 h10 z` }, g);
      el('text', { x: 0, y: -R.ringInner - 18, 'text-anchor': 'middle' }, g, ref.label);
    }

    numerals.forEach((t, h) => { t.textContent = model.hour12 ? h % 12 || 12 : h; });
    halfLabels.forEach((t) => { t.style.display = model.hour12 ? '' : 'none'; });

    setAttrs(clock, {
      transform: `rotate(${clockAngle(offset)})`,
      'aria-valuenow': offset,
      'aria-valuetext': model.offsetText,
    });
  }

  // Dragging: track the cumulative unwrapped rotation since pointerdown.
  let drag = null;

  function pointerAngle(evt) {
    const pt = new DOMPoint(evt.clientX, evt.clientY).matrixTransform(svg.getScreenCTM().inverse());
    return Math.atan2(pt.x, -pt.y) * 180 / Math.PI;
  }

  clock.addEventListener('pointerdown', (evt) => {
    clock.setPointerCapture(evt.pointerId);
    clock.classList.add('dragging');
    drag = { last: pointerAngle(evt), turned: 0, startOffset: model.offset };
  });

  clock.addEventListener('pointermove', (evt) => {
    if (!drag) return;
    const a = pointerAngle(evt);
    let d = a - drag.last;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    drag.turned += d;
    drag.last = a;
    // Turning clockwise by 1 degree moves clock noon 4 minutes later in UTC,
    // i.e. lowers the offset by 4 minutes.
    const raw = drag.startOffset - drag.turned * 4;
    onOffsetChange(snapOffset(raw, { coarse: evt.shiftKey, refs: model.refs }));
  });

  const endDrag = () => {
    drag = null;
    clock.classList.remove('dragging');
  };
  clock.addEventListener('pointerup', endDrag);
  clock.addEventListener('pointercancel', endDrag);

  clock.addEventListener('keydown', (evt) => {
    const step = evt.shiftKey ? 15 : 1;
    const delta = { ArrowRight: -step, ArrowUp: step, ArrowLeft: step, ArrowDown: -step }[evt.key];
    if (delta == null) return;
    evt.preventDefault();
    onOffsetChange(wrapOffset(model.offset + delta));
  });

  return { render };
}
