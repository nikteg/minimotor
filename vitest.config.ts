import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@src\/(.*)$/,
        replacement: `${fileURLToPath(new URL("./src", import.meta.url))}/$1`,
      },
    ],
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts", "tools/**/*.test.ts"],
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts"],
      thresholds: {
        statements: 40,
        branches: 30,
        functions: 40,
        lines: 40,
      },
    },
  },
});
