import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function bundleApp() {
  let esbuild;
  try {
    esbuild = await import("esbuild");
  } catch {
    return null;
  }
  const result = await esbuild.build({
    entryPoints: [join(root, "src/app.js")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: ["es2019"],
    // pdf-lib is injected via vendor global below
    external: [],
    alias: {
      "pdf-lib": join(root, "scripts/pdf-lib-shim.js"),
    },
  });
  return result.outputFiles[0].text;
}

function bundleWithoutEsbuild() {
  const strip = (src) =>
    src
      .replace(/^import[\s\S]*?;\n/gm, "")
      .replace(/^export\s+/gm, "")
      .replace(/export\s*\{[^}]+\}\s*;?/g, "")
      .replace(/export\s+async\s+function/g, "async function")
      .replace(/export\s+function/g, "function")
      .replace(/export\s+const/g, "const");

  const parser = strip(readFileSync(join(root, "src/parser.js"), "utf8"));
  const render = strip(readFileSync(join(root, "src/render.js"), "utf8"));
  const pdf = strip(readFileSync(join(root, "src/pdf.js"), "utf8")).replace(
    /async function loadPdfLib\(\)[\s\S]*?\n\}/,
    `async function loadPdfLib() {
  if (globalThis.PDFLib) return globalThis.PDFLib;
  throw new Error("PDFLib global missing");
}`,
  );
  const app = strip(readFileSync(join(root, "src/app.js"), "utf8"));
  return `${parser}\n${render}\n${pdf}\n${app}\n`;
}

// Shim so esbuild resolves pdf-lib to the browser global
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

const css = readFileSync(join(root, "src/ui.css"), "utf8");
const template = readFileSync(join(root, "src/template.html"), "utf8");
const pdfLib = readFileSync(join(root, "vendor/pdf-lib.min.js"), "utf8");
let script = await bundleApp();
if (!script) script = bundleWithoutEsbuild();

const html = template
  .replace("/* {{CSS}} */", css)
  .replace(
    "/* {{SCRIPT}} */",
    `${pdfLib}\n${script}`,
  )
  .replace('<script type="module">', "<script>");

writeFileSync(join(root, "ppdop-generator.html"), html);
console.log("Wrote ppdop-generator.html");
