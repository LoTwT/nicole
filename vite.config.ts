import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  build: {
    // The license generator reads the JSON form of the bundled packages'
    // licenses from dist/.vite and writes the committed notice file. See
    // docs/development.md.
    license: { fileName: ".vite/licenses.json" },
  },
  server: {
    // `mygo dev` loads this address (devUrl in mygo.config.ts).
    port: 5173,
    strictPort: true,
    // The development app and the packaged builds are not the page's.
    watch: { ignored: ["**/.mygo/**", "**/build/**"] },
  },
});
