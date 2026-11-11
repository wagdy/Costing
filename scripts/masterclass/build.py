#!/usr/bin/env python3
"""The Arabic masterclass (docs/masterclass): built from its chapters' templates, and checked.

  python3 scripts/masterclass/build.py            build docs/masterclass from scripts/masterclass/chapters
  python3 scripts/masterclass/build.py --check    build into a temporary folder and fail if docs/masterclass
                                                  differs from it (the code changed since the last build)

A chapter template is Markdown with directives, each alone on its line:
  @@file <path>        the file, word for word, in a fenced block, with its path and line count
  @@tree               the repository's tree (its tracked files, without the migrations' designers)
  @@migrations         the migrations, one row each

Every build also verifies, and fails on any of them:
  - coverage: every production source and configuration file is embedded exactly once across the
    chapters (backend/src, frontend, the csproj files, angular.json, Dockerfile, railway.json, ...);
    the migrations, the tests, docs/ and this folder are not required (tests may be embedded);
  - Markdown: every fenced block is closed, no directive is left, every link to a chapter exists;
  - secrets: nothing in the chapters looks like a token, a private key or a real integration key.
"""
import argparse
import filecmp
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
CHAPTERS = os.path.join(HERE, 'chapters')
OUT = os.path.join(REPO, 'docs', 'masterclass')

LANG = {
    '.cs': 'csharp', '.ts': 'ts', '.html': 'html', '.scss': 'scss', '.css': 'css', '.json': 'json', '.csproj': 'xml',
    '.slnx': 'xml', '.yml': 'yaml', '.yaml': 'yaml', '.mjs': 'js', '.js': 'js', '.py': 'python', '': 'text',
}

# What a production file is not: generated, a test, documentation, or this generator.
NOT_REQUIRED = [
    re.compile(r'/Migrations/'),
    re.compile(r'\.spec\.ts$'),
    re.compile(r'^docs/'),
    re.compile(r'^backend/tests/'),
    re.compile(r'^scripts/masterclass/'),
    re.compile(r'^README\.md$'),
    re.compile(r'^frontend/package-lock\.json$'),
    re.compile(r'^frontend/public/'),
]

# What must never be published in a chapter. The test keys the tests use are written to look
# like keys on purpose and are allowed by name below.
SECRETS = [
    (re.compile(r'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}'), 'a JWT'),
    (re.compile(r'-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'), 'a private key'),
    (re.compile(r'AKIA[0-9A-Z]{16}'), 'an AWS access key'),
    (re.compile(r'gh[pousr]_[A-Za-z0-9]{30,}'), 'a GitHub token'),
    (re.compile(r'\b(cpk|chr|hrk)_[A-Za-z0-9_-]{32,}'), 'an integration key'),
]
ALLOWED_SECRETS = re.compile(r'test-key|0123456789abcdef|example')


def lang_of(path):
    name = os.path.basename(path)
    if name == 'Dockerfile':
        return 'dockerfile'
    if name in ('.gitignore', '.dockerignore'):
        return 'gitignore'
    return LANG.get(os.path.splitext(name)[1], 'text')


def tracked():
    # Tracked files, and new ones not yet added (but not ignored): a file written today is covered
    # before it is committed.
    out = subprocess.run(['git', '-C', REPO, 'ls-files', '--cached', '--others', '--exclude-standard'], capture_output=True, text=True, check=True).stdout
    return sorted({t for t in out.split('\n') if t and os.path.isfile(os.path.join(REPO, t))})


