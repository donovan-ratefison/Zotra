/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8080" },
  },
  build: {
    // The documentation page of the server loads the diagram script by a
    // fixed name, so this entry has no hash in its file name.
    rolldownOptions: {
      input: { index: "index.html", doc: "src/doc-diagram.ts" },
      output: {
        entryFileNames: (chunk) => (chunk.name === "doc" ? "assets/doc-diagram.js" : "assets/[name]-[hash].js"),
      },
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
