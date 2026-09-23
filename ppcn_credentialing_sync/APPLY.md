# Apply to `ppcn_credentialing` (required)

These files must land in **https://github.com/gorin-research-repo/ppcn_credentialing** — that is where `dops/` and `case-logs/` live. The Cloud Agent on `ppdop_generator` cannot push there (403).

## File changes

| Action | Path |
|--------|------|
| **Delete** | `dops/Anesthesia_Physician_September_21_2026.pdf` |
| **Add** | `dops/Anesthesia_Physician_Sept_23_2026.pdf` |
| **Delete** | `case-logs/ANESTHESIA_(PHYSICIAN)_CASE_LOG_TEMPLATE_July_8_2026.xlsx` |
| **Add** | `case-logs/ANESTHESIA_(PHYSICIAN)_CASE_LOG_TEMPLATE_Sept_23_2026.xlsx` |
| **Replace** | `index.html` (three age-band blocks + new filenames) |
| **Replace** | `admin.html` (catalog + document change log) |

## Fast path

```bash
cd /path/to/ppcn_credentialing
git checkout -b cursor/anesthesia-sept23-docs-aeac
git apply /path/to/ppdop_generator/ppcn_credentialing_sync/ppcn_credentialing.patch
git add -A && git commit -m "Replace Anesthesia Physician DOP and case log with Sept 23, 2026"
git push -u origin HEAD
gh pr create --base main --title "Replace Anesthesia Physician DOP and case log (Sept 23, 2026)" --body "Deletes Sept 21 DOP and July 8 physician case log; adds Sept 23 files; updates guide age bands and admin log."
```
