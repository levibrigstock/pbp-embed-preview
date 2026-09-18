#!/usr/bin/env python3
"""
Walk the embed's import graph from public/embed.html and prove every module it
reaches is present in this package.

This exists because the package is assembled by copying files out of another
repo (scripts/pack-embed.sh in polebarn-pro). A module that is imported but not
copied produces a 404 at load time on a customer's site, while both repos look
correct to anyone reading them. It has happened twice.

Counting import statements would not catch it. This resolves each specifier
against the file that imports it and stats the result, following transitively.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENTRY = ROOT / 'public' / 'embed.html'

# import ... from '<spec>'  /  import('<spec>')  — the ?v= cache-bust token is
# a query string, not part of the path, so it is stripped before resolving.
SPEC = re.compile(r"""(?:from|import)\s*\(?\s*['"]([^'"]+)['"]""")
# The HTML entry does not "import" anything: it loads one module by src=, and
# declares an importmap. Both have to be read or the walk starts nowhere — a
# first version matched only from/import and reported "0 modules reachable,
# all present", which is a pass that proves nothing.
SCRIPT_SRC = re.compile(r"""<script[^>]*type=['"]module['"][^>]*src=['"]([^'"]+)['"]""", re.I)
IMPORTMAP = re.compile(r"""<script[^>]*type=['"]importmap['"][^>]*>(.*?)</script>""", re.I | re.S)


def load_importmap(text):
    """Bare specifiers ("three") resolve through the map, not the filesystem."""
    m = IMPORTMAP.search(text)
    if not m:
        return {}
    try:
        return (json.loads(m.group(1)) or {}).get('imports', {}) or {}
    except json.JSONDecodeError as exc:
        print(f'  MISSING importmap in the entry point is not valid JSON: {exc}')
        return {}


def apply_map(spec, imports):
    """Exact key, then longest trailing-slash prefix, as the browser does."""
    if spec in imports:
        return imports[spec]
    best = None
    for key, val in imports.items():
        if key.endswith('/') and spec.startswith(key):
            if best is None or len(key) > len(best[0]):
                best = (key, val + spec[len(key):])
    return best[1] if best else None


def specs(text, imports):
    for raw in SPEC.findall(text):
        cleaned = raw.split('?', 1)[0]
        if cleaned.startswith(('./', '../')):
            yield cleaned
        else:
            mapped = apply_map(cleaned, imports)
            if mapped:
                yield mapped.split('?', 1)[0]

def main():
    if not ENTRY.is_file():
        print(f'FAIL entry point missing: {ENTRY.relative_to(ROOT)}')
        return 1

    entry_text = ENTRY.read_text(encoding='utf-8', errors='replace')
    imports = load_importmap(entry_text)

    seen, missing, queue = set(), [], []
    # Seed from the module the HTML actually loads.
    srcs = SCRIPT_SRC.findall(entry_text)
    if not srcs:
        print('FAIL no <script type="module" src=...> in the entry point')
        return 1
    for src in srcs:
        target = (ENTRY.parent / src.split('?', 1)[0]).resolve()
        rel = target.relative_to(ROOT)
        seen.add(rel)
        if not target.is_file():
            missing.append(f'{rel} (the entry script) is NOT in this package')
        else:
            queue.append((target, target.parent))

    while queue:
        path, base = queue.pop()
        try:
            text = path.read_text(encoding='utf-8', errors='replace')
        except OSError as exc:
            missing.append(f'{path.relative_to(ROOT)} unreadable: {exc}')
            continue
        for spec in specs(text, imports):
            target = (base / spec).resolve()
            try:
                rel = target.relative_to(ROOT)
            except ValueError:
                missing.append(f'{spec} (imported by {path.name}) escapes the package')
                continue
            if rel in seen:
                continue
            seen.add(rel)
            if not target.is_file():
                missing.append(f'{rel} (imported by {path.name}) is NOT in this package')
                continue
            queue.append((target, target.parent))

    for m in missing:
        print(f'  MISSING {m}')
    if missing:
        print(f'import graph: {len(missing)} missing of {len(seen)} reachable')
        return 1
    print(f'import graph: OK ({len(seen)} module(s) reachable, all present)')
    return 0

if __name__ == '__main__':
    sys.exit(main())
