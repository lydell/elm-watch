import { defineConfig } from "vite";

export default defineConfig({
  test: {
    environmentOptions: {
      jsdom: {
        url: "http://localhost",
      },
    },
  },
});
