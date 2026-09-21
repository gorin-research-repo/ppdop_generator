"""
Generate a credentialing privileges PDF: section titles, optional qualifications
blocks, and privilege rows with three interactive checkbox columns.

Text file format
----------------
Lines starting with # are comments (inline # also starts a comment).

Simple list (no SECTION / QUALIFICATIONS keywords): one privilege per line.

Structured document (use SECTION and/or QUALIFICATIONS anywhere):

  SECTION
  Esophageal procedures including esophagectomy, esophago-gastrectomy, ...

  QUALIFICATIONS
  New Privilege: ...
  Renewal of Privilege: ...
  FPPE Plan:

  First privilege line for this category
  Second privilege line

You may use SECTION: Full title on one line instead of SECTION then lines.
After SECTION, title may continue on following lines until a blank line.

Qualification lines use the keys New Privilege:, Renewal of Privilege:, and
FPPE Plan: or FFPE Plan: (case-insensitive). Continue long values on the next
line by indenting with two or more spaces (or a tab).

Each SECTION renders as one table: (1) section name on blue with white bold text,
(2) Qualifications bar on gray, (3–5) New Privilege / Renewal / FFPE rows at
25%/75%, (6) privilege header row at 70%/10%/10%/10% with light gray background,
then privilege lines with three checkbox columns. Plain lists omit rows 1–5.
"""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path

# Import PyMuPDF via the package name `pymupdf` so we do not load an unrelated
# PyPI package named `fitz` (common in conda envs that also install `fitz`).
try:
    import pymupdf as fitz
except ImportError as exc:
    raise ImportError(
        "PyMuPDF is required. Install it with: pip install pymupdf\n"
        "If imports still fail, remove the wrong package: pip uninstall fitz"
    ) from exc

PAGE_W, PAGE_H = fitz.paper_rect("letter").width, fitz.paper_rect("letter").height
LEFT_M = 0.75 * 72
RIGHT_M = 0.75 * 72
TOP_M = 0.65 * 72
BOTTOM_M = 0.65 * 72
# Privilege grid: 70% text + 10% + 10% + 10% (checkbox columns)
PRIV_TEXT_FRAC = 0.70
PRIV_CB_FRAC = 0.10
# Qualification detail rows: 25% label / 75% value
QUAL_LABEL_FRAC = 0.225  # ~10% narrower than the original 0.25

HEADER_H = 28
LINE_H = 13
ROW_PAD = 8
CB_SIZE = 14
# ── PeakPoint brand palette ──────────────────────────────────────────────────
# Green  (#35A98B) used for section header bars
BRAND_GREEN = (38/255, 139/255, 107/255)   # R=38 G=139 B=107 (exact from brand swatch)
# Dark charcoal-grey (#3D4F65) used for Qualifications bars
BRAND_GREY  = (73/255, 85/255, 102/255)   # R=73 G=85 B=102 (exact from brand swatch)
# 30 % brand grey blended over white — used as privilege row fill
_g = BRAND_GREY
BRAND_GREY_30 = (0.7 + 0.3 * _g[0], 0.7 + 0.3 * _g[1], 0.7 + 0.3 * _g[2])
# ─────────────────────────────────────────────────────────────────────────────

STROKE = (0.55, 0.55, 0.55)
HEADER_FILL = (0.91, 0.91, 0.91)
ROW_ALT = BRAND_GREY_30   # all privilege data rows use 30 % brand grey
GRANTED_DIVIDER_W = 0.8
GRANTED_DIVIDER_COLOR = (0, 0, 0)

SECTION_BLUE = BRAND_GREEN
SECTION_TITLE_FONT = 11
# Global line spacing across document text.
LINE_H_FACTOR = 1.25
OUTER_BORDER_W = 1.15
SECTION_LEADING = SECTION_TITLE_FONT * LINE_H_FACTOR
SECTION_PAD = 4
FONT_REG = "helv"

QUAL_BAR_GRAY = BRAND_GREY
QUAL_BAR_H = 22
QUAL_ROW_PAD = 4
QUAL_CELL_H_PAD = 6
QUAL_FONT = 9
QUAL_LEADING = QUAL_FONT * LINE_H_FACTOR
LOGO_X_NUDGE = -5  # visual centering adjustment (points)


@dataclass(frozen=True)
class SpecialtyBlock:
    name: str


@dataclass(frozen=True)
class VersionBlock:
    date: str


@dataclass(frozen=True)
class LogoBlock:
    path: str


@dataclass(frozen=True)
class SectionBlock:
    title: str


@dataclass(frozen=True)
class QualificationsBlock:
    education_training: str
    certification: str
    new_privilege: str
    renewal_of_privilege: str


@dataclass(frozen=True)
class PrivilegeLine:
    text: str
    indent: bool = False


@dataclass(frozen=True)
class SubgroupLine:
    text: str


DocBlock = (
    SpecialtyBlock
    | VersionBlock
    | LogoBlock
    | SectionBlock
    | QualificationsBlock
    | SubgroupLine
    | PrivilegeLine
)


def _safe_field_name(prefix: str, idx: int) -> str:
    return f"{prefix}_{idx}"


def _strip_comment(line: str) -> str:
    if "#" in line:
        return line.split("#", 1)[0].rstrip()
    return line.rstrip()


def _unescape(s: str) -> str:
    r"""Convert literal \n sequences typed in the text file into real newlines."""
    # Support both "\n" and "\\n" user input variants.
    return s.replace("\\\\n", "\n").replace("\\n", "\n")


_CONNECTOR_RE = re.compile(r"^(OR|AND|AND/OR)(?:\s|$)")


def _is_additional_requirements(stripped: str) -> bool:
    return stripped.lower().startswith("additional requirements:")


def _starts_with_connector(stripped: str) -> bool:
    return bool(_CONNECTOR_RE.match(stripped))


class _PrivilegeContinuation:
    """Attach Additional Requirements / OR / AND / AND/OR lines to the prior privilege."""

    def __init__(self) -> None:
        self.active = False
        self.pending_blank = False
        self.waiting_body = False

    def reset(self) -> None:
        self.active = False
        self.pending_blank = False
        self.waiting_body = False

    def note_blank(self) -> None:
        if self.active:
            self.pending_blank = True

    def try_append(self, blocks: list[DocBlock], stripped: str) -> bool:
        if not blocks or not isinstance(blocks[-1], PrivilegeLine):
            self.reset()
            return False
        last = blocks[-1]
        if _is_additional_requirements(stripped):
            value = stripped.split(":", 1)[1].strip() if ":" in stripped else ""
            text = last.text + ("\n\n" if last.text else "") + _unescape(stripped)
            blocks[-1] = PrivilegeLine(text, last.indent)
            self.active = True
            self.waiting_body = not value
            self.pending_blank = False
            return True
        if self.active and (self.waiting_body or _starts_with_connector(stripped)):
            sep = "\n\n" if self.pending_blank else "\n"
            blocks[-1] = PrivilegeLine(last.text + sep + _unescape(stripped), last.indent)
            self.waiting_body = False
            self.pending_blank = False
            return True
        self.reset()
        return False


