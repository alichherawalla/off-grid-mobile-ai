module.exports = {
  root: true,
  extends: '@react-native',
  plugins: [
    'react-native',
    'react',
    'react-hooks',
  ],
  env: {
    jest: true,
    browser: true,
    node: true,
    es6: true,
  },
  rules: {
    // TypeScript
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      },
    ],
    'no-shadow': 'off',
    '@typescript-eslint/no-shadow': 'error',

    // Code quality (built-in)
    'no-empty': 'error',
    'no-else-return': 'error',
    'prefer-template': 'error',
    complexity: ['error', 15],
    'max-lines-per-function': ['error', 250],
    'max-lines': ['error', 350],
    'max-params': ['error', 3],
    // React hooks
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',

    // React Native
    'react-native/no-unused-styles': 'error',
    'react-native/no-inline-styles': 'error',
    'react-native/no-color-literals': 'error',
    'react-native/no-raw-text': 'error',
    'react-native/no-single-element-style-arrays': 'error',
  },
  overrides: [
    {
      // Relax structural rules in test files — large test suites and helpers are acceptable
      files: ['__tests__/**/*', '*.test.ts', '*.test.tsx', 'jest.setup.ts'],
      rules: {
        'max-lines': 'off',
        'max-lines-per-function': 'off',
        'max-params': 'off',
        complexity: 'off',
        'react-native/no-inline-styles': 'off',
        'react-native/no-raw-text': 'off',
        'react-native/no-color-literals': 'off',
      },
    },
  ],
};
