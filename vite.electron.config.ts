import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: 'dist-electron',
    sourcemap: true,
    lib: {
      entry: {
        main: 'src/electron/main.ts',
        preload: 'src/electron/preload.ts',
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: ['electron'],
      output: {
        entryFileNames: '[name].js',
      },
    },
    target: 'node22',
  },
})
