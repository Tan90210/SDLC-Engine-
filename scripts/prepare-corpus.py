"""Download official PDFs and extract page-preserving text. No generated summaries.

Usage: python scripts/prepare-corpus.py
Requires pypdf. Node indexing is a separate, repeatable step.
"""
import hashlib
import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from pypdf import PdfReader, __version__ as pypdf_version

ROOT = Path(__file__).resolve().parent.parent
CORPUS = ROOT / 'corpus'
PDFS = CORPUS / 'pdfs'
PDFS.mkdir(parents=True, exist_ok=True)
sources = json.loads((CORPUS / 'sources.json').read_text(encoding='utf-8'))
documents = []
for source in sources:
    path = PDFS / source['file']
    if not path.exists():
        print(f"Downloading {source['title']}...", flush=True)
        request = urllib.request.Request(source['url'], headers={'User-Agent': 'RequirementsEngineResearchPrototype/1.0'})
        with urllib.request.urlopen(request, timeout=90) as response:
            data = response.read(30_000_001)
        if len(data) > 30_000_000 or not data.startswith(b'%PDF-'):
            raise ValueError(f"Not an acceptable PDF: {source['url']}")
        path.write_bytes(data)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    reader = PdfReader(path)
    pages = []
    for number, page in enumerate(reader.pages, start=1):
        content = page.extract_text() or ''
        # Dehyphenate line wraps and normalize whitespace. Page boundaries are preserved.
        content = re.sub(r'(?<=[A-Za-z])-\s*\n\s*(?=[a-z])', '', content)
        content = re.sub(r'\s+', ' ', content).strip()
        pages.append({'page': number, 'text': content})
    if sum(len(p['text']) for p in pages) < 1000:
        raise ValueError(f"Insufficient extracted text in {path.name}; OCR is not implemented.")
    documents.append({**source, 'sha256': digest, 'pageCount': len(pages), 'pages': pages})
    print(f"  {len(pages)} PDF pages extracted, SHA256 {digest[:12]}...", flush=True)

result = {'extractedAt': datetime.now(timezone.utc).isoformat(), 'extractor': f'pypdf {pypdf_version}', 'documents': documents}
temporary = CORPUS / 'pages.json.tmp'
temporary.write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
temporary.replace(CORPUS / 'pages.json')
print('Saved corpus/pages.json. Next: node scripts/index-corpus.js', flush=True)
