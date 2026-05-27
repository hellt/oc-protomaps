import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function normalizeBasePath(basePath: string | undefined): string {
  if (!basePath) {
    return '/';
  }

  const withLeadingSlash = /^[a-z]+:\/\//i.test(basePath) || basePath.startsWith('/')
    ? basePath
    : `/${basePath}`;

  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}

export default defineConfig({
  base: normalizeBasePath(process.env.BASE_PATH),
  plugins: [react()],
});
