import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {chunkPages,cosine,hybridRank,createRag,CORPUS_DIR} from '../src/rag.js';

test('chunks preserve PDF page boundaries, use overlap and stable identifiers',()=>{
  const doc={id:'sample',sha256:'abc',title:'Test',file:'test.pdf',url:'https://example.org/test.pdf',pages:[{page:1,text:Array.from({length:210},(_,i)=>`word${i}`).join(' ')},{page:2,text:Array.from({length:30},(_,i)=>`other${i}`).join(' ')}]};
  const chunks=chunkPages([doc]);assert.equal(chunks.length,3);assert.equal(chunks[0].page,1);assert.equal(chunks[1].wordStart,125);assert.ok(chunks[1].text.startsWith('word125'));assert.equal(chunks[2].page,2);assert.equal(chunks[2].pdfUrl,'/corpus/test.pdf#page=2');assert.deepEqual(chunks,chunkPages([doc]));
});
test('dense retrieval can find a semantic match without overlapping query words',()=>{
  const chunks=[{id:'semantic',title:'A',text:'iterative experimentation',documentId:'a',page:1,embedding:[1,0]},{id:'keyword',title:'B',text:'risk uncertainty',documentId:'b',page:1,embedding:[0,1]}];
  const result=hybridRank(chunks,[1,0],'risk uncertainty',2);assert.equal(result[0].id,'semantic');assert.equal('embedding' in result[0],false);assert.equal(result[0].semanticSimilarity,1);assert.equal(cosine([1,0],[0,1]),0);
});
test('missing corpus fails explicitly instead of using seed summaries',async()=>{
  const rag=createRag({corpusDir:join(CORPUS_DIR,'nonexistent-test-directory')});assert.equal(rag.status().ready,false);await assert.rejects(rag.search('risk'),/not indexed/);
});

const installed=existsSync(join(CORPUS_DIR,'index.json'))&&existsSync(join(CORPUS_DIR,'pages.json'));
test('real index passages match their original extracted pages and document checksums',{skip:!installed},()=>{
  const index=JSON.parse(readFileSync(join(CORPUS_DIR,'index.json'),'utf8'));const pages=JSON.parse(readFileSync(join(CORPUS_DIR,'pages.json'),'utf8'));
  assert.equal(index.documents.length,4);assert.ok(index.chunks.length>1000);
  const docs=new Map(pages.documents.map(d=>[d.id,d]));
  for(const doc of index.documents){assert.equal(createHash('sha256').update(readFileSync(join(CORPUS_DIR,'pdfs',doc.file))).digest('hex'),doc.sha256);}
  for(const c of index.chunks){assert.equal(c.embedding.length,384);assert.ok(docs.get(c.documentId).pages.find(p=>p.page===c.page).text.includes(c.text));assert.ok(Math.abs(Math.sqrt(c.embedding.reduce((sum,n)=>sum+n*n,0))-1)<.001);}
});
test('real offline semantic search retrieves appropriate external PDFs with page citations',{skip:!installed},async()=>{
  const rag=createRag();
  const cases=[['uncertain requirements and technical risks in spiral development','sei-spiral'],['Scrum Product Owner Sprint Goal Increment stakeholder feedback','scrum-guide'],['secure software vulnerability response protect software development environments','nist-ssdf'],['stakeholder expectations technical requirements verification validation acceptance criteria','nasa-handbook']];
  for(const [query,expected] of cases){const result=await rag.search(query,4);assert.ok(result.some(r=>r.documentId===expected),`No ${expected} passage for ${query}`);assert.ok(result.every(r=>r.page>0&&r.pdfUrl.includes(`#page=${r.page}`)&&r.retrievalMethod.startsWith('hybrid')));assert.ok(result.every(r=>!('embedding' in r)));}
});
