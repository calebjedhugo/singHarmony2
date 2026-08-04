export default {
  testEnvironment: 'jsdom',
  setupFiles: ['<rootDir>/test/audioMocks.js', '<rootDir>/test/domShims.js'],
  transform: { '^.+\\.m?js$': 'babel-jest' },
  // main.js imports its stylesheet the way Vite expects; jest can't parse CSS.
  moduleNameMapper: { '\\.css$': '<rootDir>/test/styleStub.js' },
  // Both resound packages ship ESM; babel-jest skips node_modules by default.
  transformIgnorePatterns: ['/node_modules/(?!(resound-notation|resound-sound)/)'],
  moduleFileExtensions: ['js', 'mjs', 'json'],
  testMatch: ['**/src/**/*.test.js', '**/scripts/**/*.test.mjs'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
