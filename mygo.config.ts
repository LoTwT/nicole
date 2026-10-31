import { defineConfig } from "mygo-cli";

export default defineConfig({
  name: "Nicole",
  identifier: "me.eruoo.nicole",
  version: "0.0.1",
  // `mygo dev` runs devCommand and loads devUrl; `mygo build` runs
  // buildCommand and embeds frontendDist into the app.
  devUrl: "http://localhost:5173",
  devCommand: "bun run dev:web",
  buildCommand: "bun run build:web",
  frontendDist: "dist",
  bindings: "src/services/mygo.ts",
  out: "build",
});
