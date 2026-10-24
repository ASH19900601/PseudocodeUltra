#!/usr/bin/env python3
"""Fetch reference documents to a local cache; never redistribute PDFs in the repository."""
import hashlib,json,pathlib,subprocess,os
root=pathlib.Path(__file__).resolve().parent.parent
cache=pathlib.Path(os.environ.get('PSEUDO_SPEC_CACHE','/workspace/.cache/pseudo-specs'))
cache.mkdir(parents=True,exist_ok=True)
for spec in json.loads((root/'docs/spec-sources.json').read_text())['sources']:
    path=cache/spec['filename']
    if not path.exists():
        part=path.with_suffix('.download')
        subprocess.run(['curl','--fail','--location','--silent','--show-error','--proto','=https','--max-time','60',spec['url'],'-o',str(part)],check=True)
        if hashlib.file_digest(part.open('rb'),'sha256').hexdigest()!=spec['sha256']:
            part.unlink()
            raise SystemExit('Source changed; review version and rules before updating the pinned digest: '+spec['id'])
        part.rename(path)
    assert hashlib.file_digest(path.open('rb'),'sha256').hexdigest()==spec['sha256'],spec['id']+' cache integrity failure'
    print('verified',spec['id'],spec['version'])
