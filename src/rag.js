import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { retrieve as lexicalSearch } from './engine.js';
import { createEmbedder, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from './embeddings.js';

export const CORPUS_DIR=fileURLToPath(new URL('../corpus/',import.meta.url));
export function chunkPages(documents,{words=160,overlap=35}={}) {
  if(words<=overlap||overlap<0)throw new Error('Chunk overlap must be smaller than chunk size.');
  const chunks=[];
  for(const doc of documents)for(const page of doc.pages){
    const tokens=page.text.split(/\s+/).filter(Boolean);
    if(tokens.length<20)continue;
    for(let start=0;start<tokens.length;start+=words-overlap){
      const content=tokens.slice(start,start+words).join(' ');
      const hash=createHash('sha256').update(`${doc.sha256}:${page.page}:${start}:${content}`).digest('hex').slice(0,12);
      chunks.push({id:`pdf-${doc.id}-p${page.page}-${hash}`,documentId:doc.id,title:doc.title,publisher:doc.publisher,
        text:content,page:page.page,wordStart:start,file:doc.file,source:`${doc.url}#page=${page.page}`,pdfUrl:`/corpus/${doc.file}#page=${page.page}`,
        version:doc.version,documentSha256:doc.sha256,kind:'PDF passage'});
      if(start+words>=tokens.length)break;
    }
  }
  return chunks;
}
export function cosine(a,b){
  if(a.length!==b.length)throw new Error('Embedding dimensions differ. Rebuild the corpus.');
  let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}
  return aa&&bb?dot/Math.sqrt(aa*bb):0;
}
export function hybridRank(chunks,queryVector,query,count=5) {
  const dense=chunks.map(c=>({id:c.id,similarity:cosine(queryVector,c.embedding)})).filter(x=>x.similarity>.15).sort((a,b)=>b.similarity-a.similarity);
  const lexical=lexicalSearch(chunks,query,Math.min(chunks.length,100));
  const fused=new Map();
  // Weighted reciprocal-rank fusion avoids mixing incomparable raw score scales.
  dense.slice(0,100).forEach((c,i)=>fused.set(c.id,{similarity:c.similarity,score:.7/(60+i+1)}));
  lexical.forEach((c,i)=>{const prev=fused.get(c.id)||{similarity:0,score:0};fused.set(c.id,{...prev,score:prev.score+.3/(60+i+1)});});
  const byId=new Map(chunks.map(c=>[c.id,c]));
  const picked=[];const counts=new Map();
  for(const [id,result] of [...fused].sort((a,b)=>b[1].score-a[1].score)){
    const original=byId.get(id);const pageKey=`${original.documentId}:${original.page}`;
    if((counts.get(pageKey)||0)>=2)continue;
    const {embedding,...chunk}=original;
    picked.push({...chunk,pageUrl:`/sources/${encodeURIComponent(chunk.documentId)}?page=${chunk.page}`,semanticSimilarity:Math.round(result.similarity*1000)/1000,retrievalScore:Math.round(result.score*100000)/100000,retrievalMethod:'hybrid: MiniLM cosine + BM25 reciprocal-rank fusion'});
    counts.set(pageKey,(counts.get(pageKey)||0)+1);if(picked.length>=count)break;
  }
  return picked;
}
export function createRag({index,embed,corpusDir=CORPUS_DIR}={}){
  let loaded=index;let loadError;
  if(!loaded)try{loaded=JSON.parse(readFileSync(join(corpusDir,'index.json'),'utf8'));}catch{loadError='PDF corpus is not indexed. Run the corpus setup commands in README.md.';}
  if(loaded&&(loaded.model!==EMBEDDING_MODEL||loaded.dimensions!==EMBEDDING_DIMENSIONS||!Array.isArray(loaded.chunks)||!loaded.chunks.length)){
    loaded=null;loadError='The PDF index has an incompatible format. Rebuild it.';
  }
  if(loaded&&!index){
    try{for(const doc of loaded.documents){const digest=createHash('sha256').update(readFileSync(join(corpusDir,'pdfs',doc.file))).digest('hex');if(digest!==doc.sha256)throw new Error('checksum mismatch');}}
    catch{loaded=null;loadError='A source PDF is missing or changed after indexing. Rebuild the PDF corpus.';}
  }
  const fingerprint=loaded?createHash('sha256').update(JSON.stringify({model:loaded.model,documents:loaded.documents.map(d=>({id:d.id,sha256:d.sha256}))})).digest('hex'):null;
  let embedding=embed;let lastError=loadError;const cache=new Map();let queue=Promise.resolve();
  return {
    status(){return {ready:Boolean(loaded),fingerprint,model:loaded?.model||EMBEDDING_MODEL,dimensions:EMBEDDING_DIMENSIONS,chunkCount:loaded?.chunks.length||0,
      method:'Local MiniLM embeddings + BM25 hybrid retrieval',indexedAt:loaded?.indexedAt||null,error:lastError||null,
      documents:(loaded?.documents||[]).map(d=>({...d,pdfUrl:`/corpus/${d.file}`,viewUrl:`/sources/${encodeURIComponent(d.id)}?page=1`}))};},
    file(name){return loaded?.documents.find(d=>d.file===name)&&existsSync(join(corpusDir,'pdfs',name))?join(corpusDir,'pdfs',name):null;},
    async search(query,count=5){
      if(!loaded)throw Object.assign(new Error(loadError),{status:503});
      const normalized=query.replace(/\s+/g,' ').trim().slice(0,6000);
      if(!normalized)return [];
      const key=`${count}:${normalized}`;if(cache.has(key))return structuredClone(cache.get(key));
      const operation=queue.then(async()=>{
        try{
          embedding ||= await createEmbedder();
          const [vector]=await embedding([normalized]);
          const found=hybridRank(loaded.chunks,vector,normalized,count);
          cache.set(key,found);if(cache.size>60)cache.delete(cache.keys().next().value);lastError=null;return structuredClone(found);
        }catch(error){lastError='Local embedding model could not run. Complete corpus setup, then restart the server.';throw Object.assign(new Error(lastError),{status:503});}
      });
      queue=operation.catch(()=>{});return operation;
    }
  };
}
