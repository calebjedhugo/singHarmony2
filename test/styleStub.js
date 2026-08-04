/**
 * Vite turns `import './style.css'` into a stylesheet link; jest has no loader
 * for CSS, so main.test.js maps the import here. Nothing reads the export —
 * the styles themselves are not under test.
 */
module.exports = {};
