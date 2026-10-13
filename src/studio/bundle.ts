import { fileURLToPath } from 'node:url';

const ENTRY = fileURLToPath(new URL('./client/main.tsx', import.meta.url));

/** The studio page's script: React, the Remotion player and the video components, in one file. */
export async function bundleClient(): Promise<string> {
  const { build } = await import('esbuild');
  const result = await build({
    entryPoints: [ENTRY],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    jsx: 'automatic',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}
