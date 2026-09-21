/**
 * Port of parse_document() from credentialing_pdf.py
 * Parses PeakPoint DOP privilege text into typed blocks.
 */

export function stripComment(line) {
  if (line.includes("#")) return line.split("#", 1)[0].replace(/\s+$/, "");
  return line.replace(/\s+$/, "");
}

export function unescapeText(s) {
  return s.replace(/\\\\n/g, "\n").replace(/\\n/g, "\n");
}

export function isAdditionalRequirementsLine(stripped) {
  return stripped.toLowerCase().startsWith("additional requirements:");
}

export function startsWithConnector(stripped) {
  return /^(OR|AND|AND\/OR)(?:\s|$)/.test(stripped);
}

function additionalRequirementsValue(stripped) {
  const idx = stripped.indexOf(":");
  return idx === -1 ? "" : stripped.slice(idx + 1).trim();
}

function createPrivilegeContinuation() {
  return { active: false, pendingBlank: false, waitingBody: false };
}

function notePrivilegeBlank(state) {
  if (state.active) state.pendingBlank = true;
}

function resetPrivilegeContinuation(state) {
  state.active = false;
  state.pendingBlank = false;
  state.waitingBody = false;
}

function tryAppendPrivilegeContinuation(blocks, stripped, state) {
  const last = blocks[blocks.length - 1];
  if (!last || last.type !== "privilege") {
    resetPrivilegeContinuation(state);
    return false;
  }

  if (isAdditionalRequirementsLine(stripped)) {
    const value = additionalRequirementsValue(stripped);
    last.text += (last.text ? "\n\n" : "") + unescapeText(stripped);
    state.active = true;
    state.waitingBody = !value;
    state.pendingBlank = false;
    return true;
  }

  if (state.active && (state.waitingBody || startsWithConnector(stripped))) {
    last.text += (state.pendingBlank ? "\n\n" : "\n") + unescapeText(stripped);
    state.waitingBody = false;
    state.pendingBlank = false;
    return true;
  }

  resetPrivilegeContinuation(state);
  return false;
}

function parseQualifications(lines, start) {
  const fields = { e: "", c: "", n: "", r: "" };
  let current = null;
  let pendingBlank = false;
  let j = start;
  const n = lines.length;

  while (j < n && !lines[j].trim()) j += 1;

  while (j < n) {
    const stripped = lines[j].trim();
    if (!stripped) {
      if (current && fields[current]) pendingBlank = true;
      j += 1;
      continue;
    }
    const low = stripped.toLowerCase();
    const up = stripped.toUpperCase();
    if (up === "SECTION" || up === "[SECTION]" || up.startsWith("SECTION:")) break;
    if (up === "PRIVILEGES" || up === "PRIVILEGES:" || up === "[PRIVILEGES]") break;
    if (up === "QUALIFICATIONS" || up === "[QUALIFICATIONS]" || up.startsWith("QUALIFICATIONS:")) break;

    let key = null;
    if (low.startsWith("education and training:") || low.startsWith("education & training:")) key = "e";
    else if (low.startsWith("certification:")) key = "c";
    else if (low.startsWith("new privilege:")) key = "n";
    else if (low.startsWith("fppe plan:") || low.startsWith("ffpe plan:")) {
      current = null;
      pendingBlank = false;
      j += 1;
      continue;
    } else if (
      low.startsWith("renewal of privilege:") ||
      low.startsWith("renewal of privileges:") ||
      low.startsWith("renewal privilege:") ||
      low.startsWith("renewal of provlidge:") ||
      low.startsWith("renewal of provlidges:")
    ) {
      key = "r";
    }

    if (key !== null) {
      current = key;
      fields[current] = stripped.split(":").slice(1).join(":").trim();
      pendingBlank = false;
      j += 1;
      continue;
    }

    if (current) {
      if (!fields[current]) fields[current] = stripped;
      else fields[current] = fields[current] + (pendingBlank ? "\n\n" : "\n") + stripped;
      pendingBlank = false;
      j += 1;
      continue;
    }
    j += 1;
  }

  return [
    {
      type: "qualifications",
      educationTraining: fields.e,
      certification: fields.c,
      newPrivilege: fields.n,
      renewalOfPrivilege: fields.r,
    },
    j,
  ];
}

