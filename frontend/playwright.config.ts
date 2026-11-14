import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: process.env.FLOWENT_URL ?? "http://127.0.0.1:8121",
    viewport: { width: 1440, height: 950 },
    video: process.env.FLOWENT_VIDEO ? "on" : "off",
  },
});
