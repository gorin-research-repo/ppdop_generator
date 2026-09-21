/**
 * pdf.js — JavaScript port of build_pdf() from credentialing_pdf.py
 *
 * Uses pdf-lib to produce an interactive credentialing privileges PDF whose
 * visual output matches the Python/PyMuPDF reference implementation.
 *
 * Coordinate convention note
 * ──────────────────────────
 * PyMuPDF uses y = 0 at the TOP of the page, increasing downward.
 * pdf-lib  uses y = 0 at the BOTTOM of the page, increasing upward.
 *
 * Throughout this file all internal geometry variables use the PyMuPDF
 * convention ("pyTop", "pyBottom", "pyBaseline", etc.).  Conversion to
 * pdf-lib coordinates happens only at the point of calling pdf-lib APIs:
 *
 *   pdf-lib rect bottom-left y  = PAGE_H − pyBottom
 *   pdf-lib text  baseline  y   = PAGE_H − pyBaseline
 *   pdf-lib line  point     y   = PAGE_H − pyY
 */

import { parseDocument, qualDetailRows } from "./parser.js";

// pdf-lib is provided as global PDFLib when bundled, or via import in tests
async function loadPdfLib() {
  if (globalThis.PDFLib) return globalThis.PDFLib;
  return await import("pdf-lib");
}

// ── Page & layout constants (mirror credentialing_pdf.py exactly) ──────────
const PAGE_W = 612;         // 8.5 in × 72 pt/in
const PAGE_H = 792;         // 11  in × 72 pt/in
const LEFT_M  = 0.75 * 72; // 54 pt
const RIGHT_M = 0.75 * 72; // 54 pt
const TOP_M   = 0.65 * 72; // 46.8 pt
const BOTTOM_M= 0.65 * 72; // 46.8 pt

const PRIV_TEXT_FRAC  = 0.70;
const PRIV_CB_FRAC    = 0.10;
const QUAL_LABEL_FRAC = 0.225;

const HEADER_H          = 28;
const CB_SIZE           = 14;
const LINE_H_FACTOR     = 1.25;
const OUTER_BORDER_W    = 1.15;
const GRANTED_DIVIDER_W = 0.8;

const SECTION_TITLE_FONT = 11;
const SECTION_LEADING    = SECTION_TITLE_FONT * LINE_H_FACTOR;
const SECTION_PAD        = 4;

const QUAL_FONT      = 9;
const QUAL_LEADING   = QUAL_FONT * LINE_H_FACTOR;
const QUAL_BAR_H     = 22;
const QUAL_ROW_PAD   = 4;
const QUAL_CELL_H_PAD= 6;

const CB_HDR_FONT  = QUAL_FONT - 2;  // 7 pt – checkbox column header labels
const CB_HDR_V_PAD = QUAL_ROW_PAD;   // 4 pt

const ACK_FONT       = 9;
const ACK_LINE_FACTOR= 1.0;
const ACK_LEADING    = ACK_FONT * ACK_LINE_FACTOR; // 9 pt (compact)

const FOOTER_FONT  = 8;
const ACK_GAP_LINES= 2;

// Words rendered in HelveticaBold regardless of context
const EMPHASIS_WORDS = new Set(["OR", "AND", "AND/OR"]);

// PDF Base-14 Helvetica widths (AFM units / 1000), matching PyMuPDF `helv`/`hebo`
// so wrap + cursor math stay identical to credentialing_pdf.py.
const HEL_V = {
  " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667, "'": 191,
  "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556,
  "8": 556, "9": 556, ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556,
  "@": 1015, A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278,
  J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667,
  T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611, "[": 278, "\\": 278,
  "]": 278, "^": 469, _: 556, "`": 333, a: 556, b: 556, c: 500, d: 556, e: 556,
  f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556, o: 556,
  p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500,
  z: 500, "{": 334, "|": 260, "}": 334, "~": 584,
};
const HEL_BO = {
  " ": 278, "!": 333, '"': 474, "#": 556, $: 556, "%": 889, "&": 722, "'": 238,
  "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556,
  "8": 556, "9": 556, ":": 333, ";": 333, "<": 584, "=": 584, ">": 584, "?": 611,
  "@": 975, A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278,
  J: 556, K: 722, L: 611, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667,
  T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611, "[": 333, "\\": 278,
  "]": 333, "^": 584, _: 556, "`": 333, a: 556, b: 611, c: 556, d: 611, e: 556,
  f: 333, g: 611, h: 611, i: 278, j: 278, k: 556, l: 278, m: 889, n: 611, o: 611,
  p: 611, q: 611, r: 389, s: 556, t: 333, u: 611, v: 556, w: 778, x: 556, y: 556,
  z: 500, "{": 389, "|": 280, "}": 389, "~": 584,
};

function afmWidth(text, size, bold) {
  const table = bold ? HEL_BO : HEL_V;
  let w = 0;
  for (const ch of text) w += table[ch] ?? 500;
  return (w * size) / 1000;
}

// ── Verbatim string constants ───────────────────────────────────────────────
const COVER_INSTRUCTIONS_BODY =
  "Please check the box beside each clinical privilege being " +
  "requested. Applicants are required to produce information deemed necessary by the " +
  "center in order to properly evaluate current competence, current clinical activity, " +
  "and other privileging requirements.";

const ACK_BODY =
  "I have requested only those privileges which by education, training, current " +
  "experience, and demonstrated performance I am qualified to perform, and for which " +
  "I wish to exercise at this center. I further understand that:";

const ACK_ITEMS = [
  "A.\tPrivileges requested may differ from those granted and approved;",
  "B.\tCompletion of this form, at the present time, does not preclude me from " +
    "requesting additional privileges in the future;",
  "C.\tThe granting of clinical privileges will be made in conformance with the " +
    "applicable Medical Staff Bylaws and Policies and Procedures;",
  "D.\tFailure to obtain and maintain all threshold criteria set forth above, or " +
    "non-compliance with the applicable Medical Staff Bylaws or Policies or Procedures, " +
    "may constitute grounds for non-renewal or restriction/limitation of clinical privileges.",
];