def build(out_dir):
    files = tracked()
    required = {f for f in files if not any(p.search(f) for p in NOT_REQUIRED)}
    seen = {}
    problems = []

    def embed(path, chapter):
        full = os.path.join(REPO, path)
        if not os.path.isfile(full):
            problems.append(f'{chapter}: no such file {path}')
            return ''
        text = open(full, encoding='utf-8').read().rstrip('\n')
        lines = text.count('\n') + 1
        run = max((len(m) for m in re.findall(r'`+', text)), default=0)
        fence = '`' * max(3, run + 1)
        seen.setdefault(path, []).append(chapter)
        return f'> 📄 **`{path}`** — {lines} سطر\n\n{fence}{lang_of(path)}\n{text}\n{fence}\n'

    def tree():
        shown, lines = set(), ['```text', 'Costing/']
        for f in sorted(t for t in files if not t.endswith('.Designer.cs') and not t.startswith('docs/masterclass/')):
            parts = f.split('/')
            for i in range(len(parts) - 1):
                d = '/'.join(parts[: i + 1])
                if d not in shown:
                    shown.add(d)
                    lines.append('    ' * (i + 1) + parts[i] + '/')
            lines.append('    ' * len(parts) + parts[-1])
        return '\n'.join(lines + ['```']) + '\n'

    def migrations():
        rows = ['| # | Migration | ما أضافته (من اسمها) |', '| --- | --- | --- |']
        names = sorted(t for t in files if '/Migrations/' in t and t.endswith('.cs') and not t.endswith('.Designer.cs') and 'ModelSnapshot' not in t)
        for i, n in enumerate(names, 1):
            base = os.path.basename(n)[:-3]
            name = base.partition('_')[2]
            rows.append(f'| {i} | `{base}` | {re.sub(r"(?<!^)(?=[A-Z])", " ", name)} |')
        return '\n'.join(rows) + '\n'

    os.makedirs(out_dir, exist_ok=True)
    chapters = sorted(n for n in os.listdir(CHAPTERS) if n.endswith('.md'))
    for name in chapters:
        result = []
        for line in open(os.path.join(CHAPTERS, name), encoding='utf-8').read().split('\n'):
            if line.startswith('@@file '):
                result.append(embed(line[7:].strip(), name))
            elif line.strip() == '@@tree':
                result.append(tree())
            elif line.strip() == '@@migrations':
                result.append(migrations())
            else:
                result.append(line)
        open(os.path.join(out_dir, name), 'w', encoding='utf-8').write('\n'.join(result).rstrip('\n') + '\n')

    # Coverage.
    for path in sorted(required - set(seen)):
        problems.append(f'not embedded: {path}')
    for path, where in sorted(seen.items()):
        if len(where) > 1:
            problems.append(f'embedded {len(where)} times: {path} ({", ".join(where)})')

    # Markdown and secrets.
    for name in chapters:
        text = open(os.path.join(out_dir, name), encoding='utf-8').read()
        fence = None
        for number, line in enumerate(text.split('\n'), 1):
            m = re.match(r'^(`{3,})(\S*)\s*$', line)
            if m:
                if fence is None:
                    fence = m.group(1)
                elif m.group(1) == fence and not m.group(2):
                    fence = None
            if fence is None and line.startswith('@@'):
                problems.append(f'{name}:{number}: directive left: {line}')
        if fence is not None:
            problems.append(f'{name}: a fenced block is never closed')
        for target in re.findall(r'\]\(((?:\d\d-)[^)#]+\.md)(?:#[^)]*)?\)', text):
            if not os.path.isfile(os.path.join(out_dir, target)):
                problems.append(f'{name}: links to a chapter that is not there: {target}')
        for pattern, what in SECRETS:
            for m in pattern.finditer(text):
                if not ALLOWED_SECRETS.search(m.group(0)):
                    problems.append(f'{name}: looks like {what}: {m.group(0)[:12]}…')

    embedded_lines = sum(open(os.path.join(REPO, p), encoding='utf-8').read().count('\n') + 1 for p in seen)
    return problems, len(required), len(seen), embedded_lines, chapters


def main():
    parser = argparse.ArgumentParser(description='Build or check docs/masterclass.')
    parser.add_argument('--check', action='store_true', help='fail if docs/masterclass is not what the chapters and the code build now')
    args = parser.parse_args()

    if args.check:
        with tempfile.TemporaryDirectory() as temp:
            problems, required, embedded, lines, chapters = build(temp)
            stale = [n for n in chapters if not os.path.isfile(os.path.join(OUT, n)) or not filecmp.cmp(os.path.join(temp, n), os.path.join(OUT, n), shallow=False)]
            problems += [f'stale: docs/masterclass/{n} (run scripts/masterclass/build.py)' for n in stale]
    else:
        problems, required, embedded, lines, chapters = build(OUT)

    for p in problems:
        print('FAIL', p)
    print(f'{embedded} files embedded ({required} required), {lines} lines of code, in {len(chapters)} chapters')
    if not args.check:
        for n in chapters:
            print(f'  docs/masterclass/{n}: {os.path.getsize(os.path.join(OUT, n)) // 1024} KB')
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