def parse_document(text: str) -> list[DocBlock]:
    # User-authored blank-line token: "<Blank>" (case-insensitive).
    # - If used on its own line, it becomes exactly one blank line.
    # - If used inline, it inserts a line break at that point.
    text = re.sub(r"(?im)^[ \t]*<blank>[ \t]*$", "", text)
    text = re.sub(r"(?i)<blank>", "\n", text)
    # Convert literal "\n" sequences the user may have typed in the source
    # into real newlines BEFORE we split into lines. This way a line that was
    # just "\n" becomes an empty line (treated as a paragraph break) instead
    # of leaking through as extra content.
    # Support both "\n" and "\\n" user input variants.
    text = text.replace("\\\\n", "\n").replace("\\n", "\n")
    raw_lines = text.splitlines()
    lines = [_strip_comment(l) for l in raw_lines]

    has_section = any(
        s.strip().upper() in ("SECTION", "[SECTION]") or s.strip().upper().startswith("SECTION:")
        for s in lines
        if s.strip()
    )
    has_qual = any(
        s.strip().upper() in ("QUALIFICATIONS", "[QUALIFICATIONS]")
        or s.strip().upper().startswith("QUALIFICATIONS:")
        for s in lines
        if s.strip()
    )

    if not has_section and not has_qual:
        out: list[DocBlock] = []
        subgroup_active = False
        cont = _PrivilegeContinuation()
        for s in lines:
            t = s.strip()
            if not t:
                cont.note_blank()
                continue
            up_t = t.upper()
            if up_t.startswith("SUBGROUP:"):
                cont.reset()
                subgroup_title = _unescape(t.split(":", 1)[1].strip())
                if subgroup_title:
                    out.append(SubgroupLine(subgroup_title))
                    subgroup_active = True
                continue
            if cont.try_append(out, t):
                continue
            out.append(PrivilegeLine(t, indent=subgroup_active))
        return out

    blocks: list[DocBlock] = []
    i = 0
    n = len(lines)
    subgroup_active = False
    cont = _PrivilegeContinuation()

    def parse_qualifications(start: int) -> tuple[QualificationsBlock, int]:
        fields: dict[str, str] = {"e": "", "c": "", "n": "", "r": ""}
        current: str | None = None
        pending_blank = False
        j = start
        while j < n and not lines[j].strip():
            j += 1
        while j < n:
            raw = lines[j]
            stripped = raw.strip()
            if not stripped:
                # A blank line (including one created from "\n") starts a
                # paragraph break before the next continuation line.
                if current and fields[current]:
                    pending_blank = True
                j += 1
                continue
            low = stripped.lower()
            if stripped.upper() in ("SECTION", "[SECTION]") or stripped.upper().startswith("SECTION:"):
                break
            if stripped.upper() in ("PRIVILEGES", "PRIVILEGES:", "[PRIVILEGES]"):
                break
            if stripped.upper() in ("QUALIFICATIONS", "[QUALIFICATIONS]") or stripped.upper().startswith(
                "QUALIFICATIONS:"
            ):
                break
            key: str | None = None
            if low.startswith("education and training:") or low.startswith("education & training:"):
                key = "e"
            elif low.startswith("certification:"):
                key = "c"
            elif low.startswith("new privilege:"):
                key = "n"
            elif low.startswith("fppe plan:") or low.startswith("ffpe plan:"):
                # FPPE is intentionally omitted from output rows.
                current = None
                pending_blank = False
                j += 1
                continue
            elif (
                low.startswith("renewal of privilege:")
                or low.startswith("renewal of privileges:")
                or low.startswith("renewal privilege:")
                or low.startswith("renewal of provlidge:")
                or low.startswith("renewal of provlidges:")
            ):
                key = "r"
            if key is not None:
                current = key
                fields[current] = stripped.split(":", 1)[1].strip()
                pending_blank = False
                j += 1
                continue
            # Any line that is not a known key or structural keyword continues
            # the current field.
            if current:
                if not fields[current]:
                    fields[current] = stripped
                else:
                    sep = "\n\n" if pending_blank else "\n"
                    fields[current] = fields[current] + sep + stripped
                pending_blank = False
                j += 1
                continue
            # No active field yet — skip unrecognised lines
            j += 1
        return (
            QualificationsBlock(
                education_training=fields["e"],
                certification=fields["c"],
                new_privilege=fields["n"],
                renewal_of_privilege=fields["r"],
            ),
            j,
        )

    while i < n:
        line = lines[i]
        stripped = line.strip()
        if not stripped:
            cont.note_blank()
            i += 1
            continue

        up = stripped.upper()
        if up.startswith("SPECIALTY:"):
            cont.reset()
            blocks.append(SpecialtyBlock(_unescape(stripped.split(":", 1)[1].strip())))
            i += 1
            continue
        if up.startswith("VERSION:"):
            cont.reset()
            blocks.append(VersionBlock(stripped.split(":", 1)[1].strip()))
            i += 1
            continue
        if up.startswith("LOGO:"):
            cont.reset()
            blocks.append(LogoBlock(stripped.split(":", 1)[1].strip()))
            i += 1
            continue
        if up.startswith("SECTION:"):
            cont.reset()
            blocks.append(SectionBlock(_unescape(stripped.split(":", 1)[1].strip())))
            subgroup_active = False
            i += 1
            continue
        if up in ("SECTION", "[SECTION]"):
            cont.reset()
            subgroup_active = False
            i += 1
            while i < n and not lines[i].strip():
                i += 1
            parts: list[str] = []
            while i < n and lines[i].strip():
                nxt = lines[i].strip().upper()
                if nxt in ("QUALIFICATIONS", "[QUALIFICATIONS]") or nxt.startswith("QUALIFICATIONS:"):
                    break
                if nxt in ("SECTION", "[SECTION]") or lines[i].strip().upper().startswith("SECTION:"):
                    break
                parts.append(lines[i].strip())
                i += 1
            if parts:
                blocks.append(SectionBlock(_unescape(" ".join(parts))))
            continue
        if up.startswith("QUALIFICATIONS:"):
            cont.reset()
            subgroup_active = False
            i += 1
            qb, i = parse_qualifications(i)
            blocks.append(qb)
            continue
        if up in ("QUALIFICATIONS", "[QUALIFICATIONS]"):
            cont.reset()
            subgroup_active = False
            i += 1
            qb, i = parse_qualifications(i)
            blocks.append(qb)
            continue
        if up in ("PRIVILEGES:", "PRIVILEGES", "[PRIVILEGES]"):
            cont.reset()
            subgroup_active = False
            i += 1   # visual marker only — no block created, just skip
            continue
        if up.startswith("SUBGROUP:"):
            cont.reset()
            subgroup_title = _unescape(stripped.split(":", 1)[1].strip())
            if subgroup_title:
                blocks.append(SubgroupLine(subgroup_title))
                subgroup_active = True
            i += 1
            continue

        if cont.try_append(blocks, stripped):
            i += 1
            continue

        blocks.append(PrivilegeLine(_unescape(stripped), indent=subgroup_active))
        i += 1

    return blocks


def load_document(path: Path | None) -> list[DocBlock]:
    if path is None:
        return []
    text = path.read_text(encoding="utf-8-sig")
    return parse_document(text)


EMPHASIS_WORDS = {"OR", "AND", "AND/OR"}
EMPHASIS_FONT = "hebo"


def _segment_font(token: str, default_font: str) -> str:
    if token.strip() in EMPHASIS_WORDS:
        return EMPHASIS_FONT
    return default_font


def _text_width_with_emphasis(text: str, fontsize: float, default_font: str) -> float:
    width = 0.0
    for token in re.findall(r"\S+|\s+", text):
        width += fitz.get_text_length(token, fontsize=fontsize, fontname=_segment_font(token, default_font))
    return width


