#!/usr/bin/env python3
"""
Builds CampusReserve_Report.docx (editable Word version) from the LaTeX source.

    cd report && python3 build_docx.py

Requires pandoc (>= 2.19) and python-docx. The PDF built with XeLaTeX is the
principal submission document; this DOCX mirrors its content and the faculty
formatting (Times New Roman 12 pt, 1.5 spacing, bold 14 pt headings, 1-inch
margins, page numbers bottom centre, automatic table of contents).
Evidence images found in figures/evidence/ are embedded; missing ones appear as
clearly marked placeholders. After opening in Word: right-click the table of
contents -> Update Field -> Update entire table.
"""
import os
import re
import subprocess
import sys
import tempfile

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(HERE, 'CampusReserve_Report.tex')
OUT = os.path.join(HERE, 'CampusReserve_Report.docx')
FONT = 'Times New Roman'


def macro(src, name):
    m = re.search(r'\\newcommand\{\\' + name + r'\}\{([^}]*)\}', src)
    return m.group(1) if m else ''


def balanced(s, i):
    """Return (content, index_after) for the {...} group starting at s[i] == '{'."""
    depth, j = 0, i
    while j < len(s):
        if s[j] == '{':
            depth += 1
        elif s[j] == '}':
            depth -= 1
            if depth == 0:
                return s[i + 1:j], j + 1
        j += 1
    raise ValueError('unbalanced braces')


def replace_macro(body, name, fn, nargs):
    out, i, key = [], 0, '\\' + name + '{'
    while True:
        k = body.find(key, i)
        if k < 0:
            out.append(body[i:])
            return ''.join(out)
        out.append(body[i:k])
        j, args = k + len(key) - 1, []
        for _ in range(nargs):
            a, j = balanced(body, j)
            args.append(a)
        out.append(fn(*args))
        i = j


def aux_labels():
    labels, cites = {}, {}
    aux = os.path.join(HERE, 'CampusReserve_Report.aux')
    if os.path.exists(aux):
        txt = open(aux, encoding='utf-8', errors='ignore').read()
        for m in re.finditer(r'\\newlabel\{([^}]*)\}\{\{([^}]*)\}', txt):
            labels[m.group(1)] = m.group(2)
        for m in re.finditer(r'\\bibcite\{([^}]*)\}\{([^}]*)\}', txt):
            cites[m.group(1)] = m.group(2)
    return labels, cites


def colspec_to_simple(body):
    def fix(m):
        spec = m.group(2)
        n = len(re.findall(r'p\{[^}]*\}|[lcrX]', re.sub(r'@\{[^}]*\}', '', spec)))
        return m.group(1) + '{' + 'l' * max(n, 1) + '}'
    body = re.sub(r'(\\begin\{tabularx\}\{[^}]*\})\{((?:[^{}]|\{[^}]*\})*)\}',
                  lambda m: fix(m).replace('tabularx}{\\linewidth}', 'tabular}'), body)
    body = body.replace('\\end{tabularx}', '\\end{tabular}')
    body = re.sub(r'(\\begin\{(?:tabular|longtable)\})\{((?:[^{}]|\{[^}]*\})*)\}', fix, body)
    return body


def placeholder_png(tmp, fname, caption):
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new('RGB', (1600, 360), (238, 238, 238))
    d = ImageDraw.Draw(img)
    d.rectangle([4, 4, 1595, 355], outline=(120, 120, 120), width=4)
    try:
        f1 = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 44)
        f2 = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 30)
    except OSError:
        f1 = f2 = ImageFont.load_default()
    for y, text, font in ((90, 'EVIDENCE PLACEHOLDER - NOT YET CAPTURED', f1),
                          (175, 'Replace with a screenshot from your own execution.', f2),
                          (230, 'Save as report/figures/evidence/' + fname + ' and rebuild.', f2)):
        w = d.textlength(text, font=font)
        d.text(((1600 - w) / 2, y), text, fill=(40, 40, 40), font=font)
    out = os.path.join(tmp, 'ph_' + fname)
    img.save(out)
    return out


