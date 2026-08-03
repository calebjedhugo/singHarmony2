export default {
  testEnvironment: 'jsdom',
  transform: { '^.+\\.m?js$': 'babel-jest' },
  // Both resound packages ship ESM; babel-jest skips node_modules by default.
  transformIgnorePatterns: ['/node_modules/(?!(resound-notation|resound-sound)/)'],
  moduleFileExtensions: ['js', 'mjs', 'json'],
  testMatch: ['**/src/**/*.test.js', '**/scripts/**/*.test.mjs'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