def _draw_text_with_emphasis(
    page: fitz.Page,
    x: float,
    baseline: float,
    text: str,
    *,
    fontsize: float,
    default_font: str,
    color: tuple,
) -> None:
    cursor = x
    for token in re.findall(r"\S+|\s+", text):
        font = _segment_font(token, default_font)
        token_w = fitz.get_text_length(token, fontsize=fontsize, fontname=font)
        if token.strip():
            page.insert_text(
                fitz.Point(cursor, baseline),
                token,
                fontsize=fontsize,
                fontname=font,
                color=color,
            )
        cursor += token_w


def _vcenter_insert(
    page: fitz.Page,
    cell: fitz.Rect,
    text: str,
    fontsize: float,
    fontname: str,
    color: tuple,
    align: int = 0,
    h_pad: float = 6,
) -> None:
    """Insert text vertically centered with balanced top/bottom padding."""
    if not text:
        return
    inner_x0 = cell.x0 + h_pad
    inner_x1 = cell.x1 - h_pad
    inner_w = max(inner_x1 - inner_x0, 10)
    lines = wrap_lines(text, inner_w, fontsize)
    n = max(1, len(lines))
    leading = fontsize * LINE_H_FACTOR
    text_h = n * leading
    top = cell.y0 + max(0.0, (cell.height - text_h) / 2)
    baseline = top + fontsize

    for line in lines:
        draw = line if line else " "
        w = _text_width_with_emphasis(draw, fontsize, fontname)
        if align == 1:
            x = inner_x0 + max(0.0, (inner_w - w) / 2)
        elif align == 2:
            x = max(inner_x0, inner_x1 - w)
        else:
            x = inner_x0
        _draw_text_with_emphasis(
            page,
            x,
            baseline,
           draw,
            fontsize=fontsize,
            default_font=fontname,
            color=color,
        )
        baseline += leading


def wrap_lines(text: str, max_w: float, fontsize: float) -> list[str]:
    """Word-wrap text to fit max_w. Hard \\n in the string forces a line break."""
    result: list[str] = []
    for segment in text.split("\n"):
        words = segment.split()
        if not words:
            result.append("")
            continue
        cur: list[str] = []
        for w in words:
            trial = " ".join(cur + [w])
            if _text_width_with_emphasis(trial, fontsize, "helv") <= max_w:
                cur.append(w)
            else:
                if cur:
                    result.append(" ".join(cur))
                cur = [w]
        if cur:
            result.append(" ".join(cur))
    return result if result else [""]


def draw_wrapped_text(
    page: fitz.Page,
    rect: fitz.Rect,
    text: str,
    *,
    fontsize: float,
    fontname: str,
    color: tuple,
    leading: float,
    align: int = 0,
) -> None:
    """Render wrapped text line-by-line to avoid insert_textbox clipping quirks."""
    lines = wrap_lines(text, max(rect.width, 10), fontsize)
    baseline = rect.y0 + fontsize
    for line in lines:
        if baseline > rect.y1:
            break
        draw = line if line else " "
        w = _text_width_with_emphasis(draw, fontsize, fontname)
        if align == 1:
            x = rect.x0 + max(0.0, (rect.width - w) / 2)
        elif align == 2:
            x = max(rect.x0, rect.x1 - w)
        else:
            x = rect.x0
        _draw_text_with_emphasis(
            page,
            x,
            baseline,
            draw,
            fontsize=fontsize,
            default_font=fontname,
            color=color,
        )
        baseline += leading


def table_usable_width() -> float:
    return PAGE_W - LEFT_M - RIGHT_M


def column_x_edges() -> tuple[float, float, float, float, float]:
    """Privilege table: 70% privilege text | three 10% checkbox columns."""
    x0 = LEFT_M
    uw = table_usable_width()
    w_txt = PRIV_TEXT_FRAC * uw
    w_cb = PRIV_CB_FRAC * uw
    x1 = x0 + w_txt
    x2 = x1 + w_cb
    x3 = x2 + w_cb
    x4 = x3 + w_cb
    return x0, x1, x2, x3, x4


def qual_label_value_split_x(x0: float, x4: float) -> tuple[float, float]:
    """25% label column ends at xs; value runs xs..x4."""
    uw = x4 - x0
    xs = x0 + QUAL_LABEL_FRAC * uw
    return xs, uw


def draw_title_block(
    page: fitz.Page,
    y: float,
    title: str,
    organization: str | None,
    subtitle: str | None,
) -> float:
    """Title block on section pages — title text suppressed per design; only
    organization / subtitle meta line is rendered if present."""
    x0, _, _, _, x4 = column_x_edges()
    meta: list[str] = []
    if organization:
        meta.append(organization)
    if subtitle:
        meta.append(subtitle)
    if meta:
        r2 = fitz.Rect(x0, y, x4, y + 28)
        page.insert_textbox(r2, " — ".join(meta), fontsize=10, fontname="helv", color=(0.2, 0.2, 0.2))
        y += 20
    return y


CB_HDR_FONT = QUAL_FONT - 2   # checkbox column headers are 2pt smaller than privilege text
CB_HDR_V_PAD = QUAL_ROW_PAD

def _priv_header_height() -> float:
    """Dynamic height for privilege header row — fits wrapping checkbox column labels."""
    _, x1, x2 = column_x_edges()[:3]
    cb_inner = max(x2 - x1 - 4, 10)  # h_pad=2 each side
    labels = ("Newly Requested", "Currently\nHeld", "Granted / Renewed")
    max_lines = max(len(wrap_lines(lab, cb_inner, CB_HDR_FONT)) for lab in labels)
    return max_lines * CB_HDR_FONT * LINE_H_FACTOR + 2 * CB_HDR_V_PAD


def draw_privilege_header_row(page: fitz.Page, y: float) -> float:
    """Row 6 style: light gray, black, vertically centered, 70/10/10/10 columns."""
    x0, x1, x2, x3, x4 = column_x_edges()
    h = _priv_header_height()
    row = fitz.Rect(x0, y, x4, y + h)
    page.draw_rect(row, color=STROKE, fill=HEADER_FILL, width=0.5)
    page.draw_line(fitz.Point(x1, y), fitz.Point(x1, y + h), color=STROKE, width=0.5)
    page.draw_line(fitz.Point(x2, y), fitz.Point(x2, y + h), color=STROKE, width=0.5)
    # Thicker divider before Granted / Renewed marks reviewer-side input.
    page.draw_line(
        fitz.Point(x3, y),
        fitz.Point(x3, y + h),
        color=GRANTED_DIVIDER_COLOR,
        width=GRANTED_DIVIDER_W,
    )
    _vcenter_insert(page, fitz.Rect(x0, y, x1, y + h), "Privilege",         QUAL_FONT,   FONT_REG, (0, 0, 0), align=0)
    _vcenter_insert(page, fitz.Rect(x1, y, x2, y + h), "Newly Requested",   CB_HDR_FONT, FONT_REG, (0, 0, 0), align=1, h_pad=2)
    _vcenter_insert(page, fitz.Rect(x2, y, x3, y + h), "Currently\nHeld",    CB_HDR_FONT, FONT_REG, (0, 0, 0), align=1, h_pad=2)
    _vcenter_insert(page, fitz.Rect(x3, y, x4, y + h), "Granted / Renewed", CB_HDR_FONT, FONT_REG, (0, 0, 0), align=1, h_pad=2)
    return y + h


