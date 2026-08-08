/** @jest-environment jsdom */

/**
 * The key picker, driven through the real index.html markup.
 */
import { mountApp } from '../../test/appMarkup.js';
import { createKeyWheel } from './keyWheel.js';

const $ = (sel) => document.querySelector(sel);
// jsdom SVG elements don't implement HTMLElement.click().
const tap = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

function setup() {
  mountApp();
  const picks = [];
  const wheel = createKeyWheel({ onPick: (key) => picks.push(key) });
  wheel.showSong({ original: 'G', current: 'G', mode: 'major' });
  return { wheel, picks };
}

describe('key wheel', () => {
  test('renders twelve wedges in fifths order and marks the original', () => {
    setup();
    const wedges = [...document.querySelectorAll('.kw-wedge')];
    expect(wedges.map((w) => w.dataset.key)).toEqual(
      ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'],
    );
    const g = wedges.find((w) => w.dataset.key === 'G');
    expect(g.classList.contains('kw-original')).toBe(true);
    expect(g.classList.contains('kw-current')).toBe(true);
    expect($('#keyBtn').textContent).toBe('G');
  });

  test('opens from the key chip, picks a key, and closes', () => {
    const { picks } = setup();
    expect($('#keyPopover').hidden).toBe(true);
    $('#keyBtn').click();
    expect($('#keyPopover').hidden).toBe(false);
    tap(document.querySelector('.kw-wedge[data-key="A"]'));
    expect(picks).toEqual(['A']);
    expect($('#keyPopover').hidden).toBe(true);
  });

  test('backdrop click and Escape both dismiss without picking', () => {
    const { picks } = setup();
    $('#keyBtn').click();
    $('#keyPopover').click(); // backdrop, not the card
    expect($('#keyPopover').hidden).toBe(true);
    $('#keyBtn').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect($('#keyPopover').hidden).toBe(true);
    expect(picks).toEqual([]);
  });

  test('setCurrent marks the chip as rekeyed; original key clears it', () => {
    const { wheel } = setup();
    wheel.setCurrent('A');
    expect($('#keyBtn').textContent).toBe('A');
    expect($('#keyBtn').classList.contains('rekeyed')).toBe(true);
    expect(document.querySelector('.kw-wedge[data-key="A"]').classList.contains('kw-current')).toBe(true);
    expect(document.querySelector('.kw-wedge[data-key="G"]').classList.contains('kw-original')).toBe(true);
    wheel.setCurrent('G');
    expect($('#keyBtn').classList.contains('rekeyed')).toBe(false);
  });

  test('minor hymns label the wheel with relative minors', () => {
    mountApp();
    const wheel = createKeyWheel({ onPick: () => {} });
    wheel.showSong({ original: 'G', current: 'G', mode: 'minor' });
    const g = document.querySelector('.kw-wedge[data-key="G"] text');
    expect(g.textContent).toBe('Em');
    expect(document.querySelector('.kw-center').textContent).toBe('Em');
  });

  test('busy state disables the chip', () => {
    const { wheel } = setup();
    wheel.setBusy(true);
    expect($('#keyBtn').disabled).toBe(true);
    wheel.setBusy(false);
    expect($('#keyBtn').disabled).toBe(false);
  });
});
