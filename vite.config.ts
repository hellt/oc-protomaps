import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cp, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Connect, Plugin } from 'vite';

import { cloudflare } from "@cloudflare/vite-plugin";

const servicesDir = path.resolve(__dirname, 'services');

function servicesStaticPlugin(): Plugin {
  return {
    name: 'services-static',
    configureServer(server) {
      server.middlewares.use('/services', async (request: Connect.IncomingMessage, response, next) => {
        const requestPath = decodeURIComponent(request.url?.split('?')[0] ?? '');
        const filePath = path.normalize(path.join(servicesDir, requestPath));

        if (!filePath.startsWith(servicesDir)) {
          response.statusCode = 403;
          response.end('Forbidden');
          return;
        }

        try {
          const file = await readFile(filePath);
          response.setHeader('Cache-Control', 'no-store');
          response.setHeader('Content-Type', filePath.endsWith('.yaml') ? 'text/yaml' : 'text/plain');
          response.end(file);
        } catch {
          next();
        }
      });
    },
    async closeBundle() {
      try {
        await stat(servicesDir);
        await cp(servicesDir, path.resolve(__dirname, 'dist/services'), {
          recursive: true,
        });
      } catch {
        // A project can start without any service-specific assets.
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), servicesStaticPlugin(), cloudflare()],
});