def _two_col_qual_row_height(label: str, value: str, label_col_w: float, value_col_w: float) -> float:
    # Keep width math identical to _vcenter_insert(..., h_pad=QUAL_CELL_H_PAD)
    inner_pad_total = 2 * QUAL_CELL_H_PAD
    lab_lines = wrap_lines(label, max(label_col_w - inner_pad_total, 20), QUAL_FONT)
    val_lines = wrap_lines(value, max(value_col_w - inner_pad_total, 20), QUAL_FONT)
    lines = max(len(lab_lines), len(val_lines), 1)
    return lines * QUAL_LEADING + 2 * QUAL_ROW_PAD


def _section_title_bar_height(section_title: str) -> float:
    """Height of the blue section title bar (row 1)."""
    x0, _, _, _, x4 = column_x_edges()
    _, uw = qual_label_value_split_x(x0, x4)
    title_lines = wrap_lines(section_title.strip(), uw - 16, SECTION_TITLE_FONT)
    return max(QUAL_BAR_H, max(1, len(title_lines)) * SECTION_LEADING + 2 * SECTION_PAD)


def draw_section_title_bar(page: fitz.Page, y: float, section_title: str) -> float:
    """Draw row 1: blue section title bar."""
    x0, _, _, _, x4 = column_x_edges()
    _, uw = qual_label_value_split_x(x0, x4)
    title_lines = wrap_lines(section_title.strip(), uw - 16, SECTION_TITLE_FONT)
    h1 = max(QUAL_BAR_H, max(1, len(title_lines)) * SECTION_LEADING + 2 * SECTION_PAD)
    page.draw_rect(fitz.Rect(x0, y, x4, y + h1), fill=SECTION_BLUE, color=SECTION_BLUE, width=0.5)
    title_txt = "\n".join(title_lines) if title_lines else " "
    _vcenter_insert(page, fitz.Rect(x0, y, x4, y + h1), title_txt,
                    SECTION_TITLE_FONT, FONT_REG, (1, 1, 1), align=0, h_pad=8)
    return y + h1


def draw_qualifications_bar(page: fitz.Page, y: float) -> float:
    """Draw row 2: grey Qualifications bar."""
    x0, _, _, _, x4 = column_x_edges()
    page.draw_rect(fitz.Rect(x0, y, x4, y + QUAL_BAR_H),
                   fill=QUAL_BAR_GRAY, color=QUAL_BAR_GRAY, width=0.5)
    _vcenter_insert(page, fitz.Rect(x0, y, x4, y + QUAL_BAR_H),
                    "Qualifications", 11, FONT_REG, (1, 1, 1), align=0, h_pad=8)
    return y + QUAL_BAR_H


def draw_qual_detail_row(page: fitz.Page, y: float, label: str, value: str) -> float:
    """Draw one 25/75 qualification detail row (rows 3-5)."""
    x0, _, _, _, x4 = column_x_edges()
    xs, _ = qual_label_value_split_x(x0, x4)
    label_col_w = xs - x0
    value_col_w = x4 - xs
    rh = _two_col_qual_row_height(label, value, label_col_w, value_col_w)
    page.draw_rect(fitz.Rect(x0, y, x4, y + rh), color=STROKE, fill=(1, 1, 1), width=0.5)
    page.draw_line(fitz.Point(xs, y), fitz.Point(xs, y + rh), color=STROKE, width=0.5)
    _vcenter_insert(
        page, fitz.Rect(x0, y, xs, y + rh),
        label, QUAL_FONT, FONT_REG, (0, 0, 0), align=0, h_pad=QUAL_CELL_H_PAD
    )
    _vcenter_insert(
        page, fitz.Rect(xs, y, x4, y + rh),
        value, QUAL_FONT, FONT_REG, (0, 0, 0), align=0, h_pad=QUAL_CELL_H_PAD
    )
    return y + rh


def qual_detail_rows(q: QualificationsBlock | None) -> list[tuple[str, str]]:
    """Return all qualification (label, value) pairs for a QualificationsBlock."""
    edu = q.education_training if q else ""
    cert = q.certification if q else ""
    np  = q.new_privilege       if q else ""
    ren = q.renewal_of_privilege if q else ""
    rows = [
        ("Education & Training:", edu),
        ("New Privilege:",       np),
        ("Renewal of Privilege:", ren),
    ]
    # Certification row is optional per privilege section.
    if cert.strip():
        rows.insert(1, ("Certification:", cert))
    return rows


def add_checkbox(page: fitz.Page, cx: float, cy: float, name: str) -> None:
    half = CB_SIZE / 2
    w = fitz.Widget()
    w.field_type = fitz.PDF_WIDGET_TYPE_CHECKBOX
    w.field_name = name
    w.field_value = False
    w.rect = fitz.Rect(cx - half, cy - half, cx + half, cy + half)
    page.add_widget(w)


COVER_INSTRUCTIONS_BODY = (
    "Please check the box beside each clinical privilege being "
    "requested. Applicants are required to produce information deemed necessary by the "
    "center in order to properly evaluate current competence, current clinical activity, "
    "and other privileging requirements."
)


def _text_field(page: fitz.Page, name: str, rect: fitz.Rect) -> None:
    """Add a single-line fillable text widget."""
    w = fitz.Widget()
    w.field_type = fitz.PDF_WIDGET_TYPE_TEXT
    w.field_name = name
    w.field_value = ""
    w.rect = rect
    page.add_widget(w)


