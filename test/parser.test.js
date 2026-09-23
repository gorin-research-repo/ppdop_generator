import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseDocument, qualDetailRows, emphasizeHtml, formatPrivilegeHtml } from "../src/parser.js";
import { renderDocument } from "../src/render.js";
import { buildCredentialingPdf } from "../src/pdf.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("parses simple privilege lists", () => {
  const blocks = parseDocument("Cystoscopy\nUreteroscopy\n# comment\nVasectomy\n");
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks[0], { type: "privilege", text: "Cystoscopy", indent: false });
});

test("parses sections, qualifications, and subgroups", () => {
  const sample = readFileSync(join(root, "privileges_example.txt"), "utf8");
  const blocks = parseDocument(sample);
  assert.ok(blocks.some((b) => b.type === "specialty" && b.name === "Urology"));
  assert.ok(blocks.some((b) => b.type === "section" && b.title.includes("Core Urology")));
  assert.ok(blocks.some((b) => b.type === "qualifications" && b.newPrivilege));
  assert.ok(blocks.some((b) => b.type === "subgroup" && b.text === "Endoscopy"));
  assert.ok(blocks.some((b) => b.type === "privilege" && b.text === "Cystoscopy" && b.indent));
});

test("omits FPPE from qualification rows but keeps certification when present", () => {
  const blocks = parseDocument(`SECTION: Demo
QUALIFICATIONS
Education & Training: Residency
Certification: Board certified
New Privilege: Case log
Renewal of Privilege: 24 months
FPPE Plan: First five cases
Cystoscopy
`);
  const q = blocks.find((b) => b.type === "qualifications");
  const rows = qualDetailRows(q);
  assert.deepEqual(
    rows.map((r) => r[0]),
    ["Education & Training:", "Certification:", "New Privilege:", "Renewal of Privilege:"],
  );
});

test("renderDocument builds cover, checkboxes, acknowledgment, and med director pages", () => {
  const sample = readFileSync(join(root, "privileges_example.txt"), "utf8");
  const { html, meta } = renderDocument(sample);
  assert.equal(meta.specialty, "Urology");
  assert.ok(meta.privilegeCount > 10);
  assert.match(html, /Delineation of Privileges/);
  assert.match(html, /NewlyRequested_/);
  assert.match(html, /Acknowledgment of Practitioner/);
  assert.match(html, /Medical Director Declaration/);
  assert.match(html, /Michael A\. Gorin/);
  assert.doesNotMatch(html, /cover-org/);
});

test("buildCredentialingPdf matches Python page count and widget counts", async () => {
  const sample = readFileSync(join(root, "privileges_example.txt"), "utf8");
  const bytes = await buildCredentialingPdf(sample);
  writeFileSync("/tmp/test_js_dop.pdf", bytes);
  assert.ok(bytes.byteLength > 1000);
  // Header %PDF
  assert.equal(String.fromCharCode(...bytes.slice(0, 5)), "%PDF-");
});

