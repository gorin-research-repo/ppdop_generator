# PPDOP Generator

Browser-based **Delineation of Privileges (DOP)** form generator for **Peakpoint Central Nassau Surgery Center**, built for the [AugmentedMD](https://github.com/gorin-research-repo) tool set.

Created by **Michael Gorin, MD**.

## What it does

Paste (or load) the same privilege text format used by `credentialing_pdf.py`, preview the form, then **Download PDF** to get an interactive PeakPoint-branded DOP file with the same layout as the Python generator (cover page, section tables, checkboxes, acknowledgment, medical director declaration, footers).

Everything runs locally in one HTML file—no server, no uploads, no telemetry.

## Use it

1. Open `ppdop-generator.html` in any modern browser  
2. Paste a privilege source (or click **Try an example** / **Load .txt**)  
3. Click **Generate form**  
4. Fill applicant fields and checkboxes in the preview  
5. Click **Download PDF** (same layout as `credentialing_pdf.py`)

## Source format

Same markers as the Python PDF generator:

```text
SPECIALTY: Urology
VERSION: August 2026

SECTION: Core Urology Privileges
QUALIFICATIONS
Education & Training: ...
Certification: ...
New Privilege: ...
Renewal of Privilege: ...
FPPE Plan: ...          # parsed but omitted from printed rows (matches Python)

PRIVILEGES
SUBGROUP: Endoscopy
Cystoscopy
Ureteroscopy
```

See `privileges_example.txt` for a fuller sample.

## Develop

`ppdop-generator.html` is generated—edit sources, then rebuild:

| Path | Role |
|------|------|
| `src/parser.js` | Privilege text parser (port of `parse_document`) |
| `src/render.js` | HTML DOP layout |
| `src/app.js` / `src/ui.css` / `src/template.html` | AugmentedMD UI shell |
| `scripts/build.mjs` | Inlines CSS + JS into `ppdop-generator.html` |
| `src/pdf.js` | Browser PDF builder (pdf-lib port of `build_pdf`) |
| `vendor/pdf-lib.min.js` | Vendored pdf-lib for offline single-file builds |
| `credentialing_pdf.py` | Original PeakPoint PDF generator (PyMuPDF) |

```bash
npm run build   # regenerate ppdop-generator.html
npm test        # build + parser/render tests
npm start       # build and serve on http://localhost:8080
```

## Python PDF generator

The original CLI remains available for production PDF widgets:

```bash
pip install pymupdf
python credentialing_pdf.py -f privileges_example.txt -o out.pdf
```

## Design

- **Editor chrome:** AugmentedMD Mount Sinai–style template (blue brand bar, dotted background, panel layout) matching PHI Scrubber  
- **Printed form:** PeakPoint greens/greys (`#268B6B` / `#495566`) and 70/10/10/10 privilege columns from `credentialing_pdf.py`
