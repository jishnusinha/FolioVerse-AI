import js from '@eslint/js';
import globals from 'globals';

/** Flat config preset for the React JS web app. Hex color literals are banned in feature code. */
export default function webPreset({ plugins = {}, rules = {} } = {}) {
  return [
    js.configs.recommended,
    {
      files: ['**/*.{js,jsx,mjs}'],
      languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        globals: { ...globals.browser, ...globals.node },
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      plugins,
      rules: {
        'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_|^React$' }],
        ...rules,
      },
    },
    {
      files: ['src/features/**/*.{js,jsx}'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: 'Literal[value=/^#[0-9a-fA-F]{3,8}$/]',
            message: 'Use --fv-* design tokens instead of hex colors.',
          },
        ],
      },
    },
  ];
}