const MED_DIR_DECLARATION_BODY =
  "The practitioner's request for new, modified, or renewed clinical privileges has " +
  "been reviewed by the Center's Medical Director or an appropriate member of the " +
  "Medical Executive Committee and presented to the Governing Board for approval. " +
  "Privileges that have received a checkmark in the designated column have been " +
  "granted. Any privileges that were requested but not granted are listed below, " +
  "along with an explanation for each determination.";

const MED_DIR_NAME  = "Medical Director: Michael A. Gorin, M.D.";
const DENIED_PRIVS_TITLE = "Privileges Not Granted / Renewed:";

const MED_DIR_BLANK_LINES_BETWEEN         = 2;
const MED_DIR_DATE_TO_DENIED_BLANK_LINES  = 2;
const MED_DIR_POST_DENIED_HALF_LINE_FACTOR= 0.5;

// ── Pure layout math ────────────────────────────────────────────────────────
function tableUsableWidth() {
  return PAGE_W - LEFT_M - RIGHT_M; // 504 pt
}

/** Returns [x0, x1, x2, x3, x4] — the five column edge x-coordinates. */
function columnXEdges() {
  const x0 = LEFT_M;
  const uw  = tableUsableWidth();
  const x1  = x0 + PRIV_TEXT_FRAC * uw;
  const x2  = x1 + PRIV_CB_FRAC   * uw;
  const x3  = x2 + PRIV_CB_FRAC   * uw;
  const x4  = x3 + PRIV_CB_FRAC   * uw;
  return [x0, x1, x2, x3, x4];
}

/** Returns [xs, uw] — the label/value split x and total table width. */
function qualLabelValueSplitX(x0, x4) {
  const uw = x4 - x0;
  return [x0 + QUAL_LABEL_FRAC * uw, uw];
}

// ── Main exported function ─────────────────────────────────────────────────
/**
 * Build a credentialing privileges PDF from source text.
 *
 * @param {string} sourceText   — Raw privilege-list text (same format as .txt file).
 * @param {object} [options]
 * @param {string}  [options.organization]   — Facility / org name for title block.
 * @param {string}  [options.title]          — Document title (not rendered per design).
 * @param {string}  [options.subtitle]       — Second meta line for title block.
 * @param {object}  [options.fieldValues]    — {FullName, DateOfBirth, HomeAddress, LifeNumber}
 * @param {object}  [options.checkboxValues] — Record<fieldName, boolean> for checkboxes.
 * @returns {Promise<Uint8Array>}             — Raw PDF bytes.
 */
