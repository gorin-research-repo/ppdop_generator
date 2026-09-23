# Apply to `ppcn_credentialing`

This Cloud Agent environment can push only to `ppdop_generator`. The privileging website, admin change log, DOP PDFs, and case-log templates live in [`gorin-research-repo/ppcn_credentialing`](https://github.com/gorin-research-repo/ppcn_credentialing).

Copy these files into that repository (branch suggested: `cursor/anesthesia-age-bands-aeac`):

| This folder | Destination in `ppcn_credentialing` |
|-------------|--------------------------------------|
| `index.html` | `index.html` |
| `admin.html` | `admin.html` |
| `dops/Anesthesia_Physician_Sept_23_2026.pdf` | `dops/Anesthesia_Physician_Sept_23_2026.pdf` |
| `case-logs/ANESTHESIA_(PHYSICIAN)_CASE_LOG_TEMPLATE_Sept_23_2026.xlsx` | same path |
| `Anesthesia_MD.txt` | optional source archive (generator uses `privileges_anesthesiology.txt` in `ppdop_generator`) |

Then remove the superseded files:

- `dops/Anesthesia_Physician_May_18_2026_FINAL.pdf`
- `case-logs/ANESTHESIA_(PHYSICIAN)_CASE_LOG_TEMPLATE_July_8_2026.xlsx`

A local commit with these changes already exists at `/tmp/ppcn_credentialing` on branch `cursor/anesthesia-age-bands-aeac` (commit `a211f64`) and can be pushed once write access is available.
