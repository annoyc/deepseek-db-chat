"""Convert pdftotext output of Chinese regulation PDFs into structured Markdown.

Usage (see knowledge/README.md for the metadata of each corpus file):
    pdftotext rules.pdf rules.txt
    python3 scripts/kb_pdf_to_markdown.py rules.txt knowledge/corpus/<id>.md '{"id": "...", "title": "...", ...}'

The converter rejoins hard-wrapped lines, drops page numbers, title pages and tables of
contents, and emits chapters/sections as Markdown headings while every article (第X条),
list item and glossary entry starts its own paragraph. The chunker relies on that layout.
"""
import re, sys, json

CN = '一二三四五六七八九十百零〇'
RE_CHAPTER = re.compile(rf'^第[{CN}]+章(\s*)(.*)$')
RE_SECTION = re.compile(rf'^第[{CN}]+节(\s*)(.*)$')
RE_ARTICLE = re.compile(rf'^第[{CN}]+条(\s+|$)')
RE_ITEM = re.compile(rf'^(（[{CN}]+）|\d+[．.、](?!\d)|（\d+）)')
RE_PAGE = re.compile(r'^\s*([—–-]\s*)?\d+(\s*[—–-])?\s*$')
RE_FORMULA = re.compile(r'^[^，。；：]{1,40}[＝=]')
CJK = r'[　-〿一-鿿＀-￯“”‘’]'

def normalize_spaces(text):
    text = re.sub(rf'(?<={CJK})[ \t]+(?=[A-Za-z0-9%\-])', '', text)
    text = re.sub(rf'(?<=[A-Za-z0-9%\-])[ \t]+(?={CJK})', '', text)
    return text

def join(a, b):
    if a and b and re.match(r'[A-Za-z0-9]', b[0]) and re.match(r'[A-Za-z0-9,)]', a[-1]):
        return a + ' ' + b
    return a + b

def convert(raw, appendix_heading=None):
    lines = [l.strip() for l in raw.replace('\f', '\n').splitlines()]
    lines = [l for l in lines if l and not RE_PAGE.match(l)]
    # Body starts at the first real chapter heading (skips title pages and tables of contents).
    start = next(i for i, l in enumerate(lines) if RE_CHAPTER.match(l) and '…' not in l and '...' not in l)
    lines = lines[start:]
    widths = sorted(len(l) for l in lines)
    full = widths[int(len(widths) * 0.9)]
    blocks = []  # (kind, text)
    pending_heading = None
    prev_short_end = False
    for line in lines:
        m_ch, m_se = RE_CHAPTER.match(line), RE_SECTION.match(line)
        if pending_heading is not None:
            kind, head = pending_heading
            blocks.append((kind, head + ' ' + line)); pending_heading = None; prev_short_end = True; continue
        if m_ch or m_se:
            m = m_ch or m_se
            kind = 'chapter' if m_ch else 'section'
            head = line[:line.index('章' if m_ch else '节') + 1]
            if m.group(2).strip():
                blocks.append((kind, head + ' ' + m.group(2).strip()))
                prev_short_end = True
            else:
                pending_heading = (kind, head)
            continue
        if line in ('附件', '名词解释') or line.startswith('附件 ') or line == '附件：名词解释':
            if appendix_heading and not any(k == 'appendix' for k, _ in blocks):
                blocks.append(('appendix', appendix_heading))
            prev_short_end = True
            continue
        starts_new = bool(RE_ARTICLE.match(line) or RE_ITEM.match(line) or RE_FORMULA.match(line)) or prev_short_end or not blocks or blocks[-1][0] != 'para'
        if starts_new:
            blocks.append(('para', line))
        else:
            blocks[-1] = ('para', join(blocks[-1][1], line))
        prev_short_end = (len(line) < full - 1 and line[-1] in '。；：！？') or (bool(RE_ITEM.match(line)) and len(line) < full * 0.7 and line[-1] not in '，、')
    out = []
    for kind, text in blocks:
        if kind != 'para':
            head, _, rest = text.partition(' ')
            # Headings are typeset with letter spacing ("总 则"); drop spaces between CJK characters.
            rest = re.sub(rf'(?<={CJK})\s+(?={CJK})', '', normalize_spaces(rest))
            text = head + ' ' + rest if rest else normalize_spaces(head)
        else:
            text = normalize_spaces(text)
        if kind == 'chapter': out.append(f'## {text}')
        elif kind == 'section': out.append(f'### {text}')
        elif kind == 'appendix': out.append(f'## {text}')
        else:
            # An article heading split onto its own line ("第九十一条" + text) is rejoined above;
            # make sure exactly one space separates the article number from its text.
            text = re.sub(rf'^(第[{CN}]+条)\s*', r'\1 ', text)
            out.append(text)
    return '\n\n'.join(out) + '\n'

if __name__ == '__main__':
    meta = json.loads(sys.argv[3])
    raw = open(sys.argv[1], encoding='utf-8').read()
    body = convert(raw, meta.pop('appendixHeading', None))
    fm = '---\n' + ''.join(f'{k}: {v}\n' for k, v in meta.items() if v) + '---\n\n'
    open(sys.argv[2], 'w', encoding='utf-8').write(fm + f'# {meta["title"]}\n\n' + body)
