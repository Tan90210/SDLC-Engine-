import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {existsSync} from 'node:fs';
import {once} from 'node:events';
import http from 'node:http';
import {createApplication} from '../server.js';
import {mockRag} from './fixtures.js';
import {createRag,CORPUS_DIR} from '../src/rag.js';

async function fixture(t,options={}) {
  const dir=await mkdtemp(join(tmpdir(),'forma-test-'));const app=createApplication({dataDir:dir,apiKey:'',rag:mockRag(),...options});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const base=`http://127.0.0.1:${app.server.address().port}`;
  t.after(async()=>{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));app.store.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'forma-test-'));await rm(dir,{recursive:true,force:true});});
  async function call(path,method='GET',body) {const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
  return {...app,base,call,dataDir:dir};
}
async function waitForRun(call,id){for(let i=0;i<500;i++){const p=(await call(`/api/projects/${id}`)).data;if(!p.busy)return p;await new Promise(r=>setTimeout(r,10));}throw new Error('Analysis did not finish');}

test('project interview, confirmation, factors, retrieval, analysis and exports work end-to-end',async t=>{
  const {call,base}=await fixture(t);
  const p=(await call('/api/projects','POST',{name:'Payments',description:'Safer payments'})).data;assert.equal(p.readiness.ready,false);
  let result=await call(`/api/projects/${p.id}/stakeholders`,'POST',{name:'Product owner',role:'Business'});const s=result.data.stakeholders[0];assert.equal(result.status,201);
  result=await call(`/api/projects/${p.id}/messages`,'POST',{stakeholderId:s.id,text:'Rules change weekly. Severe financial loss is possible. The integration is unproven. Audit approvals are mandatory. Stakeholders give weekly feedback. We release incrementally. Our experienced team has automated tests. The fixed budget and legacy vendor constrain delivery.'});
  assert.equal(result.status,200);assert.ok(result.data.requirements.length);assert.equal(result.data.readiness.coverage,100);assert.equal(result.data.busy,false);
  let current=result.data;
  for(const r of current.requirements)current=(await call(`/api/projects/${p.id}/requirements/${r.id}`,'PATCH',{status:'confirmed'})).data;
  current=(await call(`/api/projects/${p.id}/stakeholders/${s.id}`,'PATCH',{status:'complete'})).data;
  assert.equal(current.readiness.ready,true);
  assert.equal((await call(`/api/projects/${p.id}/search`,'POST',{query:'spiral risk uncertainty'})).data[0].documentId,'sei-spiral');
  result=await call(`/api/projects/${p.id}/analyses`,'POST',{});assert.equal(result.status,202);
  current=await waitForRun(call,p.id);const a=current.analyses.at(-1);assert.equal(a.status,'complete');assert.equal(a.agents.length,4);assert.equal(a.mode,'demo');assert.equal(a.provisional,false);
  const oldStatement=a.snapshot.requirements[0].statement;
  await call(`/api/projects/${p.id}/requirements/${current.requirements[0].id}`,'PATCH',{statement:'Updated requirement after analysis'});
  const edited=(await call(`/api/projects/${p.id}`)).data.requirements[0];assert.ok(edited.history.some(r=>r.statement===oldStatement));assert.equal(edited.status,'proposed');
  const json=await (await fetch(`${base}/api/projects/${p.id}/export?format=json&analysis=${a.id}`)).json();assert.equal(json.requirements[0].statement,oldStatement);
  const md=await (await fetch(`${base}/api/projects/${p.id}/export?format=md&analysis=${a.id}`)).text();assert.ok(md.includes('SDLC analysis'));assert.ok(md.includes('deterministic')||md.includes('Demo'));
  const currentExport=await fetch(`${base}/api/projects/${p.id}/export?format=md&analysis=current`);assert.equal(currentExport.status,200);assert.ok((await currentExport.text()).includes('Updated requirement'));
  const csv=await (await fetch(`${base}/api/projects/${p.id}/export?format=csv&analysis=current`)).text();assert.ok(csv.includes('Message IDs'));
  const audit=await call(`/api/projects/${p.id}/audit`);assert.ok(audit.data.some(r=>r.action==='analysis.complete'));
});

