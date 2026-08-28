import eslint from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Config files are plain JavaScript that no tsconfig covers, and typed linting
// fails hard on anything it cannot find a program for.
const ignores = ['dist', 'node_modules', '**/*.mjs', 'eslint.config.js'];

// projectService discovers the tsconfig covering each file, rather than making
// every package restate the growing list of its own projects.
export function createBaseConfig({ tsconfigRootDir }) {
  return tseslint.config(
    { ignores },
    eslint.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    {
      languageOptions: {
        ecmaVersion: 2022,
        globals: {
          ...globals.browser,
          ...globals.es2022,
          chrome: 'readonly',
        },
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
      },
    },
    {
      files: ['**/*.{ts,tsx}'],
      rules: {
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
      },
    },
  );
}

export function createReactConfig(options) {
  return tseslint.config(...createBaseConfig(options), {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  });
}
