import { defineConfig, type UserConfig } from 'tsdown';

const config: UserConfig = defineConfig({
  entry: ['src/index.ts'],
  target: 'esnext',
  format: ['esm'],
  dts: true,
  clean: true,
});

export default config;