export async function buildCredentialingPdf(sourceText, options = {}) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();

  // ── Colour palette (rgb values mirror credentialing_pdf.py) ─────────────
  const BRAND_GREEN   = rgb(38 / 255, 139 / 255, 107 / 255);
  const BRAND_GREY    = rgb(73 / 255,  85 / 255, 102 / 255);
  const STROKE_C      = rgb(0.55, 0.55, 0.55);
  const HEADER_FILL_C = rgb(0.91, 0.91, 0.91);
  const BLACK         = rgb(0, 0, 0);
  const WHITE         = rgb(1, 1, 1);
  const FOOTER_C      = rgb(0.4, 0.4, 0.4);
  const META_C        = rgb(0.2, 0.2, 0.2);

  // ── PDF setup ────────────────────────────────────────────────────────────
  const pdfDoc = await PDFDocument.create();
  const helv   = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const hebo   = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const form   = pdfDoc.getForm();

  const fieldValues    = options.fieldValues    || {};
  const checkboxValues = options.checkboxValues || {};

  // ══════════════════════════════════════════════════════════════════════════
  // Font / text helpers
  // ══════════════════════════════════════════════════════════════════════════

  /** Return helv or hebo depending on whether the token is an emphasis word. */
  function effectiveFont(token, defaultFont) {
    return EMPHASIS_WORDS.has(token.trim()) ? hebo : defaultFont;
  }

  function isBoldFont(font) {
    return font === hebo;
  }

  /**
   * Total rendered width of `text` at `size`, respecting emphasis-word font
   * switching. Uses PyMuPDF-compatible AFM widths (not pdf-lib's metrics).
   */
  function textWidthWithEmphasis(text, size, defaultFont = helv) {
    let w = 0;
    for (const tok of text.match(/\S+|\s+/g) || []) {
      const bold = EMPHASIS_WORDS.has(tok.trim()) ? true : isBoldFont(defaultFont);
      w += afmWidth(tok, size, bold);
    }
    return w;
  }

  /**
   * Word-wrap `text` to fit within `maxW` at `size`.  Hard "\n" forces a line
   * break.  Always uses helv for width calculations (matching Python).
   * Leading spaces are preserved; "- " items wrap with a hanging indent.
   */
  function wrapLines(text, maxW, size) {
    const result = [];
    for (const seg of String(text).split("\n")) {
      const indent = (seg.match(/^ */) || [""])[0];
      const body = seg.slice(indent.length);
      const words = body.split(/\s+/).filter(Boolean);
      if (!words.length) { result.push(""); continue; }
      const hang = body.startsWith("- ") ? indent + "  " : indent;
      let cur = [];
      let prefix = indent;
      for (const w of words) {
        const content = cur.length ? `${cur.join(" ")} ${w}` : w;
        const trial = prefix + content;
        if (textWidthWithEmphasis(trial, size, helv) <= maxW || !cur.length) {
          cur.push(w);
        } else {
          result.push(prefix + cur.join(" "));
          prefix = hang;
          cur = [w];
        }
      }
      if (cur.length) result.push(prefix + cur.join(" "));
    }
    return result.length ? result : [""];
  }

  const ADD_REQ_ITEM_PREFIX = "    - ";
  const HALF_LINE_GAP = 0.5;

  function wrapLinesWithItemGaps(text, maxW, size) {
    const segments = String(text).split("\n");
    const out = [];
    for (let i = 0; i < segments.length; i++) {
      const wrapped = wrapLines(segments[i], maxW, size);
      const next = segments[i + 1] || "";
      const gap =
        segments[i].startsWith(ADD_REQ_ITEM_PREFIX) && next.startsWith(ADD_REQ_ITEM_PREFIX)
          ? HALF_LINE_GAP
          : 0;
      wrapped.forEach((line, j) => {
        out.push({ text: line, gapAfter: j === wrapped.length - 1 ? gap : 0 });
      });
    }
    return out.length ? out : [{ text: "", gapAfter: 0 }];
  }

  function wrappedLayoutHeight(items, size) {
    const leading = size * LINE_H_FACTOR;
    let h = 0;
    for (const it of items) h += leading * (1 + it.gapAfter);
    return h;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Drawing primitives — PyMuPDF coordinate convention (y from top)
  // ══════════════════════════════════════════════════════════════════════════

  function drawRectPy(page, x0, pyTop, x1, pyBottom, fillColor, borderColor, borderWidth) {
    const opts = {
      x:      x0,
      y:      PAGE_H - pyBottom,   // pdf-lib bottom-left y
      width:  x1 - x0,
      height: pyBottom - pyTop,
      color:  fillColor,
    };
    if (borderWidth > 0) {
      opts.borderColor = borderColor;
      opts.borderWidth = borderWidth;
    }
    page.drawRectangle(opts);
  }

  function drawLinePy(page, ax, ayPy, bx, byPy, color, thickness) {
    page.drawLine({
      start:     { x: ax, y: PAGE_H - ayPy },
      end:       { x: bx, y: PAGE_H - byPy },
      color,
      thickness,
    });
  }

  /**
   * Draw `text` glyph-by-glyph, switching to hebo for emphasis words.
   * Mirrors Python's _draw_text_with_emphasis().
   * pyBaseline — y from TOP of page (PyMuPDF convention).
   */
  function drawTextWithEmphasis(page, x, pyBaseline, text, size, defaultFont, color) {
    let cursor = x;
    for (const tok of text.match(/\S+|\s+/g) || []) {
      const font = effectiveFont(tok, defaultFont);
      const bold = EMPHASIS_WORDS.has(tok.trim()) ? true : isBoldFont(defaultFont);
      const tw = afmWidth(tok, size, bold);
      if (tok.trim()) {
        page.drawText(tok, { x: cursor, y: PAGE_H - pyBaseline, size, font, color });
      }
      cursor += tw;
    }
  }

  /**
   * Insert text vertically centred inside a cell.  Mirrors _vcenter_insert().
   *
   * @param defaultFont  helv or hebo — the "normal" font for this cell's text.
   *                     Emphasis words always use hebo regardless.
   * @param align        0=left, 1=centre, 2=right
   * @param hPad         horizontal padding inside the cell (default 6)
   */
  function vCenterInsert(page, x0, pyTop, x1, pyBottom, text, size, defaultFont, color, align = 0, hPad = 6) {
    if (!text) return;
    const iX0   = x0 + hPad;
    const iX1   = x1 - hPad;
    const iW    = Math.max(iX1 - iX0, 10);
    const items = wrapLinesWithItemGaps(text, iW, size);
    const leading = size * LINE_H_FACTOR;
    const textH = wrappedLayoutHeight(items, size);
    const top   = pyTop + Math.max(0, (pyBottom - pyTop - textH) / 2);
    let pyBL    = top + size;
    for (const it of items) {
      const draw = it.text || " ";
      const w    = textWidthWithEmphasis(draw, size, defaultFont);
      let x = iX0;
      if (align === 1) x = iX0 + Math.max(0, (iW - w) / 2);
      else if (align === 2) x = Math.max(iX0, iX1 - w);
      drawTextWithEmphasis(page, x, pyBL, draw, size, defaultFont, color);
      pyBL += leading * (1 + it.gapAfter);
    }
  }

  /**
   * Render wrapped text line-by-line.  Mirrors draw_wrapped_text().
   */
  function drawWrappedText(page, x0, pyTop, x1, pyBottom, text, size, defaultFont, color, leading, align = 0) {
    const lines = wrapLines(text, Math.max(x1 - x0, 10), size);
    let pyBL = pyTop + size;
    for (const line of lines) {
      if (pyBL > pyBottom) break;
      const draw = line || " ";
      let x = x0;
      if (align !== 0) {
        const w = textWidthWithEmphasis(draw, size, defaultFont);
        if (align === 1) x = x0 + Math.max(0, (x1 - x0 - w) / 2);
        else if (align === 2) x = Math.max(x0, x1 - w);
      }
      drawTextWithEmphasis(page, x, pyBL, draw, size, defaultFont, color);
      pyBL += leading;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Height estimators (mirrors the Python _*_height helpers)
  // ══════════════════════════════════════════════════════════════════════════

  function twoColQualRowHeight(label, value, labelColW, valueColW) {
    const pad  = 2 * QUAL_CELL_H_PAD;
    const nLab = wrapLines(label, Math.max(labelColW - pad, 20), QUAL_FONT).length;
    const nVal = wrapLines(value, Math.max(valueColW - pad, 20), QUAL_FONT).length;
    return Math.max(nLab, nVal, 1) * QUAL_LEADING + 2 * QUAL_ROW_PAD;
  }

  function sectionTitleBarHeight(title) {
    const [x0, , , , x4] = columnXEdges();
    const uw = x4 - x0; // total table width (matches Python's qual_label_value_split_x uw)
    const n  = wrapLines(title.trim(), uw - 16, SECTION_TITLE_FONT).length;
    return Math.max(QUAL_BAR_H, Math.max(n, 1) * SECTION_LEADING + 2 * SECTION_PAD);
  }

  function privHeaderHeight() {
    const [, x1, x2] = columnXEdges();
    const cbInner  = Math.max(x2 - x1 - 4, 10); // h_pad=2 each side
    const labels   = ["Newly Requested", "Currently\nHeld", "Granted / Renewed"];
    const maxLines = Math.max(...labels.map(l => wrapLines(l, cbInner, CB_HDR_FONT).length));
    return maxLines * CB_HDR_FONT * LINE_H_FACTOR + 2 * CB_HDR_V_PAD;
  }

  function ackHeight(uw) {
    const pad   = 8;
    const bodyH = wrapLines(ACK_BODY, uw - 2 * pad, ACK_FONT).length * ACK_LEADING;
    // Python uses uw - 2*pad - 16 as a compact estimate for the item text column
    const itemsH = ACK_ITEMS.reduce((sum, item) => {
      const norm = item.replace("\t", "    ");
      return sum + wrapLines(norm, uw - 2 * pad - 16, ACK_FONT).length * ACK_LEADING;
    }, 0);
    return QUAL_BAR_H + pad + bodyH + 4 + itemsH + pad + 40 /* sig area */ + pad;
  }

  function medDirHeight(uw) {
    const pad       = 8;
    const bodyH     = wrapLines(MED_DIR_DECLARATION_BODY, uw - 2 * pad, ACK_FONT).length * ACK_LEADING + 4;
    const infoLineH = ACK_LEADING + 4;
    const infoGapH  = MED_DIR_BLANK_LINES_BETWEEN * infoLineH;
    const sigLblH   = ACK_FONT * ACK_LINE_FACTOR + 2;
    const sigBlockH = 24 + 4 + sigLblH; // line gap + label
    const infoH     = infoLineH + infoGapH + sigBlockH;
    const deniedRowH= ACK_LEADING + 8;
    const postGap   = deniedRowH * MED_DIR_POST_DENIED_HALF_LINE_FACTOR;
    const denGap    = MED_DIR_DATE_TO_DENIED_BLANK_LINES * infoLineH;
    return (
      QUAL_BAR_H + pad + bodyH + 8 + infoH +
      denGap + (ACK_LEADING + 4) + 10 * deniedRowH + postGap + pad
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // AcroForm widget helpers
  // ══════════════════════════════════════════════════════════════════════════

  function addCheckbox(page, cx, pyCy, name) {
    const half = CB_SIZE / 2;
    const cb = form.createCheckBox(name);
    // pdf-lib addToPage: {x, y} is the bottom-left corner; y is from page bottom
    cb.addToPage(page, {
      x:      cx - half,
      y:      PAGE_H - pyCy - half,  // convert centre-from-top → bottom-left-from-bottom
      width:  CB_SIZE,
      height: CB_SIZE,
    });
    if (checkboxValues[name]) cb.check();
  }

  function addTextField(page, name, x0, pyTop, x1, pyBottom) {
    const tf = form.createTextField(name);
    tf.addToPage(page, {
      x:      x0,
      y:      PAGE_H - pyBottom,
      width:  x1 - x0,
      height: pyBottom - pyTop,
    });
    const val = fieldValues[name] || "";
    if (val) tf.setText(val);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Section-table drawing helpers
  // ══════════════════════════════════════════════════════════════════════════

  /** Row 1: green section title bar. Returns new y. */
  function drawSectionTitleBar(page, y, title) {
    const [x0, , , , x4] = columnXEdges();
    const uw    = x4 - x0;
    const tLines= wrapLines(title.trim(), uw - 16, SECTION_TITLE_FONT);
    const h     = Math.max(QUAL_BAR_H, Math.max(1, tLines.length) * SECTION_LEADING + 2 * SECTION_PAD);
    drawRectPy(page, x0, y, x4, y + h, BRAND_GREEN, BRAND_GREEN, 0.5);
    vCenterInsert(page, x0, y, x4, y + h, tLines.join("\n") || " ",
                  SECTION_TITLE_FONT, helv, WHITE, 0, 8);
    return y + h;
  }

  /** Row 2: grey Qualifications bar. Returns new y. */
  function drawQualificationsBar(page, y) {
    const [x0, , , , x4] = columnXEdges();
    drawRectPy(page, x0, y, x4, y + QUAL_BAR_H, BRAND_GREY, BRAND_GREY, 0.5);
    vCenterInsert(page, x0, y, x4, y + QUAL_BAR_H,
                  "Qualifications", 11, helv, WHITE, 0, 8);
    return y + QUAL_BAR_H;
  }

  /** Rows 3-5: one 25%/75% qualification detail row. Returns new y. */
  function drawQualDetailRow(page, y, label, value) {
    const [x0, , , , x4] = columnXEdges();
    const [xs]  = qualLabelValueSplitX(x0, x4);
    const rh    = twoColQualRowHeight(label, value, xs - x0, x4 - xs);
    drawRectPy(page, x0, y, x4, y + rh, WHITE, STROKE_C, 0.5);
    drawLinePy(page, xs, y, xs, y + rh, STROKE_C, 0.5);
    vCenterInsert(page, x0, y, xs, y + rh, label, QUAL_FONT, helv, BLACK, 0, QUAL_CELL_H_PAD);
    vCenterInsert(page, xs, y, x4, y + rh, value, QUAL_FONT, helv, BLACK, 0, QUAL_CELL_H_PAD);
    return y + rh;
  }

  /** Row 6: privilege column header row (70/10/10/10). Returns new y. */
  function drawPrivHeaderRow(page, y) {
    const [x0, x1, x2, x3, x4] = columnXEdges();
    const h = privHeaderHeight();
    drawRectPy(page, x0, y, x4, y + h, HEADER_FILL_C, STROKE_C, 0.5);
    drawLinePy(page, x1, y, x1, y + h, STROKE_C,         0.5);
    drawLinePy(page, x2, y, x2, y + h, STROKE_C,         0.5);
    drawLinePy(page, x3, y, x3, y + h, BLACK, GRANTED_DIVIDER_W); // thicker before Granted
    vCenterInsert(page, x0, y, x1, y + h, "Privilege",         QUAL_FONT,   helv, BLACK, 0, 6);
    vCenterInsert(page, x1, y, x2, y + h, "Newly Requested",   CB_HDR_FONT, helv, BLACK, 1, 2);
    vCenterInsert(page, x2, y, x3, y + h, "Currently\nHeld",   CB_HDR_FONT, helv, BLACK, 1, 2);
    vCenterInsert(page, x3, y, x4, y + h, "Granted / Renewed", CB_HDR_FONT, helv, BLACK, 1, 2);
    return y + h;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Cover page
  // ══════════════════════════════════════════════════════════════════════════

  function drawCoverPage(specialty) {
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    const x0 = LEFT_M, x1 = PAGE_W - RIGHT_M, uw = x1 - x0;
    let y = TOP_M;

    // Specialty name — BRAND_GREEN, centred, 18 pt
    const specW = afmWidth(specialty, 18, false);
    page.drawText(specialty, {
      x: x0 + (uw - specW) / 2,
      y: PAGE_H - (y + 18),
      size: 18, font: helv, color: BRAND_GREEN,
    });
    y += 18 * LINE_H_FACTOR;

    // "Delineation of Privileges" — black, centred, 12 pt
    const dop  = "Delineation of Privileges";
    const dopW = afmWidth(dop, 12, false);
    page.drawText(dop, {
      x: x0 + (uw - dopW) / 2,
      y: PAGE_H - (y + 12),
      size: 12, font: helv, color: BLACK,
    });
    y += 12 * LINE_H_FACTOR + 20;

    // Applicant Information box ─────────────────────────────────────────────
    const fFont = 10, fH = 18, iPad = 8, rGap = 4;
    const fields = [
      ["Full Name:",                  "FullName"],
      ["Date of Birth:",              "DateOfBirth"],
      ["Home Address:",               "HomeAddress"],
      ["Life Number (if available):", "LifeNumber"],
    ];
    const lblWs   = fields.map(([lbl]) => afmWidth(lbl, fFont, false) + 6);
    const maxLblW = Math.max(...lblWs);
    const hdrLblH = 11 * LINE_H_FACTOR + 2;              // bold header height
    const rowsH   = fields.length * (fH + rGap) - rGap;
    const boxH    = iPad + hdrLblH + 4 + rowsH + iPad;

    // Outer box — black border, white fill
    drawRectPy(page, x0, y, x1, y + boxH, WHITE, BLACK, OUTER_BORDER_W);

    // "Applicant Information" — bold, top of box
    vCenterInsert(page, x0 + iPad, y, x1, y + hdrLblH + iPad,
                  "Applicant Information", 11, hebo, BLACK, 0);
    y += iPad + hdrLblH + 4;

    // Individual fields
    const indent = iPad * 2;
    for (const [label, fname] of fields) {
      page.drawText(label, {
        x: x0 + indent,
        y: PAGE_H - (y + fFont),
        size: fFont, font: helv, color: BLACK,
      });
      addTextField(page, fname, x0 + indent + maxLblW + 4, y, x1 - iPad, y + fH);
      y += fH + rGap;
    }
    y += iPad + 16;

    // Instructions ──────────────────────────────────────────────────────────
    const lh10 = 10 * LINE_H_FACTOR + 2; // ~14.5 pt
    page.drawText("Instructions:", {
      x: x0, y: PAGE_H - (y + 10), size: 10, font: hebo, color: BLACK,
    });
    y += lh10;
    const bodyLines = wrapLines(COVER_INSTRUCTIONS_BODY, uw, 10);
    const bodyH = bodyLines.length * 10 * LINE_H_FACTOR + 4;
    drawWrappedText(page, x0, y, x1, y + bodyH,
                    COVER_INSTRUCTIONS_BODY, 10, helv, BLACK, 10 * LINE_H_FACTOR);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Acknowledgment box
  // ══════════════════════════════════════════════════════════════════════════

  function drawAcknowledgment(page, y) {
    const [x0, , , , x4] = columnXEdges();
    const uw = x4 - x0, pad = 8;
    const totalH = ackHeight(uw);

    drawRectPy(page, x0, y, x4, y + totalH, WHITE, BLACK, OUTER_BORDER_W);

    // Header bar — brand grey, inset inside outer border
    const inset = OUTER_BORDER_W / 2;
    drawRectPy(page, x0 + inset, y + inset, x4 - inset, y + QUAL_BAR_H,
               BRAND_GREY, BRAND_GREY, 0);
    vCenterInsert(page, x0 + inset, y + inset, x4 - inset, y + QUAL_BAR_H,
                  "Acknowledgment of Practitioner", 11, helv, WHITE, 0, 8);
    y += QUAL_BAR_H + pad;

    // Body paragraph
    const bodyLines = wrapLines(ACK_BODY, uw - 2 * pad, ACK_FONT);
    const bodyH     = bodyLines.length * ACK_LEADING + 4;
    drawWrappedText(page, x0 + pad, y, x4 - pad, y + bodyH,
                    ACK_BODY, ACK_FONT, helv, BLACK, ACK_LEADING);
    y += bodyH;

    // Lettered items A–D
    const letterW = afmWidth("A.    ", ACK_FONT, false);
    for (const item of ACK_ITEMS) {
      const ti     = item.indexOf("\t");
      const letter = ti >= 0 ? item.slice(0, ti) : "";
      const rest   = ti >= 0 ? item.slice(ti + 1) : item;
      const itemLines = wrapLines(rest, uw - 2 * pad - letterW, ACK_FONT);
      const itemH     = itemLines.length * ACK_LEADING + 2;
      if (letter) {
        page.drawText(letter, {
          x: x0 + pad, y: PAGE_H - (y + ACK_FONT),
          size: ACK_FONT, font: helv, color: BLACK,
        });
      }
      drawWrappedText(page, x0 + pad + letterW, y, x4 - pad, y + itemH,
                      rest, ACK_FONT, helv, BLACK, ACK_LEADING);
      y += itemH;
    }
    y += pad;

    // Signature lines — equal width, 80 % of max half-column
    const sigLineY  = y + 24;
    const lineGap   = 24;
    const maxLineW  = (uw - 2 * pad - lineGap) / 2;
    const lineW     = maxLineW * 0.80;
    const colW      = maxLineW;
    const sigStart  = x0 + pad + (colW - lineW) / 2;
    const sigEnd    = sigStart + lineW;
    const datStart  = x0 + pad + colW + lineGap + (colW - lineW) / 2;
    const datEnd    = datStart + lineW;

    drawLinePy(page, sigStart, sigLineY, sigEnd,  sigLineY, BLACK, 0.5);
    drawLinePy(page, datStart, sigLineY, datEnd,  sigLineY, BLACK, 0.5);

    const sigLblY = sigLineY + 4;
    const lblH    = ACK_FONT * ACK_LINE_FACTOR + 2;

    const sigLbl  = "Practitioner's Signature";
    const sigLblW = afmWidth(sigLbl, ACK_FONT, false);
    page.drawText(sigLbl, {
      x: sigStart + Math.max(0, (lineW - sigLblW) / 2),
      y: PAGE_H - (sigLblY + ACK_FONT),
      size: ACK_FONT, font: helv, color: BLACK,
    });

    const datLbl  = "Date";
    const datLblW = afmWidth(datLbl, ACK_FONT, false);
    page.drawText(datLbl, {
      x: datStart + Math.max(0, (lineW - datLblW) / 2),
      y: PAGE_H - (sigLblY + ACK_FONT),
      size: ACK_FONT, font: helv, color: BLACK,
    });

    return sigLblY + lblH + pad;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Medical Director Declaration box
  // ══════════════════════════════════════════════════════════════════════════

  function drawMedDirDeclaration(page, y) {
    const [x0, , , , x4] = columnXEdges();
    const uw = x4 - x0, pad = 8;
    const totalH = medDirHeight(uw);

    drawRectPy(page, x0, y, x4, y + totalH, WHITE, BLACK, OUTER_BORDER_W);

    // Header bar — brand grey
    const inset = OUTER_BORDER_W / 2;
    drawRectPy(page, x0 + inset, y + inset, x4 - inset, y + QUAL_BAR_H,
               BRAND_GREY, BRAND_GREY, 0);
    vCenterInsert(page, x0 + inset, y + inset, x4 - inset, y + QUAL_BAR_H,
                  "Medical Director Declaration", 11, helv, WHITE, 0, 8);
    y += QUAL_BAR_H + pad;

    // Body paragraph
    const bodyLines = wrapLines(MED_DIR_DECLARATION_BODY, uw - 2 * pad, ACK_FONT);
    const bodyH     = bodyLines.length * ACK_LEADING + 4;
    drawWrappedText(page, x0 + pad, y, x4 - pad, y + bodyH,
                    MED_DIR_DECLARATION_BODY, ACK_FONT, helv, BLACK, ACK_LEADING);
    y += bodyH + 8;

    // Medical Director name
    const infoLineH = ACK_LEADING + 4;
    const infoGapH  = MED_DIR_BLANK_LINES_BETWEEN * infoLineH;
    page.drawText(MED_DIR_NAME, {
      x: x0 + pad, y: PAGE_H - (y + ACK_FONT),
      size: ACK_FONT, font: helv, color: BLACK,
    });
    y += infoLineH + infoGapH;

    // Signature / date lines
    const sigLineY = y + 24;
    const lineGap  = 24;
    const maxLineW = (uw - 2 * pad - lineGap) / 2;
    const lineW    = maxLineW * 0.80;
    const colW     = maxLineW;
    const sigStart = x0 + pad + (colW - lineW) / 2;
    const sigEnd   = sigStart + lineW;
    const datStart = x0 + pad + colW + lineGap + (colW - lineW) / 2;
    const datEnd   = datStart + lineW;

    drawLinePy(page, sigStart, sigLineY, sigEnd,  sigLineY, BLACK, 0.5);
    drawLinePy(page, datStart, sigLineY, datEnd,  sigLineY, BLACK, 0.5);

    const sigLblY = sigLineY + 4;
    const lblH    = ACK_FONT * ACK_LINE_FACTOR + 2;

    const sigLbl  = "Signature";
    const sigLblW = afmWidth(sigLbl, ACK_FONT, false);
    page.drawText(sigLbl, {
      x: sigStart + Math.max(0, (lineW - sigLblW) / 2),
      y: PAGE_H - (sigLblY + ACK_FONT),
      size: ACK_FONT, font: helv, color: BLACK,
    });

    const datLbl  = "Date";
    const datLblW = afmWidth(datLbl, ACK_FONT, false);
    page.drawText(datLbl, {
      x: datStart + Math.max(0, (lineW - datLblW) / 2),
      y: PAGE_H - (sigLblY + ACK_FONT),
      size: ACK_FONT, font: helv, color: BLACK,
    });

    y = sigLblY + lblH;

    // Gap before denied-privileges section
    y += MED_DIR_DATE_TO_DENIED_BLANK_LINES * infoLineH;

    // "Privileges Not Granted / Renewed:" label
    const lblRowH = ACK_LEADING + 4;
    page.drawText(DENIED_PRIVS_TITLE, {
      x: x0 + pad, y: PAGE_H - (y + ACK_FONT),
      size: ACK_FONT, font: helv, color: BLACK,
    });
    y += lblRowH;

    // 10 numbered blank lines for denied privileges
    const deniedRowH = ACK_LEADING + 8;
    const numColW    = afmWidth("10.", ACK_FONT, false) + 6;
    const lineX0     = x0 + pad + numColW + 6;
    const lineX1     = x4 - pad;
    for (let i = 1; i <= 10; i++) {
      const lineY = y + deniedRowH - 2;
      page.drawText(`${i}.`, {
        x: x0 + pad, y: PAGE_H - lineY,
        size: ACK_FONT, font: helv, color: BLACK,
      });
      drawLinePy(page, lineX0, lineY, lineX1, lineY, BLACK, 0.5);
      y += deniedRowH;
    }

    y += deniedRowH * MED_DIR_POST_DENIED_HALF_LINE_FACTOR;
    return y + pad;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Footer — stamped on every page after all pages exist
  // ══════════════════════════════════════════════════════════════════════════

  function drawFooters(versionDate) {
    const pages = pdfDoc.getPages();
    const total = pages.length;
    const x0 = LEFT_M, x1 = PAGE_W - RIGHT_M;
    // Python: y0 = PAGE_H - BOTTOM_M + 6 = 751.2 pt from top
    // baseline = y0 + FOOTER_FONT = 759.2 pt from top
    const pyBaseline = (PAGE_H - BOTTOM_M + 6) + FOOTER_FONT;
    const pdfY       = PAGE_H - pyBaseline;
    for (let n = 0; n < total; n++) {
      const p = pages[n];
      p.drawText(versionDate, { x: x0, y: pdfY, size: FOOTER_FONT, font: helv, color: FOOTER_C });
      const pgText = `Page ${n + 1} of ${total}`;
      const pgW    = afmWidth(pgText, FOOTER_FONT, false);
      p.drawText(pgText, { x: x1 - pgW, y: pdfY, size: FOOTER_FONT, font: helv, color: FOOTER_C });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Main layout loop — mirrors build_pdf() in credentialing_pdf.py
  // ══════════════════════════════════════════════════════════════════════════

  const blocks = parseDocument(sourceText || "");

  // Extract metadata
  let specialtyName = null, rawVersion = null;
  for (const b of blocks) {
    if (b.type === "specialty" && !specialtyName) specialtyName = b.name;
    else if (b.type === "version"  && !rawVersion)  rawVersion  = b.date;
  }
  const defaultVersion = new Date().toLocaleString("en-US", { month: "long", year: "numeric" });
  const versionDate    = `Version: ${rawVersion || defaultVersion}`;
  const contentBlocks  = blocks.filter(b => !["specialty", "version", "logo"].includes(b.type));

  // Cover page (optional — only when a SPECIALTY: block is present)
  if (specialtyName) drawCoverPage(specialtyName);

  // First privilege page
  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const [x0, x1, x2, x3, x4] = columnXEdges();
  const textW = x1 - x0 - 12; // inner text width (left column minus padding)
  let y = TOP_M;

  // Title block: org / subtitle meta line (title text suppressed per design)
  const metaParts = [options.organization, options.subtitle].filter(Boolean);
  if (metaParts.length) {
    page.drawText(metaParts.join(" — "), {
      x: x0, y: PAGE_H - (y + 10), size: 10, font: helv, color: META_C,
    });
    y += 20;
  }
  const titleBottom = y; // detect "first section on this page, nothing drawn yet"

  // ── Section border tracking ───────────────────────────────────────────────
  // A section may span multiple pages.  We record (page, topY, bottomY) for
  // each page-segment, then draw the outer border in one pass at section end.
  let secSegs  = [];   // { p, ty, by }
  let secPage  = null;
  let secTopY  = null;

  function openSeg()  { secPage = page; secTopY = y; }
  function closeSeg() {
    if (secPage !== null) {
      secSegs.push({ p: secPage, ty: secTopY, by: y });
      secPage = null; secTopY = null;
    }
  }

  function newPage() {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    y = TOP_M;
  }

  function pageBreakInSection() { closeSeg(); newPage(); openSeg(); }

  function ensureFits(h) {
    if (y + h > PAGE_H - BOTTOM_M) pageBreakInSection();
  }

  /** Render rows 1-6 for a new section. */
  function renderSectionHeader(title, q) {
    // Row 1
    ensureFits(sectionTitleBarHeight(title));
    if (secPage === null) openSeg();
    y = drawSectionTitleBar(page, y, title);
    // Row 2
    ensureFits(QUAL_BAR_H);
    y = drawQualificationsBar(page, y);
    // Rows 3-5 — qual detail rows (Education & Training, ±Certification, New Privilege, Renewal)
    for (const [lab, val] of qualDetailRows(q)) {
      const [qx0, , , , qx4] = columnXEdges();
      const [xs] = qualLabelValueSplitX(qx0, qx4);
      ensureFits(twoColQualRowHeight(lab, val, xs - qx0, qx4 - xs));
      y = drawQualDetailRow(page, y, lab, val);
    }
    // Row 6
    ensureFits(privHeaderHeight());
    y = drawPrivHeaderRow(page, y);
  }

  /**
   * Close the current section: record final segment, then draw outer border
   * lines on every page-segment that belongs to this section.
   */
  function closeSection() {
    closeSeg();
    const segs = secSegs; secSegs = [];
    if (!segs.length) return;
    const nSegs = segs.length;
    for (let i = 0; i < nSegs; i++) {
      const { p, ty, by } = segs[i];
      const isFirst = i === 0, isLast = i === nSegs - 1;
      // Left and right — always solid black
      drawLinePy(p, x0, ty, x0, by, BLACK, OUTER_BORDER_W);
      drawLinePy(p, x4, ty, x4, by, BLACK, OUTER_BORDER_W);
      // Top — black on first page, grey (continuation) on subsequent pages
      drawLinePy(p, x0, ty, x4, ty,
                 isFirst ? BLACK : STROKE_C,
                 isFirst ? OUTER_BORDER_W : 0.5);
      // Bottom — black on last page, grey (continues overleaf) otherwise
      drawLinePy(p, x0, by, x4, by,
                 isLast ? BLACK : STROKE_C,
                 isLast ? OUTER_BORDER_W : 0.5);
    }
  }

  let needPrivHeader = true;
  let privIdx        = 0;
  let pendingSection = null;

  for (const b of contentBlocks) {

    // ── SECTION ────────────────────────────────────────────────────────────
    if (b.type === "section") {
      if (!b.title.trim()) continue;
      closeSection();
      // Always start a new page per section — unless still on the first page
      // and nothing else has been drawn yet.
      if (y > titleBottom) newPage();
      pendingSection = b.title.trim();
      continue;
    }

    // ── QUALIFICATIONS ─────────────────────────────────────────────────────
    if (b.type === "qualifications") {
      renderSectionHeader(pendingSection !== null ? pendingSection : "", b);
      pendingSection = null;
      needPrivHeader = false;
      continue;
    }

    // ── SUBGROUP ───────────────────────────────────────────────────────────
    if (b.type === "subgroup") {
      if (pendingSection !== null) {
        renderSectionHeader(pendingSection, null);
        pendingSection = null;
        needPrivHeader = false;
      }
      if (needPrivHeader) {
        if (y + HEADER_H + 40 > PAGE_H - BOTTOM_M) pageBreakInSection();
        if (secPage === null) openSeg();
        y = drawPrivHeaderRow(page, y);
        needPrivHeader = false;
      }

      const lns = wrapLines(b.text, textW, QUAL_FONT);
      const rH  = Math.max(HEADER_H, lns.length * QUAL_LEADING + 2 * QUAL_ROW_PAD);
      if (y + rH > PAGE_H - BOTTOM_M) {
        pageBreakInSection();
        y = drawPrivHeaderRow(page, y);
      }

      const rt = y;
      drawRectPy(page, x0, rt, x4, rt + rH, WHITE, STROKE_C, 0.5);
      drawLinePy(page, x1, rt, x1, rt + rH, STROKE_C,         0.5);
      drawLinePy(page, x2, rt, x2, rt + rH, STROKE_C,         0.5);
      drawLinePy(page, x3, rt, x3, rt + rH, BLACK, GRANTED_DIVIDER_W);
      // Subgroup rows are rendered bold (EMPHASIS_FONT / hebo as default)
      vCenterInsert(page, x0, rt, x1, rt + rH, b.text, QUAL_FONT, hebo, BLACK, 0);
      y = rt + rH;
      continue;
    }

    // ── PRIVILEGE ──────────────────────────────────────────────────────────
    if (b.type === "privilege") {
      if (pendingSection !== null) {
        renderSectionHeader(pendingSection, null);
        pendingSection = null;
        needPrivHeader = false;
      }
      if (needPrivHeader) {
        if (y + HEADER_H + 40 > PAGE_H - BOTTOM_M) pageBreakInSection();
        if (secPage === null) openSeg();
        y = drawPrivHeaderRow(page, y);
        needPrivHeader = false;
      }

      privIdx += 1;
      const iOff  = b.indent ? 16 : 0;
      const items = wrapLinesWithItemGaps(b.text, Math.max(20, textW - iOff), QUAL_FONT);
      const rH    = Math.max(HEADER_H, wrappedLayoutHeight(items, QUAL_FONT) + 2 * QUAL_ROW_PAD);

      if (y + rH > PAGE_H - BOTTOM_M) {
        pageBreakInSection();
        y = drawPrivHeaderRow(page, y);
      }

      const rt = y;
      drawRectPy(page, x0, rt, x4, rt + rH, WHITE, STROKE_C, 0.5);
      drawLinePy(page, x1, rt, x1, rt + rH, STROKE_C,         0.5);
      drawLinePy(page, x2, rt, x2, rt + rH, STROKE_C,         0.5);
      drawLinePy(page, x3, rt, x3, rt + rH, BLACK, GRANTED_DIVIDER_W);
      vCenterInsert(page, x0 + iOff, rt, x1, rt + rH, b.text, QUAL_FONT, helv, BLACK, 0);

      // Three checkboxes, centred in each checkbox column
      const cy  = rt + rH / 2;
      const cxA = (x1 + x2) / 2;
      const cxB = (x2 + x3) / 2;
      const cxC = (x3 + x4) / 2;
      addCheckbox(page, cxA, cy, `NewlyRequested_${privIdx}`);
      addCheckbox(page, cxB, cy, `CurrentlyHeld_${privIdx}`);
      addCheckbox(page, cxC, cy, `GrantedRenewed_${privIdx}`);

      y = rt + rH;
    }
  }

  // Handle a section title that had no content blocks after it
  if (pendingSection !== null) renderSectionHeader(pendingSection, null);
  closeSection();

  // ── Acknowledgment box ────────────────────────────────────────────────────
  // Keep on the same page if it fits; otherwise start a new page.
  const ackGap = ACK_GAP_LINES * QUAL_LEADING;
  const ackH   = ackHeight(x4 - x0);
  if (y + ackGap + ackH > PAGE_H - BOTTOM_M) {
    newPage();
  } else {
    y += ackGap;
  }
  y = drawAcknowledgment(page, y);  // eslint-disable-line no-unused-vars

  // ── Medical Director Declaration — always on its own new page ─────────────
  newPage();
  y = TOP_M;
  drawMedDirDeclaration(page, y);   // eslint-disable-line no-unused-vars

  // ── Footers ───────────────────────────────────────────────────────────────
  drawFooters(versionDate);

  return pdfDoc.save();
}