def preprocess(src, tmp):
    labels, cites = aux_labels()
    body = src.split(r'\begin{document}', 1)[1].split(r'\end{document}', 1)[0]
    body = re.sub(r'\\begin\{titlepage\}.*?\\end\{titlepage\}', '', body, flags=re.S)
    for cmd in (r'\tableofcontents', r'\listoffigures', r'\listoftables', r'\clearpage', r'\appendix'):
        body = body.replace(cmd, '')
    body = re.sub(r'\\pagenumbering\{[^}]*\}|\\setcounter\{[^}]*\}\{[^}]*\}|\\addcontentsline\{[^}]*\}\{[^}]*\}\{[^}]*\}', '', body)
    body = re.sub(r'\\lstset\{[^\n]*\}', '', body)
    body = body.replace(r'\facultyname', macro(src, 'facultyname')).replace(r'\submissiondate', macro(src, 'submissiondate'))

    def inline_listing(m):
        path = os.path.normpath(os.path.join(HERE, m.group(2)))
        with open(path, encoding='utf-8') as f:
            return '\\begin{verbatim}\n' + f.read() + '\n\\end{verbatim}'
    body = re.sub(r'\\lstinputlisting(\[[^\]]*\])?\{([^}]*)\}', inline_listing, body)
    body = re.sub(r'\\begin\{lstlisting\}(\[[^\]]*\])?', r'\\begin{verbatim}', body)
    body = body.replace(r'\end{lstlisting}', r'\end{verbatim}')

    def evidence(fname, caption):
        caption = re.sub(r'\\label\{[^}]*\}', '', caption)
        path = os.path.join(HERE, 'figures', 'evidence', fname)
        if not os.path.exists(path):
            path = placeholder_png(tmp, fname, caption)
        return ('\\begin{figure}\\centering\\includegraphics[width=0.9\\linewidth]{' + path +
                '}\\caption{' + caption + '}\\end{figure}')
    body = replace_macro(body, 'evidence', evidence, 2)
    body = replace_macro(body, 'pending', lambda x: '\\textit{Pending' + (': ' + x if x else '') + '}', 1)
    # pandoc does not know these layout-only commands
    body = re.sub(r'\\vspace\*?\{[^}]*\}|\\noindent|\\hfill|\\rule\{[^}]*\}\{[^}]*\}', '', body)
    body = body.replace(r'\begin{small}', '').replace(r'\end{small}', '')
    body = re.sub(r'\\setlength\{[^}]*\}\{[^}]*\}', '', body)
    body = re.sub(r'\\begin\{figure\}\[H\]', r'\\begin{figure}', body)
    body = re.sub(r'\\ref\{([^}]*)\}', lambda m: labels.get(m.group(1), '?'), body)
    body = re.sub(r'\\cite\{([^}]*)\}', lambda m: '[' + ', '.join(cites.get(k.strip(), '?') for k in m.group(1).split(',')) + ']', body)
    body = re.sub(r'~(?=\[)', ' ', body)
    for a, b in ((r'$\rightarrow$', '→'), (r'$\Leftrightarrow$', '⇔'), (r'$\ge 0$', '≥ 0'), (r'$\ge$', '≥'),
                 (r'$\to$', '→'), (r'$[s,e)$', '[s, e)'), (r'$[s_1,e_1)$', '[s1, e1)'), (r'$[s_2,e_2)$', '[s2, e2)'),
                 (r'$s_1 < e_2 \wedge s_2 < e_1$', 's1 < e2 AND s2 < e1'), (r'$n$', 'n')):
        body = body.replace(a, b)
    body = colspec_to_simple(body)
    body = re.sub(r'\\begin\{table\}\[H\]', r'\\begin{table}', body)
    pre = ('\\documentclass{report}\n\\usepackage{graphicx}\n\\usepackage{hyperref}\n'
           '\\newcommand{\\XeLaTeX}{XeLaTeX}\n\\begin{document}\n')
    return pre + body + '\n\\end{document}\n'


def set_cell_font(run, size=12, bold=None, italic=None):
    run.font.name = FONT
    run._element.rPr.rFonts.set(qn('w:eastAsia'), FONT)
    run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic


