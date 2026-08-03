// Jest only — Vite compiles the app itself. Must stay .cjs: package.json sets
// "type": "module", so a .js config would be parsed as ESM and fail to load.
module.exports = {
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
};