test('demo project is ready and source-linked',async t=>{
  const {call}=await fixture(t);const {data:p}=await call('/api/demo','POST',{});assert.equal(p.readiness.ready,true);const ids=new Set(p.messages.map(m=>m.id));assert.ok(p.requirements.every(r=>r.sourceIds.every(id=>ids.has(id))));
});

test('readiness cannot be bypassed without explicit provisional analysis',async t=>{
  const {call}=await fixture(t);const p=(await call('/api/projects','POST',{name:'Incomplete'})).data;
  assert.equal((await call(`/api/projects/${p.id}/analyses`,'POST',{})).status,409);
  assert.equal((await call(`/api/projects/${p.id}/analyses`,'POST',{provisional:true})).status,400);
  const current=(await call(`/api/projects/${p.id}/stakeholders`,'POST',{name:'Stakeholder',role:'Customer'})).data;
  await call(`/api/projects/${p.id}/messages`,'POST',{stakeholderId:current.stakeholders[0].id,text:'Customers need to view their payment history.'});
  assert.equal((await call(`/api/projects/${p.id}/analyses`,'POST',{provisional:true})).status,202);
  const completed=await waitForRun(call,p.id);assert.equal(completed.analyses.at(-1).provisional,true);assert.equal(completed.analyses.at(-1).status,'complete');
});

test('settings never return secrets and paid model selection is blocked',async t=>{
  const {call}=await fixture(t);const saved=await call('/api/config','POST',{mode:'live',model:'openrouter/free',apiKey:'test-secret-key'});assert.equal(saved.status,200);assert.equal(saved.data.hasKey,true);assert.equal(JSON.stringify(saved.data).includes('test-secret-key'),false);
  assert.equal((await call('/api/config','POST',{mode:'live',model:'vendor/paid'})).status,400);
  assert.equal((await call('/api/config','POST',{mode:'demo',model:'openrouter/free',clearKey:true})).data.hasKey,false);
});

test('live interview uses mocked OpenRouter output and saves exact quote provenance',async t=>{
  let calls=0;const {call}=await fixture(t,{apiKey:'test-secret',fetchImpl:async()=>{calls++;return new Response(JSON.stringify({model:'vendor/test:free',choices:[{message:{content:JSON.stringify({reply:'What audit trail is needed?',requirements:[{statement:'The system shall flag suspicious payments.',category:'Functional',priority:'Must',quote:'flag suspicious payments',acceptanceCriteria:''}],factors:{risk:{value:5,reason:'Severe losses',quote:'severe financial losses'}},conflicts:[]})}}]}));}});
  const p=(await call('/api/projects','POST',{name:'Live'})).data;const current=(await call(`/api/projects/${p.id}/stakeholders`,'POST',{name:'Risk owner',role:'Risk'})).data;
  const result=await call(`/api/projects/${p.id}/messages`,'POST',{stakeholderId:current.stakeholders[0].id,text:'We must flag suspicious payments to avoid severe financial losses.'});
  assert.equal(result.status,200);assert.equal(calls,1);assert.equal(result.data.requirements[0].quote,'flag suspicious payments');assert.equal(result.data.messages.at(-1).model,'vendor/test:free');assert.equal(result.data.factors.risk.value,5);
});

test('failed live call is atomic and clears the project lock',async t=>{
  const {call}=await fixture(t,{apiKey:'test-secret',fetchImpl:async()=>new Response('provider error',{status:503})});const p=(await call('/api/projects','POST',{name:'Failure'})).data;const before=(await call(`/api/projects/${p.id}/stakeholders`,'POST',{name:'Owner',role:'Business'})).data;
  const failed=await call(`/api/projects/${p.id}/messages`,'POST',{stakeholderId:before.stakeholders[0].id,text:'This answer should remain unsaved when the model fails.'});assert.equal(failed.status,502);
  const after=(await call(`/api/projects/${p.id}`)).data;assert.equal(after.messages.length,before.messages.length);assert.equal(after.busy,false);
});