def build_reference(path):
    ref = subprocess.run(['pandoc', '-o', path, '--print-default-data-file', 'reference.docx'],
                         capture_output=True)
    if ref.returncode != 0:
        sys.exit(ref.stderr.decode())
    doc = Document(path)
    by_name = {st.name: st for st in doc.styles}
    for st in doc.styles:
        try:
            if st.font is not None:
                st.font.name = FONT
                rpr = st.element.get_or_add_rPr()
                rfonts = rpr.find(qn('w:rFonts'))
                if rfonts is None:
                    rfonts = OxmlElement('w:rFonts')
                    rpr.append(rfonts)
                for a in ('w:ascii', 'w:hAnsi', 'w:eastAsia', 'w:cs'):
                    rfonts.set(qn(a), FONT)
                for a in ('w:asciiTheme', 'w:hAnsiTheme', 'w:eastAsiaTheme', 'w:cstheme'):
                    if rfonts.get(qn(a)) is not None:
                        del rfonts.attrib[qn(a)]
        except (AttributeError, ValueError):
            pass
    for name in ('Normal', 'Body Text', 'First Paragraph', 'Compact'):
        if name in by_name:
            s = by_name[name]
            s.font.size = Pt(12)
            s.paragraph_format.line_spacing = 1.5
            s.paragraph_format.space_after = Pt(6)
    for name in ('Heading 1', 'Heading 2', 'Heading 3', 'Title'):
        s = by_name[name]
        s.font.size = Pt(14) if name != 'Heading 3' else Pt(12)
        s.font.bold = True
        s.font.italic = False
        s.font.color.rgb = RGBColor(0, 0, 0)
        s.paragraph_format.space_before = Pt(12)
        s.paragraph_format.space_after = Pt(6)
    for name in ('Source Code', 'Verbatim Char'):
        if name in by_name:
            s = by_name[name]
            s.font.name = 'Consolas'
            s.font.size = Pt(8.5)
            if name == 'Source Code':
                s.paragraph_format.line_spacing = 1.0
    for name in ('Image Caption', 'Table Caption', 'Caption'):
        if name in by_name:
            s = by_name[name]
            s.font.size = Pt(10.5)
            s.font.italic = False
            s.font.bold = False
    doc.save(path)


def add_field(paragraph, instr):
    run = paragraph.add_run()
    for tag, text in (('begin', None), (None, instr), ('separate', None), ('end', None)):
        if tag:
            el = OxmlElement('w:fldChar')
            el.set(qn('w:fldCharType'), tag)
            run._r.append(el)
        else:
            it = OxmlElement('w:instrText')
            it.set(qn('xml:space'), 'preserve')
            it.text = text
            run._r.append(it)


