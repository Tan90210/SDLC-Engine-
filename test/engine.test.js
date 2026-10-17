import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject} from '../src/store.js';
import {readiness,rank,retrieve,validateExtraction,snapshotHash} from '../src/engine.js';
import {FACTORS} from '../src/catalog.js';
const REFERENCES=[{id:'ref-spiral',title:'Spiral',text:'Spiral development is driven by risk reduction under uncertainty.'},{id:'ref-agile',title:'Agile',text:'Agile delivery uses feedback and working increments.'}];
import {requirementsCSV} from '../src/export.js';
import {parseJSON,freeModel,complete} from '../src/llm.js';

test('empty project cannot pass readiness',()=>{
  const p=newProject({name:'Test'});const r=readiness(p);assert.equal(r.ready,false);assert.equal(r.coverage,0);assert.equal(r.factors.length,8);assert.ok(r.blockers.length>=3);
});
test('readiness requires evidence, confirmation, completed interviews and resolved conflicts',()=>{
  const p=newProject({name:'Ready'});p.stakeholders=[{id:'s1',status:'complete'}];p.requirements=[{id:'r1',status:'confirmed',sourceIds:['m1']}];
  for(const f of FACTORS)p.factors[f.id]={value:3,sourceIds:['m1']};
  assert.equal(readiness(p).ready,true);p.conflicts.push({status:'open'});assert.equal(readiness(p).ready,false);p.conflicts[0].status='resolved';assert.equal(readiness(p).ready,true);
  p.factors.stability.sourceIds=[];assert.equal(readiness(p).coverage,88);assert.equal(readiness(p).ready,false);
});
test('retrieval finds risk-driven guidance and does not invent matches',()=>{
  const found=retrieve(REFERENCES,'spiral uncertainty risk-driven');assert.equal(found[0].id,'ref-spiral');assert.deepEqual(retrieve(REFERENCES,'zzzzzzzzzz'),[]);
});
test('extractor rejects requirements and factors without an exact evidence quote',()=>{
  const p=newProject({name:'Test'});const m={id:'m1',role:'user',text:'The system must flag suspicious payments.'};p.messages=[m];
  const result=validateExtraction({reply:'What happens next?',requirements:[{statement:'The system shall flag suspicious payments.',quote:'flag suspicious payments'},{statement:'The system shall respond in 2ms.',quote:'2ms'}],factors:{risk:{value:5,reason:'Severe losses',quote:'severe losses'}},conflicts:[]},p,'s1',m);
  assert.equal(result.requirements.length,1);assert.deepEqual(result.requirements[0].sourceIds,['m1']);assert.deepEqual(result.factors,{});
});
test('conflicts require two distinct real user messages',()=>{
  const p=newProject({name:'Test'});const m={id:'m1',role:'user',text:'Manual review is required.'};p.messages=[m,{id:'m2',role:'user',text:'Never use manual review.'},{id:'ai',role:'assistant',text:'Suggestion'}];
  const result=validateExtraction({reply:'Clarify',conflicts:[{description:'Valid conflict',sourceIds:['m1','m2']},{description:'Invented',sourceIds:['m1','fake']},{description:'AI is not stakeholder',sourceIds:['m1','ai']},{description:'Duplicate',sourceIds:['m1','m1']}]},p,'s',m);
  assert.equal(result.conflicts.length,1);
});
test('ranking is reproducible and reacts to stable versus evolving project factors',()=>{
  const p=newProject({name:'Test'});const set=values=>FACTORS.forEach((f,i)=>p.factors[f.id]={value:values[i],sourceIds:['m1']});
  set([5,3,1,4,1,1,3,5]);assert.equal(rank(p).rankings[0].id,'waterfall');
  set([1,2,2,2,5,5,4,2]);assert.equal(rank(p).rankings[0].id,'agile');
  set([2,5,5,4,4,3,4,3]);assert.equal(rank(p).rankings[0].id,'spiral');
  assert.deepEqual(rank(p),rank(p));assert.ok(rank(p).rankings.every(c=>c.score>=0&&c.score<=100));
});
test('evidence hash changes on edits but not on adding an analysis',()=>{
  const p=newProject({name:'Test'});const hash=snapshotHash(p);p.analyses.push({id:'a'});assert.equal(snapshotHash(p),hash);p.factors.risk={value:5};assert.notEqual(snapshotHash(p),hash);
});
test('CSV neutralizes spreadsheet formula injection',()=>{
  const p=newProject({name:'CSV'});p.requirements=[{id:'r',statement:'=HYPERLINK("https://bad")',sourceIds:[],quote:'@formula'}];const csv=requirementsCSV(p);assert.ok(csv.includes('"\'=HYPERLINK'));assert.ok(csv.includes('"\'@formula"'));
});
test('JSON parser accepts fenced JSON and rejects truncated output',()=>{
  assert.deepEqual(parseJSON('```json\n{"reply":"Hello"}\n```'),{reply:'Hello'});assert.throws(()=>parseJSON('{"broken":'),/malformed JSON/);
});
test('only free model identifiers are allowed',()=>{
  assert.equal(freeModel('openrouter/free'),true);assert.equal(freeModel('vendor/model:free'),true);assert.equal(freeModel('vendor/paid'),false);assert.equal(freeModel('openrouter/auto'),false);
});
test('OpenRouter sends server key with JSON format and preserves actual model and usage',async()=>{
  let captured;const result=await complete({apiKey:'test-secret',model:'openrouter/free'},'system',{answer:'evidence'},async(url,options)=>{
    captured={url,options};return new Response(JSON.stringify({model:'vendor/actual:free',usage:{total_tokens:9},choices:[{message:{content:'{"summary":"ok"}'}}]}));
  });
  assert.equal(captured.url,'https://openrouter.ai/api/v1/chat/completions');assert.equal(captured.options.headers.Authorization,'Bearer test-secret');assert.equal(JSON.parse(captured.options.body).response_format.type,'json_object');assert.equal(result.model,'vendor/actual:free');assert.equal(result.usage.total_tokens,9);
});
test('provider errors are actionable and do not disclose provider response secrets',async()=>{
  await assert.rejects(complete({apiKey:'secret',model:'openrouter/free'},'',{},async()=>new Response('secret-provider-body',{status:401})),/rejected the API key/);
  await assert.rejects(complete({apiKey:'secret',model:'vendor/paid'},'',{}),/Only openrouter/);
  await assert.rejects(complete({apiKey:'',model:'openrouter/free'},'',{}),/Add your OpenRouter/);
});
