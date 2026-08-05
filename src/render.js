import { parseDocument, qualDetailRows, emphasizeHtml, escapeHtml } from "./parser.js";

export const COVER_INSTRUCTIONS =
  "Please check the box beside each clinical privilege being requested. Applicants are required to produce information deemed necessary by the center in order to properly evaluate current competence, current clinical activity, and other privileging requirements.";

export const ACK_BODY =
  "I have requested only those privileges which by education, training, current experience, and demonstrated performance I am qualified to perform, and for which I wish to exercise at this center. I further understand that:";

export const ACK_ITEMS = [
  "Privileges requested may differ from those granted and approved;",
  "Completion of this form, at the present time, does not preclude me from requesting additional privileges in the future;",
  "The granting of clinical privileges will be made in conformance with the applicable Medical Staff Bylaws and Policies and Procedures;",
  "Failure to obtain and maintain all threshold criteria set forth above, or non-compliance with the applicable Medical Staff Bylaws or Policies or Procedures, may constitute grounds for non-renewal or restriction/limitation of clinical privileges.",
];

export const MED_DIR_BODY =
  "The practitioner's request for new, modified, or renewed clinical privileges has been reviewed by the Center's Medical Director or an appropriate member of the Medical Executive Committee and presented to the Governing Board for approval. Privileges that have received a checkmark in the designated column have been granted. Any privileges that were requested but not granted are listed below, along with an explanation for each determination.";

export const MED_DIR_NAME = "Medical Director: Michael A. Gorin, M.D.";

function monthYearNow() {
  return new Date().toLocaleString("en-US", { month: "long", year: "numeric" });
}

function nl2br(text) {
  return escapeHtml(text || "").replace(/\n/g, "<br>");
}

function privilegeHeaderRow() {
  return `<div class="priv-row priv-header">
    <div class="priv-text">Privilege</div>
    <div class="priv-cb">Newly Requested</div>
    <div class="priv-cb">Currently Held</div>
    <div class="priv-cb granted">Granted / Renewed</div>
  </div>`;
}

function renderSectionTable(title, quals, rowsHtml) {
  const detailRows = qualDetailRows(quals)
    .map(
      ([lab, val]) => `<div class="qual-row">
      <div class="qual-label">${escapeHtml(lab)}</div>
      <div class="qual-value">${nl2br(val)}</div>
    </div>`,
    )
    .join("");

  return `<section class="dop-section">
    <div class="section-title">${escapeHtml(title || "Privileges")}</div>
    <div class="qual-bar">Qualifications</div>
    ${detailRows}
    ${privilegeHeaderRow()}
    ${rowsHtml}
  </section>`;
}

function renderPrivilegeRow(text, indent, idx) {
  const indentClass = indent ? " indented" : "";
  return `<div class="priv-row">
    <div class="priv-text${indentClass}">${emphasizeHtml(text)}</div>
    <div class="priv-cb"><input type="checkbox" name="NewlyRequested_${idx}" aria-label="Newly requested"></div>
    <div class="priv-cb"><input type="checkbox" name="CurrentlyHeld_${idx}" aria-label="Currently held"></div>
    <div class="priv-cb granted"><input type="checkbox" name="GrantedRenewed_${idx}" aria-label="Granted or renewed"></div>
  </div>`;
}

function renderSubgroupRow(text) {
  return `<div class="priv-row subgroup">
    <div class="priv-text"><strong>${emphasizeHtml(text)}</strong></div>
    <div class="priv-cb"></div>
    <div class="priv-cb"></div>
    <div class="priv-cb granted"></div>
  </div>`;
}

function renderCover(specialty) {
  return `<section class="dop-page cover-page">
    <h1 class="specialty-name">${escapeHtml(specialty)}</h1>
    <p class="dop-label">Delineation of Privileges</p>
    <div class="applicant-box">
      <h2>Applicant Information</h2>
      <label><span>Full Name:</span><input type="text" name="FullName" autocomplete="name"></label>
      <label><span>Date of Birth:</span><input type="text" name="DateOfBirth" autocomplete="bday"></label>
      <label><span>Home Address:</span><input type="text" name="HomeAddress" autocomplete="street-address"></label>
      <label><span>Life Number (if available):</span><input type="text" name="LifeNumber"></label>
    </div>
    <div class="instructions">
      <strong>Instructions:</strong>
      <p>${escapeHtml(COVER_INSTRUCTIONS)}</p>
    </div>
  </section>`;
}

