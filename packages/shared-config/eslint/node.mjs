import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Flat config preset for the NestJS TypeScript API. */
export default function nodePreset() {
  return tseslint.config(js.configs.recommended, ...tseslint.configs.recommended, {
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  });
}
