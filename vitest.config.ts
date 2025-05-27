import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run tests sequentially to avoid log file conflicts
    // TODO: Remove when using API instead of file-based logging
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