function renderAcknowledgment() {
  const letters = ["A", "B", "C", "D"];
  const items = ACK_ITEMS.map(
    (item, i) => `<div class="ack-item"><span class="ack-letter">${letters[i]}.</span><span>${escapeHtml(item)}</span></div>`,
  ).join("");
  return `<section class="ack-box">
    <div class="ack-header">Acknowledgment of Practitioner</div>
    <div class="ack-body">
      <p>${escapeHtml(ACK_BODY)}</p>
      ${items}
      <div class="sig-row">
        <div class="sig-col"><div class="sig-line"></div><div class="sig-label">Practitioner's Signature</div></div>
        <div class="sig-col"><div class="sig-line"></div><div class="sig-label">Date</div></div>
      </div>
    </div>
  </section>`;
}

function renderMedDir() {
  const lines = Array.from({ length: 10 }, (_, i) => `<div class="denied-line"><span>${i + 1}.</span><div></div></div>`).join("");
  return `<section class="dop-page med-dir-page">
    <div class="ack-box">
      <div class="ack-header">Medical Director Declaration</div>
      <div class="ack-body">
        <p>${escapeHtml(MED_DIR_BODY)}</p>
        <p class="med-dir-name">${escapeHtml(MED_DIR_NAME)}</p>
        <div class="sig-row">
          <div class="sig-col"><div class="sig-line"></div><div class="sig-label">Signature</div></div>
          <div class="sig-col"><div class="sig-line"></div><div class="sig-label">Date</div></div>
        </div>
        <p class="denied-title">Privileges Not Granted / Renewed:</p>
        ${lines}
      </div>
    </div>
  </section>`;
}

/**
 * Build printable DOP HTML from privilege source text.
 * @param {string} sourceText
 * @param {{ organization?: string }} [opts]
 */
export function renderDocument(sourceText, opts = {}) {
  const blocks = parseDocument(sourceText || "");
  if (!blocks.length) {
    return { html: "", meta: { specialty: "", version: "", privilegeCount: 0 } };
  }

  let specialty = "";
  let version = monthYearNow();
  const content = [];
  for (const b of blocks) {
    if (b.type === "specialty") specialty = b.name;
    else if (b.type === "version") version = b.date;
    else if (b.type !== "logo") content.push(b);
  }

  const organization = opts.organization || "Peakpoint Central Nassau Surgery Center";
  let html = "";
  if (specialty) html += renderCover(specialty);

  let pendingSection = null;
  let needHeader = true;
  let sectionRows = [];
  let sectionTitle = "";
  let sectionQuals = null;
  let privIdx = 0;
  let open = false;

  function flushSection() {
    if (!open) return;
    html += renderSectionTable(sectionTitle, sectionQuals, sectionRows.join(""));
    sectionRows = [];
    sectionTitle = "";
    sectionQuals = null;
    open = false;
    needHeader = true;
  }

  function ensureSection(title, quals) {
    if (!open) {
      sectionTitle = title || "";
      sectionQuals = quals || null;
      open = true;
      needHeader = false;
    }
  }

  for (const b of content) {
    if (b.type === "section") {
      flushSection();
      pendingSection = b.title.trim();
      continue;
    }
    if (b.type === "qualifications") {
      ensureSection(pendingSection || "", b);
      pendingSection = null;
      continue;
    }
    if (b.type === "subgroup") {
      if (pendingSection !== null) {
        ensureSection(pendingSection, null);
        pendingSection = null;
      } else if (!open) {
        ensureSection("", null);
      }
      sectionRows.push(renderSubgroupRow(b.text));
      continue;
    }
    if (b.type === "privilege") {
      if (pendingSection !== null) {
        ensureSection(pendingSection, null);
        pendingSection = null;
      } else if (!open) {
        ensureSection("", null);
      }
      privIdx += 1;
      sectionRows.push(renderPrivilegeRow(b.text, b.indent, privIdx));
    }
  }

  if (pendingSection !== null) ensureSection(pendingSection, null);
  flushSection();

  html += renderAcknowledgment();
  html += renderMedDir();

  const footer = `<footer class="dop-footer"><span>Version: ${escapeHtml(version)}</span><span class="print-hint">Print from browser for PDF</span></footer>`;

  return {
    html: `<div class="dop-document" data-version="${escapeHtml(version)}">${html}${footer}</div>`,
    meta: { specialty, version, privilegeCount: privIdx, organization },
  };
}

export { parseDocument };