def postprocess(path, src):
    doc = Document(path)
    for sec in doc.sections:
        sec.top_margin = sec.bottom_margin = sec.left_margin = sec.right_margin = Inches(1)
        footer = sec.footer.paragraphs[0] if sec.footer.paragraphs else sec.footer.add_paragraph()
        footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
        add_field(footer, 'PAGE')

    body = doc.element.body
    paras = doc.paragraphs

    # Number figure and table captions per chapter, like the PDF.
    chapter, fig, tab, appendix = 0, 0, 0, False
    for p in paras:
        sname = p.style.name
        text = p.text.strip()
        if sname == 'Heading 1':
            if text in ('Declaration of Originality', 'Abstract', 'References'):
                continue
            if text == 'Installation and Execution':
                appendix, chapter = True, 0
            chapter += 1
            fig = tab = 0
            label = chr(64 + chapter) if appendix else str(chapter)
            p.runs[0].text = (('Appendix ' + label + '. ') if appendix else (label + '. ')) + p.runs[0].text
        elif sname == 'Heading 2' and chapter and text not in ('Contents',):
            sec_no = getattr(postprocess, '_sec', {})
            key = (appendix, chapter)
            sec_no[key] = sec_no.get(key, 0) + 1
            postprocess._sec = sec_no
            label = (chr(64 + chapter) if appendix else str(chapter)) + '.' + str(sec_no[key])
            p.runs[0].text = label + ' ' + p.runs[0].text
        elif sname == 'Image Caption':
            fig += 1
            label = (chr(64 + chapter) if appendix else str(chapter)) + '.' + str(fig)
            p.runs[0].text = 'Figure ' + label + ': ' + p.runs[0].text
        elif sname == 'Table Caption':
            tab += 1
            label = (chr(64 + chapter) if appendix else str(chapter)) + '.' + str(tab)
            p.runs[0].text = 'Table ' + label + ': ' + p.runs[0].text

    # Cover page + table of contents at the very beginning.
    first = paras[0]
    def before(text='', size=12, bold=False, italic=False, space=6):
        np_ = first.insert_paragraph_before()
        np_.alignment = WD_ALIGN_PARAGRAPH.CENTER
        np_.paragraph_format.space_after = Pt(space)
        if text:
            r = np_.add_run(text)
            set_cell_font(r, size, bold, italic)
        return np_
    fac, date = macro(src, 'facultyname'), macro(src, 'submissiondate')
    before(space=24)
    before('CAMPUSRESERVE', 24, True, space=14)
    before('Intelligent Campus Resource Booking, Maintenance & Utilisation Analytics System', 15, True, space=28)
    before('A Mini Project Report', 13, space=12)
    before('Submitted in partial fulfilment of the requirements for', 12)
    before('BCSE302P — DATABASE SYSTEMS LAB', 13, True, space=28)
    before('Submitted by:', 12)
    before('DURLAV DANI', 13, True)
    before('Registration Number: 24BCE2361', 12, space=36)
    before('School of Computer Science and Engineering (SCOPE)', 12)
    before('Vellore Institute of Technology, Vellore', 12, space=24)
    before('Faculty: ' + fac, 12)
    before('Academic Year: 2026–2027', 12)
    before('Fall Semester 2026–27', 12)
    before('Date of Submission: ' + date, 12, space=20)
    pb = before('Individual Mini Project', 11, italic=True)
    pb.add_run().add_break(WD_BREAK.PAGE)

    # TOC after the abstract (before the first numbered chapter).
    target = next(p for p in doc.paragraphs if p.style.name == 'Heading 1' and p.text.startswith('1. '))
    h = target.insert_paragraph_before('Contents')
    h.style = target.style
    toc = target.insert_paragraph_before()
    add_field(toc, 'TOC \\o "1-2" \\h \\z \\u')
    note = target.insert_paragraph_before('(Right-click here → Update Field → Update entire table to refresh the contents.)')
    note.runs[0].italic = True
    note.add_run().add_break(WD_BREAK.PAGE)

    # Start every numbered chapter on a new page.
    for p in doc.paragraphs:
        if p.style.name == 'Heading 1' and p.text not in ('Contents',):
            p.paragraph_format.page_break_before = True

    # Ask Word to refresh fields (TOC) when the file is opened.
    settings = doc.settings.element
    upd = OxmlElement('w:updateFields')
    upd.set(qn('w:val'), 'true')
    settings.append(upd)
    doc.save(path)


def main():
    with open(TEX, encoding='utf-8') as f:
        src = f.read()
    with tempfile.TemporaryDirectory() as tmp:
        tex = os.path.join(tmp, 'report.tex')
        with open(tex, 'w', encoding='utf-8') as f:
            f.write(preprocess(src, tmp))
        ref = os.path.join(tmp, 'reference.docx')
        build_reference(ref)
        res = subprocess.run(['pandoc', tex, '-f', 'latex', '-t', 'docx', '--reference-doc', ref,
                              '--resource-path', HERE + os.pathsep + os.path.join(HERE, 'figures'),
                              '-o', OUT], capture_output=True, text=True, cwd=HERE)
        if res.returncode != 0:
            sys.exit(res.stderr)
        if res.stderr.strip():
            print(res.stderr.strip())
    postprocess(OUT, src)
    print('Wrote', OUT)


if __name__ == '__main__':
    main()