def draw_cover_page(doc: fitz.Document, specialty: str, *, logo_path: str | None = None) -> None:
    """Draw the cover / applicant-information page."""
    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    x0 = LEFT_M
    x1 = PAGE_W - RIGHT_M
    uw = x1 - x0
    y = TOP_M

    # ── Logo (optional) ───────────────────────────────────────────────────────
    if logo_path:
        logo_file = Path(logo_path)
        if not logo_file.is_absolute():
            cwd_candidate = Path.cwd() / logo_file
            script_candidate = Path(__file__).resolve().parent / logo_file
            logo_file = cwd_candidate if cwd_candidate.is_file() else script_candidate
        if logo_file.is_file():
            max_logo_w = uw * 0.50   # max 50 % of page width
            max_logo_h = 72.0        # max 1 inch tall
            # Read natural pixel size to compute aspect ratio
            import struct, zlib
            try:
                _tmp = fitz.open(str(logo_file))
                _pg  = _tmp[0]
                _pix = _pg.get_pixmap()
                nat_w, nat_h = _pix.width, _pix.height
                _tmp.close()
            except Exception:
                nat_w, nat_h = 300, 100   # fallback aspect ratio
            aspect = nat_w / nat_h if nat_h else 3
            logo_h = min(max_logo_h, max_logo_w / aspect)
            logo_w = logo_h * aspect
            logo_x0 = x0 + (uw - logo_w) / 2 + LOGO_X_NUDGE
            page.insert_image(
                fitz.Rect(logo_x0, y, logo_x0 + logo_w, y + logo_h),
                filename=str(logo_file),
            )
            y += logo_h + 24   # extra gap between logo and specialty name

    # ── Specialty name — use insert_text for exact placement ─────────────────
    spec_font = 18
    spec_txt_w = fitz.get_text_length(specialty, fontsize=spec_font, fontname=FONT_REG)
    spec_cx = x0 + (uw - spec_txt_w) / 2
    page.insert_text(fitz.Point(spec_cx, y + spec_font), specialty,
                     fontsize=spec_font, fontname=FONT_REG, color=BRAND_GREEN)
    y += spec_font * LINE_H_FACTOR

    # ── "Delineation of Privileges" ───────────────────────────────────────────
    dop_font = 12
    dop_txt_w = fitz.get_text_length("Delineation of Privileges", fontsize=dop_font, fontname=FONT_REG)
    dop_cx = x0 + (uw - dop_txt_w) / 2
    page.insert_text(fitz.Point(dop_cx, y + dop_font), "Delineation of Privileges",
                     fontsize=dop_font, fontname=FONT_REG, color=(0, 0, 0))
    y += dop_font * LINE_H_FACTOR + 20
    # ── Applicant Information — all fields boxed together ─────────────────────
    field_font = 10
    field_h = 18
    inner_pad = 8
    row_inner_gap = 4          # tighter gap between rows
    fields = [
        ("Full Name:",              "FullName"),
        ("Date of Birth:",          "DateOfBirth"),
        ("Home Address:",           "HomeAddress"),
        ("Life Number (if available):", "LifeNumber"),
    ]
    lbl_widths = [
        fitz.get_text_length(lbl, fontsize=field_font, fontname=FONT_REG) + 6
        for lbl, _ in fields
    ]
    max_lbl_w = max(lbl_widths)

    # Header label height — bold "Applicant Information"
    hdr_label_h = 11 * LINE_H_FACTOR + 2
    hdr_to_fields_gap = 4     # small gap between header and first field
    rows_h = len(fields) * (field_h + row_inner_gap) - row_inner_gap
    box_h = inner_pad + hdr_label_h + hdr_to_fields_gap + rows_h + inner_pad
    box_rect = fitz.Rect(x0, y, x1, y + box_h)

    # Black outlined box (matching section table style)
    page.draw_rect(box_rect, color=(0, 0, 0), fill=(1, 1, 1), width=OUTER_BORDER_W)

    # "Applicant Information" — bold, top of box
    _vcenter_insert(page, fitz.Rect(x0 + inner_pad, y, x1, y + hdr_label_h + inner_pad),
                    "Applicant Information", 11, "hebo", (0, 0, 0), align=0)
    y += inner_pad + hdr_label_h + hdr_to_fields_gap

    # Fields — indented inside the box
    indent = inner_pad * 2
    for (label, fname), lbl_w in zip(fields, lbl_widths):
        field_x0 = x0 + indent
        page.insert_textbox(fitz.Rect(field_x0, y, field_x0 + max_lbl_w, y + field_h),
                            label, fontsize=field_font, fontname=FONT_REG, color=(0, 0, 0))
        _text_field(page, fname,
                    fitz.Rect(field_x0 + max_lbl_w + 4, y, x1 - inner_pad, y + field_h))
        y += field_h + row_inner_gap

    y += inner_pad + 16

    # ── Instructions ──────────────────────────────────────────────────────────
    # "Instructions:" bold on its own line, body text below at x0 (no indent)
    lh10 = 10 * LINE_H_FACTOR + 2
    page.insert_text(
        fitz.Point(x0, y + 10),
        "Instructions:",
        fontsize=10,
        fontname="hebo",
        color=(0, 0, 0),
    )
    y += lh10
    body_lines = wrap_lines(COVER_INSTRUCTIONS_BODY, uw, 10)
    body_h = len(body_lines) * 10 * LINE_H_FACTOR + 4
    page.insert_textbox(fitz.Rect(x0, y, x1, y + body_h),
                        COVER_INSTRUCTIONS_BODY, fontsize=10, fontname=FONT_REG,
                        color=(0, 0, 0), align=3, lineheight=LINE_H_FACTOR)


ACK_BODY = (
    "I have requested only those privileges which by education, training, current "
    "experience, and demonstrated performance I am qualified to perform, and for which "
    "I wish to exercise at this center. I further understand that:"
)
MED_DIR_DECLARATION_BODY = (
    "The practitioner's request for new, modified, or renewed clinical privileges has "
    "been reviewed by the Center's Medical Director or an appropriate member of the "
    "Medical Executive Committee and presented to the Governing Board for approval. "
    "Privileges that have received a checkmark in the designated column have been "
    "granted. Any privileges that were requested but not granted are listed below, "
    "along with an explanation for each determination."
)
MED_DIR_NAME = "Medical Director: Michael A. Gorin, M.D."
DENIED_PRIVS_TITLE = "Privileges Not Granted / Renewed:"
MED_DIR_BLANK_LINES_BETWEEN = 2
MED_DIR_DATE_TO_DENIED_BLANK_LINES = 2
MED_DIR_POST_DENIED_HALF_LINE_FACTOR = 0.5
ACK_ITEMS = [
    "A.\tPrivileges requested may differ from those granted and approved;",
    "B.\tCompletion of this form, at the present time, does not preclude me from "
    "requesting additional privileges in the future;",
    "C.\tThe granting of clinical privileges will be made in conformance with the "
    "applicable Medical Staff Bylaws and Policies and Procedures;",
    "D.\tFailure to obtain and maintain all threshold criteria set forth above, or "
    "non-compliance with the applicable Medical Staff Bylaws or Policies or Procedures, "
    "may constitute grounds for non-renewal or restriction/limitation of clinical privileges.",
]
ACK_FONT = 9
# Keep acknowledgment/signature block compact so all legal text remains visible.
ACK_LINE_FACTOR = 1.0
ACK_LEADING = ACK_FONT * ACK_LINE_FACTOR


def _ack_height(uw: float) -> float:
    """Estimate total height of the acknowledgment box."""
    pad = 8
    hdr_h = QUAL_BAR_H
    body_h = len(wrap_lines(ACK_BODY, uw - 2 * pad, ACK_FONT)) * ACK_LEADING
    items_h = sum(
        len(wrap_lines(item.replace("\t", "    "), uw - 2 * pad - 16, ACK_FONT)) * ACK_LEADING
        for item in ACK_ITEMS
    )
    sig_h = 40  # signature area
    return hdr_h + pad + body_h + 4 + items_h + pad + sig_h + pad


