# Report

| File | What it is |
|---|---|
| `CampusReserve_Report.pdf` | Principal submission document (built with XeLaTeX) |
| `CampusReserve_Report.docx` | Editable Word version generated from the LaTeX source |
| `CampusReserve_Report.tex` | LaTeX source |
| `build_docx.py` | Regenerates the DOCX (needs pandoc and python-docx) |
| `figures/` | Diagrams (rendered from `documentation/diagrams/*.mmd`) |
| `figures/evidence/` | Put **your own** screenshots here (names in `documentation/EVIDENCE_CAPTURE_GUIDE.md`) |

## Before submitting

1. Edit the two lines at the top of `CampusReserve_Report.tex`:
   `\newcommand{\facultyname}{...}` and `\newcommand{\submissiondate}{...}`.
2. Keep, edit or delete the "Tools disclosure" sentence on the declaration page according to your institution's rules.
3. Copy your screenshots into `figures/evidence/` with the listed names.
4. Replace every `\pending{}` in chapter 6 and section 7.2 with your observed results.
5. Build:
   ```bash
   xelatex CampusReserve_Report.tex && xelatex CampusReserve_Report.tex && xelatex CampusReserve_Report.tex
   python3 build_docx.py      # after the PDF build, so cross-references resolve
   ```
6. Check nothing is left over:
   ```bash
   pdftotext CampusReserve_Report.pdf - | grep -n -i -E "placeholder|pending|INSERT" || echo clean
   ```
7. Rename the final PDF to `BCSE302P_Project_DurlavDani_24BCE2361.pdf` (see `documentation/SUBMISSION_EMAIL.md`).

Font: the source uses Times New Roman when it is installed (Windows/macOS). On Linux without it, XeLaTeX falls back to TeX Gyre Termes, a metric-compatible Times clone, so the layout is identical. If you edit the DOCX in Word, update the table of contents with right-click → Update Field → Update entire table before exporting to PDF.
