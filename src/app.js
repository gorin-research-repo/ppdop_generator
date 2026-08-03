import { renderDocument } from "./render.js";

const EXAMPLE = `# Peakpoint Central Nassau Surgery Center — sample Urology DOP source
SPECIALTY: Urology
VERSION: August 2026

SECTION: Core Urology Privileges
QUALIFICATIONS
Education & Training: Successful completion of an ACGME-accredited Urology residency (or AOA / RCPSC equivalent).
Certification: Current board certification or active candidacy in Urology within seven years of training completion.
New Privilege: Case log documenting recent performance of requested procedures, or verification letter from Program Director for recent graduates.
Renewal of Privilege: Case log of procedures performed over the prior 24 months demonstrating ongoing clinical activity.
FPPE Plan: Focused review of the first five cases for newly requested privileges, as determined by the Medical Director.

PRIVILEGES
SUBGROUP: Endoscopy
Cystoscopy
Cystoscopy with bladder biopsy
Cystoscopy with ureteral catheterization
Cystoscopy with fulguration
Cystoscopy with placement of ureteral stent
Transurethral resection of bladder tumor (TURBT)
Transurethral resection of prostate (TURP)
Ureteroscopy
Ureteroscopy with calculus removal, biopsy, or fulguration

SUBGROUP: Prostate
Needle biopsy of prostate (ultrasound-guided)
Transrectal ultrasound of prostate
Transurethral laser ablation of prostate

SUBGROUP: Scrotum / Testis / Cord
Hydrocelectomy
Vasectomy
Varicocele ligation
Orchiectomy, simple or radical inguinal
Circumcision

SECTION: Advanced / Special Privileges
QUALIFICATIONS
Education & Training: Documented residency training OR approved course with hands-on experience for the requested modality.
New Privilege: Proctoring of the first two cases by a credentialed surgeon, unless waived by the Medical Director.
Renewal of Privilege: Performance of at least five related cases in the prior 24 months, OR refresher training documentation.

PRIVILEGES
Holmium / YAG / KTP laser ablation of bladder, ureteral, or urethral lesions
UroLift or equivalent prostatic urethral lift
InterStim sacral neuromodulation (evaluation and implant)
Extracorporeal shock wave lithotripsy (ESWL)
Insertion of penile prosthesis
`;

const source = document.getElementById("source");
const preview = document.getElementById("preview");
const summary = document.getElementById("summary");
const clearBtn = document.getElementById("clear");
const exampleBtn = document.getElementById("example");
const generateBtn = document.getElementById("generate");
const printBtn = document.getElementById("print");
const fileInput = document.getElementById("file");
const orgInput = document.getElementById("organization");

function updateSummary(meta) {
  if (!meta || !meta.privilegeCount) {
    summary.textContent = "Paste a privilege list, then generate.";
    printBtn.disabled = true;
    return;
  }
  const bits = [];
  if (meta.specialty) bits.push(meta.specialty);
  bits.push(`${meta.privilegeCount} privilege${meta.privilegeCount === 1 ? "" : "s"}`);
  if (meta.version) bits.push(`Version ${meta.version}`);
  summary.textContent = bits.join(" · ");
  printBtn.disabled = false;
}

function generate() {
  const { html, meta } = renderDocument(source.value, {
    organization: (orgInput.value || "").trim() || undefined,
  });
  if (!html) {
    preview.innerHTML = `<div class="empty-preview">Your DOP form will appear here.</div>`;
    updateSummary(null);
    return;
  }
  preview.innerHTML = html;
  updateSummary(meta);
  preview.scrollIntoView({ behavior: "smooth", block: "start" });
}

source.addEventListener("input", () => {
  summary.textContent = `${source.value.length.toLocaleString()} characters · ready to generate`;
});

clearBtn.addEventListener("click", () => {
  source.value = "";
  preview.innerHTML = `<div class="empty-preview">Your DOP form will appear here.</div>`;
  updateSummary(null);
  source.focus();
});

exampleBtn.addEventListener("click", () => {
  source.value = EXAMPLE.trim() + "\n";
  generate();
});

generateBtn.addEventListener("click", generate);

printBtn.addEventListener("click", () => {
  if (printBtn.disabled) return;
  window.print();
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  source.value = await file.text();
  generate();
  fileInput.value = "";
});

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    generate();
  }
});

updateSummary(null);
