import { defineConfig } from 'vite';

export default defineConfig({
    // relative asset paths: the build runs from any sub-path (GitHub Pages /play/) or straight from disk
    base: './',
    server: { port: 5173 },
    build: { chunkSizeWarningLimit: 1200 },
});