def draw_acknowledgment(page: fitz.Page, y: float) -> float:
    """Draw the Acknowledgment of Practitioner box."""
    x0, _, _, _, x4 = column_x_edges()
    uw = x4 - x0
    pad = 8

    total_h = _ack_height(uw)
    box = fitz.Rect(x0, y, x4, y + total_h)

    # Outer box with same border weight as the credentialing checklist.
    page.draw_rect(box, color=(0, 0, 0), fill=(1, 1, 1), width=OUTER_BORDER_W)

    # Header bar (brand grey), inset so the black border remains visible.
    border_w = OUTER_BORDER_W
    inset = border_w / 2
    hdr = fitz.Rect(x0 + inset, y + inset, x4 - inset, y + QUAL_BAR_H)
    page.draw_rect(hdr, fill=QUAL_BAR_GRAY, color=QUAL_BAR_GRAY, width=0)
    _vcenter_insert(page, hdr, "Acknowledgment of Practitioner",
                    11, FONT_REG, (1, 1, 1), align=0, h_pad=8)
    y += QUAL_BAR_H + pad

    # Body paragraph
    body_lines = wrap_lines(ACK_BODY, uw - 2 * pad, ACK_FONT)
    body_h = len(body_lines) * ACK_LEADING + 4
    draw_wrapped_text(
        page,
        fitz.Rect(x0 + pad, y, x4 - pad, y + body_h),
        ACK_BODY,
        fontsize=ACK_FONT,
        fontname=FONT_REG,
        color=(0, 0, 0),
        leading=ACK_LEADING,
    )
    y += body_h

    # Lettered items A–D (tab stop simulation: indent after the letter)
    letter_w = fitz.get_text_length("A.    ", fontsize=ACK_FONT, fontname=FONT_REG)
    for item in ACK_ITEMS:
        letter, _, rest = item.partition("\t")
        letter_label = letter  # items already include the period e.g. "A."
        item_lines = wrap_lines(rest, uw - 2 * pad - letter_w, ACK_FONT)
        item_h = len(item_lines) * ACK_LEADING + 2
        # Letter label + item text
        draw_wrapped_text(
            page,
            fitz.Rect(x0 + pad, y, x0 + pad + letter_w, y + item_h),
            letter_label,
            fontsize=ACK_FONT,
            fontname=FONT_REG,
            color=(0, 0, 0),
            leading=ACK_LEADING,
        )
        draw_wrapped_text(
            page,
            fitz.Rect(x0 + pad + letter_w, y, x4 - pad, y + item_h),
            rest,
            fontsize=ACK_FONT,
            fontname=FONT_REG,
            color=(0, 0, 0),
            leading=ACK_LEADING,
        )
        y += item_h

    y += pad

    # Signature lines — equal width (80 % of max), centred in each half
    sig_line_y = y + 24
    line_gap = 24
    max_line_w = (uw - 2 * pad - line_gap) / 2
    line_w = max_line_w * 0.80       # 20 % shorter than the available half
    col_w  = max_line_w              # half-column width
    # Centre each line inside its column
    sig_start  = x0 + pad + (col_w - line_w) / 2
    sig_end    = sig_start + line_w
    date_start = x0 + pad + col_w + line_gap + (col_w - line_w) / 2
    date_end   = date_start + line_w

    page.draw_line(fitz.Point(sig_start, sig_line_y),
                   fitz.Point(sig_end,   sig_line_y), color=(0, 0, 0), width=0.5)
    page.draw_line(fitz.Point(date_start, sig_line_y),
                   fitz.Point(date_end,   sig_line_y), color=(0, 0, 0), width=0.5)

    sig_label_y = sig_line_y + 4
    lbl_h = ACK_FONT * ACK_LINE_FACTOR + 2
    sig_label = "Practitioner's Signature"
    sig_label_w = fitz.get_text_length(sig_label, fontsize=ACK_FONT, fontname=FONT_REG)
    sig_label_x = sig_start + max(0.0, (line_w - sig_label_w) / 2)
    page.insert_text(
        fitz.Point(sig_label_x, sig_label_y + ACK_FONT),
        sig_label,
        fontsize=ACK_FONT,
        fontname=FONT_REG,
        color=(0, 0, 0),
    )

    date_label = "Date"
    date_label_w = fitz.get_text_length(date_label, fontsize=ACK_FONT, fontname=FONT_REG)
    date_label_x = date_start + max(0.0, (line_w - date_label_w) / 2)
    page.insert_text(
        fitz.Point(date_label_x, sig_label_y + ACK_FONT),
        date_label,
        fontsize=ACK_FONT,
        fontname=FONT_REG,
        color=(0, 0, 0),
    )

    return sig_label_y + lbl_h + pad


def _med_dir_declaration_height(uw: float) -> float:
    """Estimate total height of the Medical Director declaration box."""
    pad = 8
    body_h = len(wrap_lines(MED_DIR_DECLARATION_BODY, uw - 2 * pad, ACK_FONT)) * ACK_LEADING + 4
    info_line_h = ACK_LEADING + 4
    info_gap_h = MED_DIR_BLANK_LINES_BETWEEN * info_line_h
    sig_label_h = ACK_FONT * ACK_LINE_FACTOR + 2
    sig_block_h = 24 + 4 + sig_label_h  # signature/date lines with labels below
    info_h = info_line_h + info_gap_h + sig_block_h
    denied_h = ACK_LEADING + 4
    denied_row_h = ACK_LEADING + 8
    denied_rows_h = 10 * denied_row_h
    post_denied_gap_h = denied_row_h * MED_DIR_POST_DENIED_HALF_LINE_FACTOR
    date_to_denied_gap_h = MED_DIR_DATE_TO_DENIED_BLANK_LINES * info_line_h
    return (
        QUAL_BAR_H + pad + body_h + 8 + info_h + date_to_denied_gap_h +
        denied_h + denied_rows_h + post_denied_gap_h + pad
    )


def draw_med_dir_declaration(page: fitz.Page, y: float) -> float:
    """Draw the Medical Director declaration box."""
    x0, _, _, _, x4 = column_x_edges()
    uw = x4 - x0
    pad = 8

    total_h = _med_dir_declaration_height(uw)
    box = fitz.Rect(x0, y, x4, y + total_h)
    page.draw_rect(box, color=(0, 0, 0), fill=(1, 1, 1), width=OUTER_BORDER_W)

    border_w = OUTER_BORDER_W
    inset = border_w / 2
    hdr = fitz.Rect(x0 + inset, y + inset, x4 - inset, y + QUAL_BAR_H)
    page.draw_rect(hdr, fill=QUAL_BAR_GRAY, color=QUAL_BAR_GRAY, width=0)
    _vcenter_insert(page, hdr, "Medical Director Declaration",
                    11, FONT_REG, (1, 1, 1), align=0, h_pad=8)
    y += QUAL_BAR_H + pad

    body_h = len(wrap_lines(MED_DIR_DECLARATION_BODY, uw - 2 * pad, ACK_FONT)) * ACK_LEADING + 4
    draw_wrapped_text(
        page,
        fitz.Rect(x0 + pad, y, x4 - pad, y + body_h),
        MED_DIR_DECLARATION_BODY,
        fontsize=ACK_FONT,
        fontname=FONT_REG,
        color=(0, 0, 0),
        leading=ACK_LEADING,
    )
    y += body_h + 8

    info_line_h = ACK_LEADING + 4
    info_gap_h = MED_DIR_BLANK_LINES_BETWEEN * info_line_h
    page.insert_textbox(
        fitz.Rect(x0 + pad, y, x4 - pad, y + info_line_h),
        MED_DIR_NAME,
        fontsize=ACK_FONT,
        fontname=FONT_REG,
        color=(0, 0, 0),
        align=0,
        lineheight=ACK_LINE_FACTOR,
    )
    y += info_line_h + info_gap_h

    # Signature/date lines on one row with labels under each, matching practitioner style.
    sig_line_y = y + 24
    line_gap = 24
    max_line_w = (uw - 2 * pad - line_gap) / 2
    line_w = max_line_w * 0.80
    col_w = max_line_w
    sig_start = x0 + pad + (col_w - line_w) / 2
    sig_end = sig_start + line_w
    date_start = x0 + pad + col_w + line_gap + (col_w - line_w) / 2
    date_end = date_start + line_w
    page.draw_line(fitz.Point(sig_start, sig_line_y),
                   fitz.Point(sig_end, sig_line_y), color=(0, 0, 0), width=0.5)
    page.draw_line(fitz.Point(date_start, sig_line_y),
                   fitz.Point(date_end, sig_line_y), color=(0, 0, 0), width=0.5)

    sig_label_y = sig_line_y + 4
    lbl_h = ACK_FONT * ACK_LINE_FACTOR + 2
    sig_label = "Signature"
    page.insert_textbox(
        fitz.Rect(sig_start, sig_label_y, sig_end, sig_label_y + lbl_h + 2),
        sig_label,
        fontsize=ACK_FONT,
        fontname=FONT_REG,
        color=(0, 0, 0),
        align=1,
        lineheight=ACK_LINE_FACTOR,
    )
    date_label = "Date"
    page.insert_textbox(
        fitz.Rect(date_start, sig_label_y, date_end, sig_label_y + lbl_h + 2),
        date_label,
        fontsize=ACK_FONT,
        fontname=FONT_REG,
        color=(0, 0, 0),
        align=1,
        lineheight=ACK_LINE_FACTOR,
    )
    y = sig_label_y + lbl_h

    y += MED_DIR_DATE_TO_DENIED_BLANK_LINES * info_line_h
    label_h = ACK_LEADING + 4
    page.insert_textbox(
        fitz.Rect(x0 + pad, y, x4 - pad, y + label_h),
        DENIED_PRIVS_TITLE,
        fontsize=ACK_FONT,
        fontname=FONT_REG,
        color=(0, 0, 0),
        align=0,
        lineheight=ACK_LINE_FACTOR,
    )
    y += label_h

    denied_row_h = ACK_LEADING + 8
    num_col_w = fitz.get_text_length("10.", fontsize=ACK_FONT, fontname=FONT_REG) + 6
    line_x0 = x0 + pad + num_col_w + 6  # extra half-space after number label
    line_x1 = x4 - pad
    for i in range(1, 11):
        line_y = y + denied_row_h - 2
        page.insert_text(
            fitz.Point(x0 + pad, line_y),
            f"{i}.",
            fontsize=ACK_FONT,
            fontname=FONT_REG,
            color=(0, 0, 0),
        )
        page.draw_line(
            fitz.Point(line_x0, line_y),
            fitz.Point(line_x1, line_y),
            color=(0, 0, 0),
            width=0.5,
        )
        y += denied_row_h

    y += denied_row_h * MED_DIR_POST_DENIED_HALF_LINE_FACTOR
    return y + pad


