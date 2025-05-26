import { defineConfig, type UserConfig, type UserConfigFn } from 'tsdown';

const config: UserConfig | UserConfigFn = defineConfig({
  entry: ['src/index.ts'],
  target: 'esnext',
  format: ['esm'],
  dts: true,
  clean: true,
});

export default config;
