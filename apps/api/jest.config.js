/** Unit tests: no database, Redis or network. */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/unit/**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }] },
  setupFiles: ['<rootDir>/test/setup-env.ts'],
};
