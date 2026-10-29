import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The domain folder is plain logic: no framework, no database, no browser. Keeping it
    // that way is what lets the scheduling engine be tested hard and run anywhere.
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'next', 'next/*', '@supabase/*', 'server-only', 'pg'],
              message: 'src/domain must stay free of framework and database code.',
            },
            {
              group: ['@/app/*', '@/server/*', '@/components/*'],
              message: 'src/domain must not depend on the layers above it.',
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'node_modules/**',
    'supabase/**',
    // What a run of the browser suite leaves behind.
    'test-results/**',
    'playwright-report/**',
    'e2e/.auth/**',
  ]),
]);
