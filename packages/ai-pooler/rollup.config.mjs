import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import dts from 'rollup-plugin-dts';

const external = [
  '@rulecatch/core',
  'crypto',
  'child_process',
  'fs',
  'http',
  'https',
  'os',
  'path',
  'readline',
];

export default [
  // Main library
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/index.js',
        format: 'esm',
        sourcemap: true,
      },
      {
        file: 'dist/index.cjs',
        format: 'cjs',
        sourcemap: true,
      },
    ],
    plugins: [
      nodeResolve(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
      }),
    ],
    external,
  },
  // CLI entry point
  {
    input: 'src/cli.ts',
    output: {
      file: 'dist/cli.js',
      format: 'esm',
      sourcemap: true,
      banner: '#!/usr/bin/env node',
    },
    plugins: [
      nodeResolve(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
      }),
    ],
    external,
  },
  // Flush script (one-shot, copied to ~/.claude/hooks/rulecatch-flush.js)
  {
    input: 'src/flush.ts',
    output: {
      file: 'dist/flush.js',
      format: 'esm',
      sourcemap: true,
      banner: '#!/usr/bin/env node',
    },
    plugins: [
      nodeResolve(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
      }),
    ],
    external: [
      'crypto',
      'fs',
      'https',
      'os',
      'path',
    ],
  },
  // Type definitions
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.d.ts',
      format: 'es',
    },
    plugins: [dts()],
    external: ['@rulecatch/core'],
  },
];
