import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function bundleApp() {
  let esbuild;
  try {
    esbuild = await import("esbuild");
  } catch {
    return bundleWithoutEsbuild();
  }
  const result = await esbuild.build({
    entryPoints: [join(root, "src/app.js")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: ["es2019"],
  });
  return result.outputFiles[0].text;
}

function bundleWithoutEsbuild() {
  const parser = readFileSync(join(root, "src/parser.js"), "utf8")
    .replace(/^export\s+/gm, "")
    .replace(/export\s*\{[^}]+\}\s*;?/g, "");
  const render = readFileSync(join(root, "src/render.js"), "utf8")
    .replace(/^import[\s\S]*?;\n/, "")
    .replace(/^export\s+/gm, "")
    .replace(/export\s*\{[^}]+\}\s*;?/g, "");
  const app = readFileSync(join(root, "src/app.js"), "utf8").replace(/^import[\s\S]*?;\n/, "");
  return `${parser}\n${render}\n${app}\n`;
}

const css = readFileSync(join(root, "src/ui.css"), "utf8");
const template = readFileSync(join(root, "src/template.html"), "utf8");
const script = await bundleApp();

const html = template
  .replace("/* {{CSS}} */", css)
  .replace("/* {{SCRIPT}} */", script)
  .replace('<script type="module">', "<script>");

writeFileSync(join(root, "ppdop-generator.html"), html);
console.log("Wrote ppdop-generator.html");
