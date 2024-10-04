import { resolve } from 'node:path';
import { type UserConfig, defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      fileName: 'index',
      formats: ['es'],
    },
  },
  test: {
    watch: false,
    setupFiles: ['./src/index.ts'],
  },
}) satisfies UserConfig;
