#!/usr/bin/env python3
"""Render `catalog_issues.md` as a self-contained HTML report.

Parsing is delegated to pandoc (the standard markdown converter). This script
only adds a small presentational pass on top: color-coded badges for the CAT5
`Severity` and CAT7 `Side` columns, then embeds `catalog_issues.css` so the
resulting `catalog_issues.html` is a single readable file. Run after
`audit_catalog.py`; the browser copy-paste preserves the tables for email.

Usage: python3 md_to_html.py
"""

import re
import shutil
import subprocess

MD = 'catalog_issues.md'
HTML = 'catalog_issues.html'
CSS = 'catalog_issues.css'
TITLE = 'Hanover Catalog Data Issues'

TABLE_RE = re.compile(r'<table>.*?</table>', re.S)
SEVERITY_RE = re.compile(r'<td>(major|moderate|minor|trivial)</td>')
SIDE_RE = re.compile(r'<td>(search-only|program-only)</td>')


def badge_severity(match):
    value = match.group(1)
    return f'<td class="badge sev-{value}">{value}</td>'


def badge_side(match):
    value = match.group(1)
    return f'<td class="badge side-{value}">{value}</td>'


def decorate(html):
    """Wrap severity/side cells in badge spans, scoped to the right tables."""

    def replace_table(match):
        table = match.group(0)
        if '<th>Severity</th>' in table:
            table = SEVERITY_RE.sub(badge_severity, table)
        if '<th>Side</th>' in table:
            table = SIDE_RE.sub(badge_side, table)
        return table

    return TABLE_RE.sub(replace_table, html)


def main():
    if shutil.which('pandoc') is None:
        raise SystemExit('pandoc not found on PATH; install it (brew install pandoc)')
    result = subprocess.run(
        [
            'pandoc',
            '-f',
            'gfm',
            '--self-contained',
            '-c',
            CSS,
            '--metadata',
            f'pagetitle={TITLE}',
            MD,
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    html = decorate(result.stdout)
    with open(HTML, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'Wrote {HTML}')


if __name__ == '__main__':
    main()
