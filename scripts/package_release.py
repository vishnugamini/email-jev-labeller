"""Build clean source and load-unpacked extension archives from the Git index."""
import hashlib
import json
from pathlib import Path
import subprocess
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'release'
FORBIDDEN = {'.git', '.local', '.cache', '.venv', 'node_modules', '__pycache__', 'release'}


def safe(path):
    return not any(part in FORBIDDEN for part in path.parts) and not (
        path.name.startswith('.env') and path.name != '.env.example'
    ) and not any(path.name.endswith(suffix) for suffix in ('.sqlite3', '.pyc', '.log'))


def main():
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
    files = [Path(name) for name in tracked if name]
    if not files or any(not safe(path) for path in files):
        raise SystemExit('Stage the clean project sources first; tracked private/generated files are not allowed.')
    dist = ROOT / 'extension' / 'dist'
    manifest = dist / 'manifest.json'
    if not manifest.is_file():
        raise SystemExit('Run npm run build before packaging.')
    version = json.loads(manifest.read_text())['version']
    OUT.mkdir(exist_ok=True)
    source = OUT / f'email-jev-labeller-{version}-source.zip'
    extension = OUT / f'email-jev-labeller-{version}-extension.zip'
    with ZipFile(source, 'w', ZIP_DEFLATED) as archive:
        for path in sorted(files):
            archive.write(ROOT / path, Path(f'email-jev-labeller-{version}') / path)
    with ZipFile(extension, 'w', ZIP_DEFLATED) as archive:
        for path in sorted(dist.rglob('*')):
            if path.is_file():
                relative = path.relative_to(dist)
                if not safe(relative):
                    raise SystemExit('Unexpected private/generated extension file.')
                archive.write(path, relative)
    checksums = []
    for path in (source, extension):
        with ZipFile(path) as archive:
            if archive.testzip() is not None:
                raise SystemExit(f'Archive validation failed: {path.name}')
        checksums.append(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}')
    (OUT / 'SHA256SUMS').write_text('\n'.join(checksums) + '\n')
    print('\n'.join(str(path.relative_to(ROOT)) for path in (source, extension, OUT / 'SHA256SUMS')))


if __name__ == '__main__':
    main()
