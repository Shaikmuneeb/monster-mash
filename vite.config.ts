import { defineConfig } from 'vite'

export default defineConfig({
  // Games deploy to a subdirectory on RUN.world, so all asset paths must be relative.
  base: './',
  build: {
    outDir: 'dist',
    // the RUN SDK uses top-level await, which needs an ES2022+ output target
    target: 'es2022',
  },
  optimizeDeps: {
    esbuildOptions: { target: 'es2022' },
  },
})
