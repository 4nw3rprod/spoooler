import type {NextConfig} from 'next';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

// The reel generator runs as a child process and serves rendered MP4s plus assets
// from filesystem locations OUTSIDE Next.js's own public/ folder (the Remotion
// project's public/ at the parent dir). The /api/file route handler streams those
// files after path validation.
//
// Pin the tracing root to this app's directory so Next.js doesn't bundle the entire
// parent Remotion workspace into traces (it would otherwise warn about the parent
// package-lock.json and select the wrong root).
const config: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: ROOT,
  transpilePackages: ['3dsvg', '@untitledui/icons', '@untitledui/file-icons'],
  // 3dsvg's package.json exports map omits a default/require condition, so Next's
  // resolver rejects the bare "3dsvg" specifier ("Package path . is not exported").
  // Alias it straight to the built ESM entry to bypass the exports map.
  webpack: (cfg) => {
    cfg.resolve = cfg.resolve || {};
    cfg.resolve.alias = {
      ...(cfg.resolve.alias || {}),
      '3dsvg$': join(ROOT, 'node_modules/3dsvg/dist/index.js'),
    };
    return cfg;
  },
};

export default config;
