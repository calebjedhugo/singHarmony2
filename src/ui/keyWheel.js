/**
 * The key picker: a circle of fifths behind the header's key chip. Twelve
 * fat wedges (finger-sized on a phone), the original key ringed, the current
 * key filled. Picking a wedge hands the signature to the shell; everything
 * musical happens elsewhere (rekey.js -> resound-harmony).
 */

import { KEYS, RELATIVE_MINOR } from '../rekey.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CX = 100, CY = 100, R_OUT = 96, R_IN = 44, R_LABEL = 70;

const point = (r, deg) => {
  const rad = (deg - 90) * (Math.PI / 180);
  return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)];
};

/** Donut-wedge path centered on `deg`, 30 degrees wide. */
function wedgePath(deg) {
  const [x1, y1] = point(R_OUT, deg - 15);
  const [x2, y2] = point(R_OUT, deg + 15);
  const [x3, y3] = point(R_IN, deg + 15);
  const [x4, y4] = point(R_IN, deg - 15);
  return `M${x1} ${y1} A${R_OUT} ${R_OUT} 0 0 1 ${x2} ${y2} L${x3} ${y3} A${R_IN} ${R_IN} 0 0 0 ${x4} ${y4} Z`;
}

/**
 * @param {object} opts
 * @param {(key: string) => void} opts.onPick called with the chosen signature
 */
export function createKeyWheel({ onPick }) {
  const btn = document.querySelector('#keyBtn');
  const popover = document.querySelector('#keyPopover');
  const wheelEl = document.querySelector('#keyWheel');

  let original = null;
  let current = null;
  let mode = 'major';
  const wedges = new Map(); // key -> { group, label }

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 200 200');
  svg.setAttribute('role', 'listbox');
  svg.setAttribute('aria-label', 'Key');
  for (let i = 0; i < KEYS.length; i++) {
    const key = KEYS[i];
    const deg = i * 30;
    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'kw-wedge');
    group.setAttribute('data-key', key);
    group.setAttribute('role', 'option');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', wedgePath(deg));
    const label = document.createElementNS(SVG_NS, 'text');
    const [lx, ly] = point(R_LABEL, deg);
    label.setAttribute('x', lx);
    label.setAttribute('y', ly);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'central');
    group.append(path, label);
    group.addEventListener('click', () => {
      hide();
      onPick(key);
    });
    svg.appendChild(group);
    wedges.set(key, { group, label });
  }
  // Center readout: the current key.
  const center = document.createElementNS(SVG_NS, 'text');
  center.setAttribute('x', CX);
  center.setAttribute('y', CY);
  center.setAttribute('text-anchor', 'middle');
  center.setAttribute('dominant-baseline', 'central');
  center.setAttribute('class', 'kw-center');
  svg.appendChild(center);
  wheelEl.appendChild(svg);

  function labelFor(key) {
    return mode === 'minor' ? RELATIVE_MINOR[key] : key;
  }

  function paint() {
    for (const [key, { group, label }] of wedges) {
      label.textContent = labelFor(key);
      group.classList.toggle('kw-current', key === current);
      group.classList.toggle('kw-original', key === original);
    }
    center.textContent = current ? labelFor(current) : '';
    btn.textContent = current || '';
    btn.classList.toggle('rekeyed', current !== null && current !== original);
    btn.title = current !== original
      ? `Change key (original: ${labelFor(original)})`
      : 'Change key';
  }

  function show() { popover.hidden = false; }
  function hide() { popover.hidden = true; }

  btn.addEventListener('click', () => {
    if (current) show();
  });
  // Tap the backdrop (not the card) to dismiss.
  popover.addEventListener('click', (ev) => {
    if (ev.target === popover) hide();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !popover.hidden) hide();
  });

  return {
    /** A song was opened: remember its home key and display mode. */
    showSong({ original: orig, current: cur, mode: songMode }) {
      original = orig;
      current = cur;
      mode = songMode || 'major';
      paint();
    },
    /** The displayed key changed (after a successful rekey). */
    setCurrent(key) {
      current = key;
      paint();
    },
    /** Rewriting takes a moment: reflect it on the chip. */
    setBusy(busy) {
      btn.classList.toggle('busy', busy);
      btn.disabled = busy;
    },
    hide,
  };
}
