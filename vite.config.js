import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      name: "Aioli",
      fileName: "aioli",
      entry: "src/main.js"
    }
  }
});
