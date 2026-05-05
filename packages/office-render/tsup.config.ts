import cssModulesPlugin from "esbuild-plugin-css-modules";
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