FOOTER_FONT = 8
FOOTER_H = 14
ACK_GAP_LINES = 2


def draw_footers(doc: fitz.Document, version_date: str) -> None:
    """Stamp 'Page N of T' (right) and version date (left) on every page."""
    total = doc.page_count
    x0 = LEFT_M
    x1 = PAGE_W - RIGHT_M
    y0 = PAGE_H - BOTTOM_M + 6
    y1 = y0 + FOOTER_H
    for n, page in enumerate(doc, start=1):
        page.insert_textbox(
            fitz.Rect(x0, y0, x1, y1),
            version_date,
            fontsize=FOOTER_FONT, fontname=FONT_REG,
            color=(0.4, 0.4, 0.4), align=0,
        )
        page.insert_textbox(
            fitz.Rect(x0, y0, x1, y1),
            f"Page {n} of {total}",
            fontsize=FOOTER_FONT, fontname=FONT_REG,
            color=(0.4, 0.4, 0.4), align=2,
        )


def build_pdf(
    blocks: list[DocBlock],
    out_path: Path,
    *,
    title: str,
    subtitle: str | None,
    organization: str | None,
) -> None:
    doc = fitz.open()

    # Pull metadata blocks before the main loop.
    specialty_name = next((b.name for b in blocks if isinstance(b, SpecialtyBlock)), None)
    logo_path = next((b.path for b in blocks if isinstance(b, LogoBlock)), None)
    if logo_path is None:
        script_dir = Path(__file__).resolve().parent
        for candidate in (
            Path.cwd() / "Logo.jpg",
            script_dir / "Logo.jpg",
            Path.cwd() / "logo.jpg",
            script_dir / "logo.jpg",
            Path.cwd() / "Logo.png",
            script_dir / "Logo.png",
            Path.cwd() / "logo.png",
            script_dir / "logo.png",
        ):
            if candidate.is_file():
                logo_path = str(candidate)
                break
    _raw_version = next(
        (b.date for b in blocks if isinstance(b, VersionBlock)),
        __import__("datetime").date.today().strftime("%B %Y"),
    )
    version_date = f"Version: {_raw_version}"
    blocks = [b for b in blocks if not isinstance(b, (SpecialtyBlock, VersionBlock, LogoBlock))]

    if specialty_name:
        draw_cover_page(doc, specialty_name, logo_path=logo_path)

    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    x0, x1, x2, x3, x4 = column_x_edges()
    text_w = x1 - x0 - 12
    y = TOP_M
    y = draw_title_block(page, y, title, organization, subtitle)
    title_bottom = y  # y after title block — used to detect "first section on first page"

    def new_page() -> None:
        nonlocal page, y
        page = doc.new_page(width=PAGE_W, height=PAGE_H)
        y = TOP_M

    need_priv_header = True
    priv_idx = 0
    pending_section: str | None = None

    # ── Section border tracking ───────────────────────────────────────────────
    # A section may span multiple pages. We record each page segment as
    # (page_idx, top_y, bottom_y). The very first top line and very last bottom
    # line are drawn in black; every internal page-break line is grey (like an
    # inner row divider) so the table looks continuous across pages.
    _sec: dict = {"segs": [], "pg": None, "ty": None}

    def _open_seg() -> None:
        _sec["pg"] = doc.page_count - 1
        _sec["ty"] = y

    def _close_seg() -> None:
        if _sec["pg"] is not None:
            _sec["segs"].append((_sec["pg"], _sec["ty"], y))
            _sec["pg"] = None
            _sec["ty"] = None

    def _page_break_in_section() -> None:
        """Call instead of new_page() when a page break happens inside a section."""
        _close_seg()
        new_page()
        _open_seg()

    def _ensure_row_fits(row_h: float) -> None:
        """If row_h won't fit on the current page, break the section to a new page."""
        if y + row_h > PAGE_H - BOTTOM_M:
            _page_break_in_section()

    def _render_section_header(title: str, q: QualificationsBlock | None) -> None:
        """Draw rows 1-6 for a section, each with its own page-overflow check."""
        nonlocal y, page
        # Row 1 — blue section title bar
        h1 = _section_title_bar_height(title)
        _ensure_row_fits(h1)
        if _sec["pg"] is None:
            _open_seg()
        y = draw_section_title_bar(page, y, title)
        # Row 2 — grey Qualifications bar
        _ensure_row_fits(QUAL_BAR_H)
        y = draw_qualifications_bar(page, y)
        # Rows 3-5 — detail rows (New Privilege, Renewal, FPPE Plan)
        for lab, val in qual_detail_rows(q):
            x0_, _, _, _, x4_ = column_x_edges()
            xs_, _ = qual_label_value_split_x(x0_, x4_)
            rh = _two_col_qual_row_height(lab, val, xs_ - x0_, x4_ - xs_)
            _ensure_row_fits(rh)
            y = draw_qual_detail_row(page, y, lab, val)
        # Row 6 — privilege column header
        _ensure_row_fits(_priv_header_height())
        y = draw_privilege_header_row(page, y)

    def close_section_border() -> None:
        """Finalise the current section: close open segment, then draw all borders."""
        _close_seg()
        segs = _sec["segs"]
        if not segs:
            _sec["segs"].clear()
            return
        n_segs = len(segs)
        for i, (pg, ty, by) in enumerate(segs):
            p = doc[pg]
            is_first = i == 0
            is_last  = i == n_segs - 1
            blk = (0, 0, 0)
            # Left and right — always solid black
            p.draw_line(fitz.Point(x0, ty), fitz.Point(x0, by), color=blk, width=OUTER_BORDER_W)
            p.draw_line(fitz.Point(x4, ty), fitz.Point(x4, by), color=blk, width=OUTER_BORDER_W)
            # Top — black on first page, grey (continuation) on subsequent pages
            p.draw_line(fitz.Point(x0, ty), fitz.Point(x4, ty),
                        color=blk if is_first else STROKE,
                        width=OUTER_BORDER_W if is_first else 0.5)
            # Bottom — black on last page, grey (continues overleaf) otherwise
            p.draw_line(fitz.Point(x0, by), fitz.Point(x4, by),
                        color=blk if is_last else STROKE,
                        width=OUTER_BORDER_W if is_last else 0.5)
        _sec["segs"].clear()

    for b in blocks:
        if isinstance(b, SectionBlock):
            if not b.title.strip():
                continue
            # Close the previous section's outer border before moving to a new page.
            close_section_border()
            # Always start a new page for each section, unless we are still on
            # the first page and nothing else has been drawn yet.
            if y > title_bottom:
                new_page()
            pending_section = b.title.strip()
            continue

        if isinstance(b, QualificationsBlock):
            title = pending_section if pending_section is not None else ""
            _render_section_header(title, b)
            pending_section = None
            need_priv_header = False
            continue

        if isinstance(b, SubgroupLine):
            if pending_section is not None:
                _render_section_header(pending_section, None)
                pending_section = None
                need_priv_header = False

            if need_priv_header:
                if y + HEADER_H + 40 > PAGE_H - BOTTOM_M:
                    _page_break_in_section()
                if _sec["pg"] is None:
                    _open_seg()
                y = draw_privilege_header_row(page, y)
                need_priv_header = False

            lines = wrap_lines(b.text, text_w, QUAL_FONT)
            row_h = max(HEADER_H, len(lines) * QUAL_LEADING + 2 * QUAL_ROW_PAD)

            if y + row_h > PAGE_H - BOTTOM_M:
                _page_break_in_section()
                y = draw_privilege_header_row(page, y)

            row_top = y
            row_rect = fitz.Rect(x0, row_top, x4, row_top + row_h)
            page.draw_rect(row_rect, color=STROKE, fill=(1, 1, 1), width=0.5)
            page.draw_line(fitz.Point(x1, row_top), fitz.Point(x1, row_top + row_h), color=STROKE, width=0.5)
            page.draw_line(fitz.Point(x2, row_top), fitz.Point(x2, row_top + row_h), color=STROKE, width=0.5)
            page.draw_line(
                fitz.Point(x3, row_top),
                fitz.Point(x3, row_top + row_h),
                color=GRANTED_DIVIDER_COLOR,
                width=GRANTED_DIVIDER_W,
            )
            _vcenter_insert(
                page,
                fitz.Rect(x0, row_top, x1, row_top + row_h),
                b.text,
                QUAL_FONT,
                EMPHASIS_FONT,
                (0, 0, 0),
                align=0,
            )
            y = row_top + row_h
            continue

        if isinstance(b, PrivilegeLine):
            if pending_section is not None:
                _render_section_header(pending_section, None)
                pending_section = None
                need_priv_header = False

            if need_priv_header:
                if y + HEADER_H + 40 > PAGE_H - BOTTOM_M:
                    _page_break_in_section()
                if _sec["pg"] is None:
                    _open_seg()
                y = draw_privilege_header_row(page, y)
                need_priv_header = False

            priv_idx += 1
            indent_offset = 16 if b.indent else 0
            row_text_w = max(20, text_w - indent_offset)
            lines = wrap_lines(b.text, row_text_w, QUAL_FONT)
            row_h = max(HEADER_H, len(lines) * QUAL_LEADING + 2 * QUAL_ROW_PAD)

            if y + row_h > PAGE_H - BOTTOM_M:
                _page_break_in_section()
                y = draw_privilege_header_row(page, y)

            row_top = y
            row_rect = fitz.Rect(x0, row_top, x4, row_top + row_h)
            page.draw_rect(row_rect, color=STROKE, fill=(1, 1, 1), width=0.5)
            page.draw_line(fitz.Point(x1, row_top), fitz.Point(x1, row_top + row_h), color=STROKE, width=0.5)
            page.draw_line(fitz.Point(x2, row_top), fitz.Point(x2, row_top + row_h), color=STROKE, width=0.5)
            page.draw_line(
                fitz.Point(x3, row_top),
                fitz.Point(x3, row_top + row_h),
                color=GRANTED_DIVIDER_COLOR,
                width=GRANTED_DIVIDER_W,
            )

            _vcenter_insert(
                page,
                fitz.Rect(x0 + indent_offset, row_top, x1, row_top + row_h),
                b.text,
                QUAL_FONT,
                FONT_REG,
                (0, 0, 0),
                align=0,
            )

            cy = row_top + row_h / 2
            cx_a = (x1 + x2) / 2
            cx_b = (x2 + x3) / 2
            cx_c = (x3 + x4) / 2
            add_checkbox(page, cx_a, cy, _safe_field_name("NewlyRequested", priv_idx))
            add_checkbox(page, cx_b, cy, _safe_field_name("CurrentlyHeld", priv_idx))
            add_checkbox(page, cx_c, cy, _safe_field_name("GrantedRenewed", priv_idx))

            y = row_top + row_h

    if pending_section is not None:
        _render_section_header(pending_section, None)

    close_section_border()

    # Keep acknowledgment on the last privileges page when it fully fits.
    # Move to a new page only if placing it here would split across pages.
    ack_gap = ACK_GAP_LINES * QUAL_LEADING
    ack_h = _ack_height(x4 - x0)
    if y + ack_gap + ack_h > PAGE_H - BOTTOM_M:
        new_page()
    else:
        y += ack_gap
    y = draw_acknowledgment(page, y)

    # Always place the Medical Director declaration on its own page.
    new_page()
    y = TOP_M
    draw_med_dir_declaration(page, y)

    draw_footers(doc, version_date)
    doc.need_appearances(True)
    doc.save(str(out_path), garbage=4, deflate=True)
    doc.close()


