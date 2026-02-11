/**
 * Build script for the side panel React app.
 * Uses Bun.build to bundle React + JSX into a single file for the Chrome extension.
 */

const result = await Bun.build({
  entrypoints: ["src/side-panel/index.tsx"],
  outdir: "dist/side-panel",
  naming: "side-panel.js",
  target: "browser",
  format: "esm",
  minify: false,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});

if (!result.success) {
  console.error("Side panel build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log("[side-panel] Built successfully");
