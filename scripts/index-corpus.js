import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {chunkPages,CORPUS_DIR} from '../src/rag.js';
import {createEmbedder,EMBEDDING_MODEL,EMBEDDING_DIMENSIONS} from '../src/embeddings.js';

const source=JSON.parse(await readFile(join(CORPUS_DIR,'pages.json'),'utf8'));
const chunks=chunkPages(source.documents);
console.log(`${source.documents.length} PDFs → ${chunks.length} page-preserving chunks (160 words, 35-word overlap).`);
console.log(`Loading ${EMBEDDING_MODEL} (quantized CPU model; downloaded once, cached locally)...`);
const embed=await createEmbedder({allowDownload:true});
for(let start=0;start<chunks.length;start+=12){
  const batch=chunks.slice(start,start+12);
  const vectors=await embed(batch.map(c=>c.text));
  vectors.forEach((vector,i)=>{if(vector.length!==EMBEDDING_DIMENSIONS)throw new Error('Unexpected vector dimensions.');chunks[start+i].embedding=vector.map(n=>Math.round(n*1e6)/1e6);});
  if(start%120===0||start+12>=chunks.length)console.log(`Embedded ${Math.min(start+12,chunks.length)} / ${chunks.length}`);
}
const documents=source.documents.map(({pages,...doc})=>doc);
const index={version:1,model:EMBEDDING_MODEL,dimensions:EMBEDDING_DIMENSIONS,indexedAt:new Date().toISOString(),chunking:{words:160,overlap:35,pageBoundaries:true},documents,chunks};
const temp=join(CORPUS_DIR,'index.json.tmp');await writeFile(temp,JSON.stringify(index));await rename(temp,join(CORPUS_DIR,'index.json'));
console.log('Saved corpus/index.json. Embeddings and PDF retrieval now work offline.');