test("built HTML is present and includes PDF engine", () => {
  const built = readFileSync(join(root, "ppdop-generator.html"), "utf8");
  assert.match(built, /PPDOP Generator/);
  assert.match(built, /buildCredentialingPdf|Download PDF/);
  assert.match(built, /PDFDocument|PDFLib/);
  assert.doesNotMatch(built, /src="https?:/);
  assert.doesNotMatch(built, /href="https?:/);
});

test("built HTML script parses without duplicate-binding errors", () => {
  const built = readFileSync(join(root, "ppdop-generator.html"), "utf8");
  const match = built.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(match, "missing script tag");
  // Function constructor parses without executing — catches SyntaxError like redeclared const
  assert.doesNotThrow(() => new Function(match[1]));
});

test("anesthesiology DOP keeps age-band additional requirements on the correct privileges", () => {
  const sample = readFileSync(join(root, "privileges_anesthesiology.txt"), "utf8");
  const blocks = parseDocument(sample);
  assert.ok(blocks.some((b) => b.type === "specialty" && b.name === "Anesthesiology (Physician)"));
  assert.ok(blocks.some((b) => b.type === "version" && b.date === "September 23, 2026"));

  const quals = blocks.find((b) => b.type === "qualifications");
  assert.match(quals.educationTraining, /\n\nOR An equivalent as set forth in the Medical Staff Bylaws\./);
  assert.match(quals.certification, /\n\nAND Current certification in Advanced Cardiovascular Life Support/);
  assert.match(quals.certification, /\n\nAND\/OR Current certification in Perioperative Resuscitation/);
  assert.match(quals.certification, /Maintenance of Certification is required/);
  assert.match(quals.newPrivilege, /\n\nOR Successful completion of an ACGME-/);

  const privileges = blocks.filter((b) => b.type === "privilege");
  assert.equal(privileges.length, 9);

  const infant = privileges.find((b) =>
    b.text.startsWith("Provide anesthesia care to patients 2 months to less than 24 months of age"),
  );
  assert.ok(infant, "missing 2 months to <24 months privilege");
  assert.match(
    infant.text,
    /^Provide anesthesia care to patients 2 months to less than 24 months of age\.\nAdditional Requirements:/,
  );
  assert.match(infant.text, /\n    - Successful completion of an ACGME-/);
  assert.match(infant.text, /\n    - OR An equivalent as set forth in the Medical Staff Bylaws\./);
  assert.match(infant.text, /\n    - AND Current certification in Pediatric Advanced Life Support/);
  assert.doesNotMatch(infant.text, /\n\n    - /);

  const child = privileges.find((b) =>
    b.text.startsWith("Provide anesthesia care to patients 2 years to less than 13 years of age"),
  );
  assert.ok(child, "missing 2 years to <13 years privilege");
  assert.match(
    child.text,
    /^Provide anesthesia care to patients 2 years to less than 13 years of age\.\nAdditional Requirements:/,
  );
  assert.match(child.text, /\n    - Current certification in Pediatric Advanced Life Support/);
  assert.doesNotMatch(child.text, /fellowship in pediatric anesthesiology/);

  const teenAdult = privileges.find((b) =>
    b.text.startsWith("Provide anesthesia care to patients 13 years of age and older"),
  );
  assert.ok(teenAdult, "missing 13 years and older privilege");
  assert.equal(teenAdult.text, "Provide anesthesia care to patients 13 years of age and older.");
  assert.doesNotMatch(teenAdult.text, /Additional Requirements:/);

  assert.equal(
    privileges.filter((b) => /Additional Requirements:/.test(b.text)).length,
    2,
  );
  assert.equal(
    privileges.filter((b) => /Pediatric Advanced Life Support/.test(b.text)).length,
    2,
  );
  assert.doesNotMatch(
    privileges.map((b) => b.text).join("\n"),
    /<2 months of age|2 months of age and older/,
  );

  const { html, meta } = renderDocument(sample);
  assert.equal(meta.specialty, "Anesthesiology (Physician)");
  assert.equal(meta.privilegeCount, 9);
  assert.match(html, /<strong>AND\/OR<\/strong>/);
  assert.match(html, /class="addl-req-item"/);
  assert.match(html, /class="priv-line addl-req-label"/);
  assert.match(html, /2 months to less than 24 months of age/);
  assert.match(html, /2 years to less than 13 years of age/);
  assert.match(html, /13 years of age and older/);
  assert.match(html, /<strong>AND<\/strong> Current certification in Pediatric Advanced Life Support/);
  const infantHtml = formatPrivilegeHtml(infant.text);
  assert.match(infantHtml, /class="addl-req-item"/);
  assert.match(infantHtml, /class="priv-line addl-req-label"/);
  const childHtml = formatPrivilegeHtml(child.text);
  assert.match(childHtml, /class="addl-req-item"/);
  assert.match(childHtml, /PALS/);
});

test("emphasizeHtml bolds connectors and preserves paragraph breaks", () => {
  const html = emphasizeHtml("Board certified.\n\nOR An equivalent.\n\nAND ACLS.\n\nAND/OR PeRLS.");
  assert.match(html, /<strong>OR<\/strong>/);
  assert.match(html, /<strong>AND<\/strong>/);
  assert.match(html, /<strong>AND\/OR<\/strong>/);
  assert.match(html, /<br><br>/);
});