def main() -> None:
    p = argparse.ArgumentParser(
        description="Build a credentialing PDF (sections, qualifications, interactive checkboxes)."
    )
    p.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("credentialing_privileges.pdf"),
        help="Output PDF path (default: credentialing_privileges.pdf)",
    )
    p.add_argument(
        "-f",
        "--file",
        type=Path,
        help="Text file: privileges and/or SECTION / QUALIFICATIONS blocks (see format in script docstring)",
    )
    p.add_argument(
        "privileges",
        nargs="*",
        help="Privilege strings (if omitted, use --file or stdin)",
    )
    p.add_argument("--title", default="Clinical Privileges Request", help="Document title")
    p.add_argument("--subtitle", help="Optional second line (e.g. department or date)")
    p.add_argument("--organization", help="Optional organization or facility name")

    args = p.parse_args()
    blocks: list[DocBlock] = []
    if args.privileges:
        blocks = [PrivilegeLine(x.strip()) for x in args.privileges if x.strip()]
    elif args.file:
        blocks = load_document(args.file)
    else:
        import sys

        if sys.stdin.isatty():
            script_dir = Path(__file__).resolve().parent
            cwd = Path.cwd()
            for candidate in (
                cwd / "privileges.txt",
                cwd / "privileges_example.txt",
                script_dir / "privileges_example.txt",
            ):
                if candidate.is_file():
                    blocks = load_document(candidate)
                    print(f"Using privilege list: {candidate}")
                    break
            if not blocks:
                p.error(
                    "No privilege list found. Create privileges.txt (one line per privilege), "
                    "or run: python credentialing_pdf.py -f privileges_example.txt"
                )
        else:
            raw = sys.stdin.read()
            blocks = parse_document(raw)

    if not blocks:
        p.error("No content to include")

    build_pdf(
        blocks,
        args.output,
        title=args.title,
        subtitle=args.subtitle,
        organization=args.organization,
    )
    print(f"Wrote {args.output.resolve()}")


if __name__ == "__main__":
    main()
