import {retrieve} from '../src/engine.js';
// Synthetic passages for fast HTTP contract tests only. The real-corpus tests
// independently search the downloaded PDFs and local embedding model.
export function mockRag(){
  const chunks=[{id:'pdf-test-spiral-p2',documentId:'sei-spiral',title:'Test spiral passage',page:2,text:'Spiral development addresses technical uncertainty through active risk reduction and review.',file:'test.pdf',pdfUrl:'/corpus/test.pdf#page=2',source:'https://example.org/test.pdf#page=2',version:'Synthetic test fixture'},
    {id:'pdf-test-requirements-p3',documentId:'nasa-handbook',title:'Test requirements passage',page:3,text:'Requirements should be reviewed and verified with stakeholder evidence and clear acceptance criteria.',file:'test.pdf',pdfUrl:'/corpus/test.pdf#page=3',source:'https://example.org/test.pdf#page=3',version:'Synthetic test fixture'}];
  return {status:()=>({ready:true,model:'test',dimensions:384,chunkCount:2,documents:[{id:'test',file:'test.pdf',pageCount:3}]}),file:()=>null,search:async(query,count=5)=>{const matches=retrieve(chunks,query,count);return matches.length?matches:chunks;}};
}