test('live multi-agent run completes with validated evidence and frozen references',async t=>{
  let calls=0;const {call}=await fixture(t,{apiKey:'test-secret',fetchImpl:async(_url,options)=>{
    calls++;const input=JSON.parse(JSON.parse(options.body).messages[1].content);const id=input.messages[0].id;
    return new Response(JSON.stringify({model:'vendor/mock:free',choices:[{message:{content:JSON.stringify({summary:'Review completed',recommendation:'Use incremental delivery with explicit assurance gates.',findings:[{text:input.messages[0].text,sourceIds:[id],referenceIds:[input.references[0].id],referenceQuote:input.references[0].text.slice(0,60)}],gaps:[]})}}]}));
  }});
  const p=(await call('/api/demo','POST',{})).data;await call(`/api/projects/${p.id}/analyses`,'POST',{});const done=await waitForRun(call,p.id);assert.equal(done.analyses[0].status,'complete');assert.equal(done.analyses[0].agents.length,4);assert.equal(done.analyses[0].mode,'live');assert.equal(calls,4);
});

test('unsupported analyst source IDs fail the run without accepting findings',async t=>{
  const {call}=await fixture(t,{apiKey:'test',fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({summary:'Invalid',recommendation:'Unsupported',findings:[{text:'Claim',sourceIds:['invented'],referenceIds:[]}],gaps:[]})}}]}))});
  const p=(await call('/api/demo','POST',{})).data;await call(`/api/projects/${p.id}/analyses`,'POST',{});const done=await waitForRun(call,p.id);assert.equal(done.analyses[0].status,'failed');assert.equal(done.analyses[0].agents.length,0);assert.match(done.analyses[0].error,/unsupported evidence/);
});

test('validation rejects stale writes, nonexistent sources and cross-origin requests',async t=>{
  const {call,base}=await fixture(t);const p=(await call('/api/projects','POST',{name:'Validation'})).data;
  assert.equal((await call(`/api/projects/${p.id}/stakeholders`,'POST',{name:'Owner',role:'Business',revision:0})).status,409);
  assert.equal((await call(`/api/projects/${p.id}/factors/risk`,'PUT',{value:5,reason:'Claim',sourceIds:['fake']})).status,400);
  assert.equal((await fetch(`${base}/api/config`,{headers:{Origin:'https://untrusted.example'}})).status,403);
  const badHostStatus=await new Promise((resolve,reject)=>{const req=http.get(`${base}/api/config`,{headers:{Host:'attacker.example'}},response=>{response.resume();resolve(response.statusCode);});req.on('error',reject);});
  assert.equal(badHostStatus,403);
  const response=await fetch(base);assert.equal(response.status,200);assert.ok(response.headers.get('content-security-policy').includes("script-src 'self'"));
  assert.equal((await fetch(`${base}/.env`)).status,404);
});

test('knowledge changes do not mutate past analysis snapshots',async t=>{
  const {call}=await fixture(t);const p=(await call('/api/demo','POST',{})).data;await call(`/api/projects/${p.id}/analyses`,'POST',{});const done=await waitForRun(call,p.id);const count=done.analyses[0].snapshot.knowledge.length;
  const result=await call(`/api/projects/${p.id}/knowledge`,'POST',{title:'Internal policy',text:'All releases require owner approval.',version:'1.0'});assert.equal(result.status,201);assert.equal(result.data.knowledge.length,count+1);assert.equal(result.data.analyses[0].snapshot.knowledge.length,count);
});

test('SQLite survives reopening the store and recovers interrupted analyses',async t=>{
  const {store,call,dataDir}=await fixture(t);const p=(await call('/api/projects','POST',{name:'Persistent'})).data;
  const saved=store.get(p.id);saved.analyses.push({id:'interrupted',status:'running'});store.save(saved,'test.interrupt');
  const second=createApplication({dataDir,apiKey:'',rag:mockRag()});
  try {assert.equal(second.store.get(p.id).name,'Persistent');assert.equal(second.store.get(p.id).analyses[0].status,'failed');assert.match(second.store.get(p.id).analyses[0].error,/restarted/);}finally{second.store.close();}
});