export function parseDocument(text) {
  text = text.replace(/^[ \t]*<blank>[ \t]*$/gim, "");
  text = text.replace(/<blank>/gi, "\n");
  text = text.replace(/\\\\n/g, "\n").replace(/\\n/g, "\n");

  const rawLines = text.split(/\r?\n/);
  const lines = rawLines.map(stripComment);

  const hasSection = lines.some((s) => {
    const t = s.trim();
    if (!t) return false;
    const up = t.toUpperCase();
    return up === "SECTION" || up === "[SECTION]" || up.startsWith("SECTION:");
  });
  const hasQual = lines.some((s) => {
    const t = s.trim();
    if (!t) return false;
    const up = t.toUpperCase();
    return up === "QUALIFICATIONS" || up === "[QUALIFICATIONS]" || up.startsWith("QUALIFICATIONS:");
  });

  if (!hasSection && !hasQual) {
    const out = [];
    let subgroupActive = false;
    const cont = createPrivilegeContinuation();
    for (const s of lines) {
      const t = s.trim();
      if (!t) {
        notePrivilegeBlank(cont);
        continue;
      }
      const up = t.toUpperCase();
      if (up.startsWith("SUBGROUP:")) {
        resetPrivilegeContinuation(cont);
        const title = unescapeText(t.split(":").slice(1).join(":").trim());
        if (title) {
          out.push({ type: "subgroup", text: title });
          subgroupActive = true;
        }
        continue;
      }
      if (tryAppendPrivilegeContinuation(out, t, cont)) continue;
      out.push({ type: "privilege", text: t, indent: subgroupActive });
    }
    return out;
  }

  const blocks = [];
  let i = 0;
  const n = lines.length;
  let subgroupActive = false;
  const cont = createPrivilegeContinuation();

  while (i < n) {
    const stripped = lines[i].trim();
    if (!stripped) {
      notePrivilegeBlank(cont);
      i += 1;
      continue;
    }
    const up = stripped.toUpperCase();

    if (up.startsWith("SPECIALTY:")) {
      resetPrivilegeContinuation(cont);
      blocks.push({ type: "specialty", name: unescapeText(stripped.split(":").slice(1).join(":").trim()) });
      i += 1;
      continue;
    }
    if (up.startsWith("VERSION:")) {
      resetPrivilegeContinuation(cont);
      blocks.push({ type: "version", date: stripped.split(":").slice(1).join(":").trim() });
      i += 1;
      continue;
    }
    if (up.startsWith("LOGO:")) {
      resetPrivilegeContinuation(cont);
      blocks.push({ type: "logo", path: stripped.split(":").slice(1).join(":").trim() });
      i += 1;
      continue;
    }
    if (up.startsWith("SECTION:")) {
      resetPrivilegeContinuation(cont);
      blocks.push({ type: "section", title: unescapeText(stripped.split(":").slice(1).join(":").trim()) });
      subgroupActive = false;
      i += 1;
      continue;
    }
    if (up === "SECTION" || up === "[SECTION]") {
      resetPrivilegeContinuation(cont);
      subgroupActive = false;
      i += 1;
      while (i < n && !lines[i].trim()) i += 1;
      const parts = [];
      while (i < n && lines[i].trim()) {
        const nxt = lines[i].trim().toUpperCase();
        if (nxt === "QUALIFICATIONS" || nxt === "[QUALIFICATIONS]" || nxt.startsWith("QUALIFICATIONS:")) break;
        if (nxt === "SECTION" || nxt === "[SECTION]" || nxt.startsWith("SECTION:")) break;
        parts.push(lines[i].trim());
        i += 1;
      }
      if (parts.length) blocks.push({ type: "section", title: unescapeText(parts.join(" ")) });
      continue;
    }
    if (up.startsWith("QUALIFICATIONS:")) {
      resetPrivilegeContinuation(cont);
      subgroupActive = false;
      i += 1;
      const [qb, next] = parseQualifications(lines, i);
      blocks.push(qb);
      i = next;
      continue;
    }
    if (up === "QUALIFICATIONS" || up === "[QUALIFICATIONS]") {
      resetPrivilegeContinuation(cont);
      subgroupActive = false;
      i += 1;
      const [qb, next] = parseQualifications(lines, i);
      blocks.push(qb);
      i = next;
      continue;
    }
    if (up === "PRIVILEGES:" || up === "PRIVILEGES" || up === "[PRIVILEGES]") {
      resetPrivilegeContinuation(cont);
      subgroupActive = false;
      i += 1;
      continue;
    }
    if (up.startsWith("SUBGROUP:")) {
      resetPrivilegeContinuation(cont);
      const title = unescapeText(stripped.split(":").slice(1).join(":").trim());
      if (title) {
        blocks.push({ type: "subgroup", text: title });
        subgroupActive = true;
      }
      i += 1;
      continue;
    }

    if (tryAppendPrivilegeContinuation(blocks, stripped, cont)) {
      i += 1;
      continue;
    }

    blocks.push({ type: "privilege", text: unescapeText(stripped), indent: subgroupActive });
    i += 1;
  }

  return blocks;
}

export function qualDetailRows(q) {
  if (!q) {
    return [
      ["Education & Training:", ""],
      ["New Privilege:", ""],
      ["Renewal of Privilege:", ""],
    ];
  }
  const rows = [
    ["Education & Training:", q.educationTraining || ""],
    ["New Privilege:", q.newPrivilege || ""],
    ["Renewal of Privilege:", q.renewalOfPrivilege || ""],
  ];
  if ((q.certification || "").trim()) {
    rows.splice(1, 0, ["Certification:", q.certification]);
  }
  return rows;
}

export function emphasizeHtml(text) {
  return String(text)
    .split(/(\s+)/)
    .map((tok) => {
      if (/^(OR|AND|AND\/OR)$/.test(tok)) return `<strong>${tok}</strong>`;
      if (tok.includes("\n")) return tok.replace(/\n/g, "<br>");
      return escapeHtml(tok);
    })
    .join("");
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
