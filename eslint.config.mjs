// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/coverage/**', '.local/**', '**/next-env.d.ts', '**/playwright-report/**', '**/test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Money must never pass through floating point, and raw SQL must be parameterised.
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.name='parseFloat']", message: 'Do not use parseFloat; use Decimal (packages/shared money helpers).' },
        { selector: "CallExpression[callee.property.name='$queryRawUnsafe']", message: 'Use tagged $queryRaw; never build SQL from strings.' },
        { selector: "CallExpression[callee.property.name='$executeRawUnsafe']", message: 'Use tagged $executeRaw; never build SQL from strings.' },
      ],
    },
  },
  { files: ['**/*.js', '**/*.cjs', '**/*.mjs'], rules: { '@typescript-eslint/no-require-imports': 'off', 'no-undef': 'off' } },
);
