import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync} from 'node:fs';
import {mkdir,readFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';

const execute=promisify(execFile);
export function createPdfPreview(dataDir){
  const pending=new Map();
  const bundled=resolve(dirname(process.execPath),'../../native/poppler/Library/bin/pdftoppm.exe');
  const binary=process.env.PDFTOPPM_PATH||(existsSync(bundled)?bundled:'pdftoppm');
  return async(pdfPath,doc,page)=>{
    const cache=resolve(dataDir,'page-previews');await mkdir(cache,{recursive:true});
    const prefix=join(cache,`${doc.sha256.slice(0,20)}-p${page}`);const image=prefix+'.png';
    if(!existsSync(image)){
      if(!pending.has(image))pending.set(image,execute(binary,['-f',String(page),'-l',String(page),'-scale-to','1500','-singlefile','-png',pdfPath,prefix],{timeout:25000,maxBuffer:1000000,windowsHide:true}).finally(()=>pending.delete(image)));
      try{await pending.get(image);}catch{throw Object.assign(new Error('PDF preview renderer unavailable. Install Poppler or set PDFTOPPM_PATH; the original PDF can still be downloaded.'),{status:503});}
    }
    return readFile(image);
  };
}
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function sourcePage(doc,page){
  const base=`/sources/${encodeURIComponent(doc.id)}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(doc.title)} — PDF page ${page}</title><link rel="stylesheet" href="/styles.css"></head><body><main class="source-reader"><div class="source-heading"><div><span class="eyebrow">Original PDF source</span><h1>${esc(doc.title)}</h1><p class="hint">${esc(doc.publisher)} · ${esc(doc.version)} · physical PDF page ${page} of ${doc.pageCount}</p></div><div class="source-actions"><a href="/corpus/${encodeURIComponent(doc.file)}?download=1">Download PDF</a><a href="${esc(doc.url)}" rel="noopener noreferrer" target="_blank">Original publication ↗</a></div></div><nav class="source-nav" aria-label="PDF pages">${page>1?`<a class="btn quiet" href="${base}?page=${page-1}">← Previous</a>`:'<span></span>'}<form action="${base}" method="get"><label for="page">PDF page</label><input id="page" name="page" type="number" min="1" max="${doc.pageCount}" value="${page}" required><button class="btn secondary" type="submit">Go</button></form>${page<doc.pageCount?`<a class="btn quiet" href="${base}?page=${page+1}">Next →</a>`:'<span></span>'}</nav><img class="source-page-image" src="/source-images/${encodeURIComponent(doc.id)}/${page}.png" alt="Original ${esc(doc.title)}, PDF page ${page}"><p class="hint">This is a rendering of the original publication, not an AI-generated summary. Printed page labels can differ from the physical PDF page number.</p></main></body></html>`;
}
