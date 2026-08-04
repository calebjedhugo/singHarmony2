/**
 * jsdom gaps that the app legitimately relies on in a browser.
 *
 * `Element.prototype.scrollIntoView` is not implemented by jsdom at all
 * (jsdom#1695), and Score._autoScroll calls it on the SVG system group when
 * the playback cursor crosses into a new system. Without this stub the whole
 * cursor path throws the moment a suite wires player.onTick to the score, the
 * way main.js does.
 */
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
