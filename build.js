import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/worker.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'dist/worker.js',
  platform: 'browser',
  target: 'es2022',
  minify: false,
  sourcemap: true,
  external: [],
  define: {
    'process.env.NODE_ENV': '"production"'
  }
});

console.log('✓ Build completed successfully');
