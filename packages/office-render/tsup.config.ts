import cssModulesPlugin from "esbuild-plugin-css-modules";
import { readFileSync, writeFileSync } from "fs";
import { defineConfig } from "tsup";

export default defineConfig([
  // Main library bundle
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: true,
    clean: true,
    external: [
      "react",
      "react-dom",
      "react-dom/client",
      "lucide-react",
      "@chenglou/pretext",
      "@chenglou/pretext/rich-inline",
    ],
    esbuildOptions(options) {
      options.jsx = "automatic";
    },
    esbuildPlugins: [cssModulesPlugin()],
    // Inject CSS modules as runtime style tags so the package is self-contained
    injectStyle: true,
    async onSuccess() {
      // Rewrite worker URL .ts → .js in dist so npm consumers get the built
      // worker file. The source uses .ts for Next.js transpilePackages compat.
      const distFile = "dist/index.js";
      const content = readFileSync(distFile, "utf-8");
      const patched = content.replace(/spreadsheet-canvas\.worker\.ts"/g, 'spreadsheet-canvas.worker.js"');
      if (patched !== content) {
        writeFileSync(distFile, patched, "utf-8");
        console.log("✓ Patched worker URL .ts → .js in dist/index.js");
      }
    },
  },
  // Web worker — built as a separate module so `new Worker(new URL(...))` resolves correctly
  {
    entry: { "spreadsheet-canvas.worker": "src/spreadsheet/spreadsheet-canvas.worker.ts" },
    format: ["esm"],
    dts: false,
    clean: false,
    esbuildOptions(options) {
      options.jsx = "automatic";
    },
  },
]);