test('in-flight live interviews lock project writes and settings, but permit reads',async t=>{
  let release;let reached;const called=new Promise(r=>reached=r);
  const {call}=await fixture(t,{apiKey:'test-secret',fetchImpl:async()=>{reached();return new Promise(r=>release=r);}});
  const p=(await call('/api/projects','POST',{name:'Locking'})).data;
  const current=(await call(`/api/projects/${p.id}/stakeholders`,'POST',{name:'Owner',role:'Business'})).data;
  const pending=call(`/api/projects/${p.id}/messages`,'POST',{stakeholderId:current.stakeholders[0].id,text:'Customers must be able to view their payments.'});
  await called;
  assert.equal((await call(`/api/projects/${p.id}`)).data.busy,true);
  assert.equal((await call(`/api/projects/${p.id}/stakeholders`,'POST',{name:'Another',role:'Technical'})).status,409);
  assert.equal((await call('/api/config','POST',{mode:'demo',model:'openrouter/free'})).status,409);
  release(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({reply:'Who are the primary users?',requirements:[],factors:{},conflicts:[]})}}]})));
  assert.equal((await pending).status,200);assert.equal((await call(`/api/projects/${p.id}`)).data.busy,false);
});

test('minimal project setup creates selected stakeholders and bulk review confirms proposals',async t=>{
  const {call}=await fixture(t);const result=await call('/api/projects','POST',{name:'Simple setup',description:'Test setup',stakeholders:[{name:'Owner',role:'Business'},{name:'Architect',role:'Technical'}]});assert.equal(result.status,201);const p=result.data;assert.equal(p.stakeholders.length,2);assert.equal(p.messages.length,2);
  await call(`/api/projects/${p.id}/messages`,'POST',{stakeholderId:p.stakeholders[0].id,text:'The system must show transaction history. An audit trail is required.'});
  const confirmed=await call(`/api/projects/${p.id}/requirements/confirm`,'POST',{});assert.equal(confirmed.status,200);assert.ok(confirmed.data.requirements.every(r=>r.status==='confirmed'));
  assert.equal((await call('/api/projects','POST',{name:'Invalid',stakeholders:[]})).status,400);
});

test('correct reference IDs with invented quoted text fail citation validation',async t=>{
  const {call}=await fixture(t,{apiKey:'test',fetchImpl:async(_url,options)=>{const input=JSON.parse(JSON.parse(options.body).messages[1].content);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({summary:'Wrong quote',recommendation:'Unsupported',findings:[{text:'Claim',sourceIds:[input.messages[0].id],referenceIds:[input.references[0].id],referenceQuote:'This fabricated sentence is not in the retrieved PDF.'}],gaps:[]})}}]}));}});
  const p=(await call('/api/demo','POST',{})).data;await call(`/api/projects/${p.id}/analyses`,'POST',{});const done=await waitForRun(call,p.id);assert.equal(done.analyses[0].status,'failed');assert.match(done.analyses[0].error,/PDF quote/);assert.equal(done.analyses[0].agents.length,0);
});

test('real corpus HTTP search, local PDF serving and four-role demo work together',{skip:!existsSync(join(CORPUS_DIR,'index.json'))},async t=>{
  const {call,base}=await fixture(t,{rag:createRag()});const status=(await call('/api/corpus')).data;assert.equal(status.documents.length,4);assert.equal(status.ready,true);
  const search=await call('/api/corpus/search','POST',{query:'uncertain requirements and technical risks in spiral development'});assert.equal(search.status,200);assert.equal(search.data.passages[0].documentId,'sei-spiral');
  const pdf=await fetch(`${base}/corpus/sei-spiral.pdf`);assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.ok(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).toString().startsWith('%PDF-'));
  const page=await fetch(`${base}/sources/sei-spiral?page=20`);assert.equal(page.status,200);assert.ok((await page.text()).includes('/source-images/sei-spiral/20.png'));
  assert.equal((await fetch(`${base}/sources/sei-spiral?page=9999`)).status,400);
  const image=await fetch(`${base}/source-images/sei-spiral/20.png`);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.equal(Buffer.from(await image.arrayBuffer()).subarray(1,4).toString(),'PNG');
  assert.equal((await fetch(`${base}/corpus/index.json`)).status,404);
  const p=(await call('/api/demo','POST',{})).data;const start=await call(`/api/projects/${p.id}/analyses`,'POST',{});assert.equal(start.status,202);const done=await waitForRun(call,p.id);const a=done.analyses.at(-1);assert.equal(a.status,'complete');assert.equal(a.agents.length,4);assert.equal(a.rag.documents.length,4);assert.ok(a.agents.every(agent=>agent.findings.every(f=>a.references.some(r=>f.referenceIds.includes(r.id)&&r.text.includes(f.referenceQuote)))));
});
