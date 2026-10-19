import { build } from "esbuild";
await build({ entryPoints: ["scripts/reconcile-lineup-coaches.ts"], outfile: "dist/football-tools/reconcile-lineup-coaches.mjs",
  bundle: true, packages: "external", platform: "node", format: "esm", target: "node24" });
