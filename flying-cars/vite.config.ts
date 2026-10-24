import { defineConfig } from 'vite';

// Lets the game be opened through a Cloudflare quick tunnel (a random name ending in trycloudflare.com).
const tunnel = ['.trycloudflare.com'];

export default defineConfig({
  server: { allowedHosts: tunnel },
  preview: { allowedHosts: tunnel },
});
