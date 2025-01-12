import { resolve } from 'node:path';
import { defineConfig as defineViteConfig, mergeConfig } from 'vite';
import { defineConfig as defineVitestConfig } from 'vitest/config';

const viteConfig = defineViteConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      fileName: 'index',
      formats: ['es'],
    },
  },
});

const vitestConfig = defineVitestConfig({
  test: {
    watch: false,
    setupFiles: ['./src/index.ts'],
  },
});

export default mergeConfig(viteConfig, vitestConfig);
