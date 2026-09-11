import { defineConfig } from 'vitest/config'

export default defineConfig({
  server: { sourcemapIgnoreList: () => true },
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['tests/**/*.{spec,test}.{ts,tsx}'],
    environment: 'node',
  },
})
