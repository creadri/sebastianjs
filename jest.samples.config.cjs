module.exports = {
  testEnvironment: 'node',
  transform: {},
  setupFiles: ['./jest.setup.js'],
  transformIgnorePatterns: [],
  testPathIgnorePatterns: [],
  moduleNameMapper: {
    '^dompurify$': '<rootDir>/src/shims/dompurify.js',
  },
};
