import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Shim so the bundle uses the vendored PDFLib global (injected before app code).
writeFileSync(
  join(root, "scripts/pdf-lib-shim.js"),
  `const api = globalThis.PDFLib;
if (!api) throw new Error("PDFLib global missing — vendor/pdf-lib.min.js must load first");
export const PDFDocument = api.PDFDocument;
export const StandardFonts = api.StandardFonts;
export const rgb = api.rgb;
export const degrees = api.degrees;
export default api;
`,
);

const result = await esbuild.build({
  entryPoints: [join(root, "src/app.js")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["es2019"],
  alias: {
    "pdf-lib": join(root, "scripts/pdf-lib-shim.js"),
  },
});

const appBundle = result.outputFiles[0].text;
const css = readFileSync(join(root, "src/ui.css"), "utf8");
const template = readFileSync(join(root, "src/template.html"), "utf8");
const pdfLib = readFileSync(join(root, "vendor/pdf-lib.min.js"), "utf8");

const html = template
  .replace("/* {{CSS}} */", css)
  .replace("/* {{SCRIPT}} */", `${pdfLib}\n${appBundle}`)
  .replace('<script type="module">', "<script>");

writeFileSync(join(root, "ppdop-generator.html"), html);
console.log("Wrote ppdop-generator.html");
