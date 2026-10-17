import { build } from "esbuild";
await build({ entryPoints: ["scripts/staff-auth.ts"], outfile: "dist/auth-tools/staff-auth.mjs", bundle: true,
  packages: "external", platform: "node", format: "esm", target: "node24" });
