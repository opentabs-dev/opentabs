import { fixupConfigRules } from '@eslint/compat';
import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import { flatConfigs as importXFlatConfig } from 'eslint-plugin-import-x';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import reactPlugin from 'eslint-plugin-react';
import { browser, es2020, node } from 'globals';
import tseslint from 'typescript-eslint';
import type { FixupConfigArray } from '@eslint/compat';

export default tseslint.config(
  // Shared configs
  js.configs.recommended,
  ...tseslint.configs.recommended,
  jsxA11y.flatConfigs.recommended,
  importXFlatConfig.recommended,
  importXFlatConfig.typescript,
  eslintPluginPrettierRecommended,
  ...fixupConfigRules(new FlatCompat().extends('plugin:react-hooks/recommended') as FixupConfigArray),
  {
    files: ['**/*.{ts,tsx}'],
    ...reactPlugin.configs.flat.recommended,
    ...reactPlugin.configs.flat['jsx-runtime'],
  },
  // Custom config
  {
    ignores: [
      '**/build/**',
      '**/dist/**',
      '**/node_modules/**',
      'chrome-extension/manifest.js',
      '**/*.test.ts',
      '**/*.spec.ts',
      '__next__/platform/create-plugin/template/**',
      '__next__/platform/browser-extension/build.ts',
      '__next__/platform/browser-extension/__generated__/**',
      '__next__/platform/*/scripts/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
        projectService: {
          allowDefaultProject: ['knip.ts'],
        },
      },
      globals: {
        ...browser,
        ...es2020,
        ...node,
        chrome: 'readonly',
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      'func-style': ['error', 'expression', { allowArrowFunctions: true }],
      'no-restricted-imports': [
        'error',
        {
          name: 'type-fest',
          message: 'Please import from `@extension/shared` instead of `type-fest`.',
        },
      ],
      'arrow-body-style': ['error', 'as-needed'],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/consistent-type-exports': 'error',
      'import-x/order': [
        'error',
        {
          'newlines-between': 'never',
          alphabetize: { order: 'asc', caseInsensitive: true },
          groups: ['index', 'sibling', 'parent', 'internal', 'external', 'builtin', 'object', 'type'],
          pathGroups: [
            {
              pattern: '@*/**',
              group: 'internal',
              position: 'before',
            },
          ],
          pathGroupsExcludedImportTypes: ['type'],
        },
      ],
      'import-x/no-unresolved': 'off',
      'import-x/no-named-as-default': 'error',
      'import-x/no-named-as-default-member': 'error',
      'import-x/newline-after-import': 'error',
      'import-x/no-deprecated': 'error',
      'import-x/no-duplicates': ['error', { considerQueryString: true, 'prefer-inline': false }],
      'import-x/consistent-type-specifier-style': 'error',
      'import-x/exports-last': 'error',
      'import-x/first': 'error',
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  // Overrides Rules
  {
    files: ['**/packages/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  // Node.js scripts
  {
    files: ['**/*.mjs', '**/scripts/**/*.{js,mjs}'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
  },
  // ESLint config file - typescript-eslint recommends using tseslint.config() pattern
  // which requires accessing properties on the default export
  {
    files: ['eslint.config.ts'],
    rules: {
      'import-x/no-named-as-default-member': 'off',
    },
  },
  // MCP server http-server.ts uses SSE transport which is deprecated but required
  // for Claude Code compatibility (Claude Code expects type: "sse" in config)
  {
    files: ['**/packages/mcp-server/src/http-server.ts', '**/platform/mcp-server/src/http-server.ts'],
    rules: {
      'import-x/no-deprecated': 'off',
      'import-x/no-named-as-default-member': 'off',
    },
  },
  // Plugin-loader manifest-schema.ts uses Zod issue codes that are marked deprecated
  // in Zod v4 but are the correct API for superRefine cross-field validation
  {
    files: ['**/platform/plugin-loader/src/manifest-schema.ts'],
    rules: {
      'import-x/no-deprecated': 'off',
    },
  },
  // shadcn/ui components use function declarations and have accessibility patterns
  // that conflict with our general rules - this is acceptable per CLAUDE.md
  {
    files: ['**/packages/ui/lib/components/ui/**/*.tsx', '**/packages/ui/lib/hooks/**/*.ts'],
    rules: {
      'func-style': 'off',
      'jsx-a11y/click-events-have-key-events': 'off',
      'jsx-a11y/no-noninteractive-element-interactions': 'off',
      'jsx-a11y/anchor-has-content': 'off',
      'import-x/exports-last': 'off',
    },
  },
);
