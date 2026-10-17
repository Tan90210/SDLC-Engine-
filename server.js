import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createStore, newProject, uid, now } from './src/store.js';
import { FACTORS, CATEGORIES, ROLES, AGENTS } from './src/catalog.js';
import { readiness, rank, snapshotHash, validateExtraction, demoExtract } from './src/engine.js';
import { complete, freeModel, interviewPrompt, agentPrompt } from './src/llm.js';
import { report, requirementsCSV } from './src/export.js';
import { createRag } from './src/rag.js';
import { createPdfPreview,sourcePage } from './src/pdf-preview.js';

const root = dirname(fileURLToPath(import.meta.url));
class HttpError extends Error { constructor(status,message) { super(message); this.status=status; } }
function assert(value, message, status=400) { if(!value) throw new HttpError(status,message); }
function text(value,label,max=2000) { assert(typeof value==='string' && value.trim() && value.length<=max,`${label} must contain 1–${max} characters.`); return value.trim(); }

export function createApplication({ dataDir=process.env.DATA_DIR||join(root,'data'), fetchImpl=fetch, apiKey=process.env.OPENROUTER_API_KEY||'', model=process.env.OPENROUTER_MODEL||'openrouter/free', rag=createRag() }={}) {
  const store = createStore(resolve(dataDir));
  const preview=createPdfPreview(dataDir);
  const settings = { apiKey, model:freeModel(model)?model:'openrouter/free', mode:apiKey?'live':'demo' };
  const locks = new Set();
  // A process restart cannot resume an interrupted provider request.
  for(const p of store.list()) {
    let changed=false;
    for(const a of p.analyses) if(a.status==='running') {a.status='failed';a.error='Server restarted during analysis. Run a new analysis.';changed=true;}
    if(changed) store.save(p,'analysis.interrupted');
  }
  const view = p => ({ ...p, readiness:readiness(p), busy:locks.has(p.id), currentHash:snapshotHash(p) });
  const config = () => ({mode:settings.mode,model:settings.model,hasKey:Boolean(settings.apiKey),factors:FACTORS,categories:CATEGORIES,roles:ROLES});
  const projectFor = id => {const p=store.get(id);assert(p,'Project not found.',404);return p;};
  const unlocked = id => assert(!locks.has(id),'This project has an interview or analysis running. Wait for it to finish.',409);
  const knownSources = p => new Set(p.messages.filter(m=>m.role==='user').map(m=>m.id));
  const sourceList = (p,list) => {assert(Array.isArray(list)&&list.length>0&&list.every(id=>knownSources(p).has(id)),'Select valid stakeholder message evidence.');return [...new Set(list)];};
  async function runAnalysis(snapshot, analysisId, runSettings) {
    try {
      for(const agent of AGENTS) {
        const saved=store.get(snapshot.id); const run=saved.analyses.find(a=>a.id===analysisId);
        const previous=run.agents.filter(a=>a.status==='complete');
        const referenceQuery=`${agent.focus} ${snapshot.description} ${Object.values(snapshot.factors).map(f=>f.reason).join(' ')}`;
        const references=await rag.search(referenceQuery,5);
        assert(references.length,'No PDF evidence was retrieved. Try a more specific project description.',422);
        for(const ref of references)if(!run.references.some(r=>r.id===ref.id))run.references.push(ref);
        store.save(saved,'analysis.retrieved',agent.id);
        let result;
        if(runSettings.mode==='demo') {
          result={output:{summary:`Demo ${agent.name.toLowerCase()}: ${run.decision.rankings[0].name} leads the rubric. Real PDF passages have been retrieved below; this narrative is a deterministic example, not LLM reasoning.`,findings:snapshot.requirements.filter(r=>r.status!=='rejected').slice(0,1).map(r=>({text:`Project evidence: ${r.statement} The PDF quote is provided for inspection; demo mode does not establish support for the recommendation.`,sourceIds:r.sourceIds,referenceIds:[references[0].id],referenceQuote:references[0].text.slice(0,230)})),gaps:readiness(snapshot).blockers,recommendation:run.decision.rankings[0].tradeoff},model:'deterministic-demo',usage:null};
        } else {
          result=await complete(runSettings,agentPrompt(agent),{project:{name:snapshot.name,description:snapshot.description,domain:snapshot.domain,jurisdiction:snapshot.jurisdiction},requirements:snapshot.requirements,factors:snapshot.factors,conflicts:snapshot.conflicts,messages:snapshot.messages.filter(m=>m.role==='user'),references,decision:run.decision,previousAnalyses:previous},fetchImpl);
        }
        const output=result.output;
        assert(typeof output.summary==='string'&&typeof output.recommendation==='string'&&Array.isArray(output.findings)&&Array.isArray(output.gaps),'The analysis agent returned an invalid response.',502);
        const validMessages=knownSources(snapshot);const validRefs=new Set(references.map(r=>r.id));
        const findings=output.findings.slice(0,6).map(f=>{
          assert(typeof f.text==='string'&&Array.isArray(f.sourceIds)&&f.sourceIds.length>0&&f.sourceIds.every(id=>validMessages.has(id))&&Array.isArray(f.referenceIds)&&f.referenceIds.length>0&&f.referenceIds.every(id=>validRefs.has(id)),'An analysis agent returned unsupported evidence IDs. No recommendation from this agent was accepted.',502);
          assert(typeof f.referenceQuote==='string'&&f.referenceQuote.trim().length>=20&&f.referenceQuote.length<=800&&references.some(r=>f.referenceIds.includes(r.id)&&r.text.includes(f.referenceQuote.trim())),'An analysis agent returned a PDF quote that was not found in its retrieved passages. Retry the analysis.',502);
          return {text:f.text.slice(0,3000),sourceIds:[...new Set(f.sourceIds)],referenceIds:[...new Set(f.referenceIds)],referenceQuote:f.referenceQuote.trim()};
        });
        assert(findings.length,'An analysis agent returned no PDF-supported findings. Retry the analysis.',502);
        const current=store.get(snapshot.id);const a=current.analyses.find(x=>x.id===analysisId);
        a.agents.push({id:agent.id,name:agent.name,status:'complete',summary:output.summary.slice(0,5000),recommendation:output.recommendation.slice(0,5000),findings,gaps:output.gaps.filter(x=>typeof x==='string').slice(0,5).map(x=>x.slice(0,1500)),model:result.model,usage:result.usage,retrievalQuery:referenceQuery,referenceIds:references.map(r=>r.id),completedAt:now()});
        store.save(current,'analysis.agent.complete',agent.id);
      }
      const p=store.get(snapshot.id);const a=p.analyses.find(x=>x.id===analysisId);a.status='complete';a.completedAt=now();store.save(p,'analysis.complete',analysisId);
    } catch(error) {
      const p=store.get(snapshot.id);const a=p.analyses.find(x=>x.id===analysisId);a.status='failed';a.error=error.status?error.message:'Analysis failed unexpectedly. Retry the analysis.';store.save(p,'analysis.failed',analysisId);
    } finally {locks.delete(snapshot.id);}
  }

  async function route(req,res) {
    const host=req.headers.host || '';
    assert(/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host),'This app accepts localhost requests only.',403);
    if(req.headers.origin) assert(req.headers.origin===`http://${host}`,'Cross-origin requests are not allowed.',403);
    const url=new URL(req.url,`http://${host}`);const parts=url.pathname.split('/').filter(Boolean);
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Cache-Control','no-store');
    const send=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
    let body={};
    if(['POST','PATCH','PUT'].includes(req.method)) {
      assert((req.headers['content-type']||'').startsWith('application/json'),'Use application/json.',415);
      req.setEncoding('utf8');
      let content='';for await(const chunk of req){content+=chunk;assert(Buffer.byteLength(content)<=750000,'Request too large.',413);}
      try{body=JSON.parse(content||'{}');}catch{throw new HttpError(400,'Invalid JSON request.');}
      assert(body&&typeof body==='object'&&!Array.isArray(body),'Expected a JSON object.');
    }
    if(url.pathname==='/api/config' && req.method==='GET') return send(config());
    if(url.pathname==='/api/corpus' && req.method==='GET') return send(rag.status());
    if(url.pathname==='/api/corpus/search' && req.method==='POST') return send({query:text(body.query,'Query',1000),passages:await rag.search(body.query,5)});
    if((parts[0]==='sources'||parts[0]==='source-images')&&req.method==='GET'){
      const doc=rag.status().documents.find(d=>d.id===parts[1]);assert(doc,'Source not found.',404);
      const page=Number(parts[0]==='sources'?(url.searchParams.get('page')||1):parts[2]?.replace(/\.png$/,''));
      assert(Number.isInteger(page)&&page>=1&&page<=doc.pageCount,'PDF page out of range.',400);
      const path=rag.file(doc.file);assert(path,'Source PDF missing.',404);
      if(parts[0]==='sources'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(sourcePage(doc,page));}
      const png=await preview(path,doc,page);res.writeHead(200,{'Content-Type':'image/png'});return res.end(png);
    }
    if(parts[0]==='corpus'&&parts.length===2&&req.method==='GET') {
      const path=rag.file(parts[1]);assert(path,'PDF not found.',404);
      res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':`${url.searchParams.has('download')?'attachment':'inline'}; filename="${parts[1]}"`});return res.end(await readFile(path));
    }
    if(url.pathname==='/api/config' && req.method==='POST') {
      assert(!locks.size,'Wait for active model calls before changing settings.',409);
      assert(['live','demo'].includes(body.mode),'Choose live or demo mode.');
      assert(typeof body.model==='string'&&freeModel(body.model),'Choose openrouter/free or a model ending in :free.');
      let nextKey=settings.apiKey;
      if(body.apiKey!==undefined) {assert(typeof body.apiKey==='string'&&body.apiKey.length<=500,'Invalid API key.');if(body.apiKey.trim()) nextKey=body.apiKey.trim();}
      if(body.clearKey) nextKey='';
      assert(body.mode!=='live'||nextKey,'Enter an OpenRouter API key before switching to live mode.');
      settings.apiKey=nextKey;settings.mode=body.mode;settings.model=body.model;return send(config());
    }
    if(url.pathname==='/api/models' && req.method==='GET') {
      try {
        const r=await fetchImpl('https://openrouter.ai/api/v1/models',{signal:AbortSignal.timeout(15000)});assert(r.ok,'Could not load the model directory.',502);const data=await r.json();
        return send({models:(data.data||[]).filter(m=>freeModel(m.id)&&Number(m.pricing?.prompt)===0&&Number(m.pricing?.completion)===0).map(m=>({id:m.id,name:m.name})).sort((a,b)=>a.name.localeCompare(b.name))});
      }catch {throw new HttpError(502,'Could not load free models. You can still enter openrouter/free or a known :free model ID.');}
    }
    if(url.pathname==='/api/projects' && req.method==='GET') return send(store.list().map(p=>({id:p.id,name:p.name,description:p.description,domain:p.domain,updatedAt:p.updatedAt,requirements:p.requirements.length,stakeholders:p.stakeholders.length,coverage:readiness(p).coverage})));
    if(url.pathname==='/api/projects' && req.method==='POST') {
      const p=newProject({name:text(body.name,'Project name',100),description:typeof body.description==='string'?body.description.slice(0,4000):'',domain:body.domain?text(body.domain,'Domain',100):undefined,jurisdiction:body.jurisdiction?text(body.jurisdiction,'Jurisdiction',100):undefined});
      if(body.stakeholders!==undefined){
        assert(Array.isArray(body.stakeholders)&&body.stakeholders.length>0&&body.stakeholders.length<=10,'Choose 1–10 stakeholders.');
        for(const person of body.stakeholders){
          const stakeholder={id:uid('s-'),name:text(person.name,'Stakeholder name',100),role:text(person.role,'Role',100),status:'open'};
          p.stakeholders.push(stakeholder);
          p.messages.push({id:uid('m-'),stakeholderId:stakeholder.id,role:'assistant',text:`From your perspective as ${stakeholder.role.toLowerCase()}, what problem should this project solve, who will use it, and what does a successful outcome look like?`,createdAt:now(),mode:settings.mode});
        }
      }
      return send(view(store.save(p,'project.created')),201);
    }
    if(url.pathname==='/api/demo' && req.method==='POST') {
      const p=newProject({name:'Sentinel · Fraud detection',description:'Demonstration project for a transaction fraud detection service. All stakeholders and statements are synthetic.',jurisdiction:'Demo — not a compliance assessment'});
      const names=[['Maya Chen','Business / product owner'],['Arjun Rao','Software architects / developers'],['Samira Patel','Compliance / legal']];
      p.stakeholders=names.map(([name,role])=>({id:uid('s-'),name,role,status:'complete'}));
      const answers=[
        'Our fraud rules change weekly. The system must flag suspicious payments and route them to analysts. Stakeholders can review working increments every week.',
        'Failure can cause severe financial loss. We need audit trails and formal release approvals. Every automated decision must be traceable to the rule version.',
        'The new scoring integration is unproven and needs a prototype. We can release incrementally. Our experienced team has automated tests. A fixed budget and legacy payment gateway constrain delivery.'
      ];
      answers.forEach((answer,i)=>{
        const m={id:uid('m-'),stakeholderId:p.stakeholders[i].id,role:'user',text:answer,createdAt:now(),mode:'demo'};p.messages.push(m);
        const ex=demoExtract(p,p.stakeholders[i].id,m);for(const r of ex.requirements)p.requirements.push({...r,id:`REQ-${String(p.requirements.length+1).padStart(3,'0')}`,status:'confirmed'});Object.assign(p.factors,ex.factors);
      });
      p.messages.push({id:uid('m-'),stakeholderId:p.stakeholders[0].id,role:'assistant',text:'This is a synthetic demonstration. Explore the requirements, inspect evidence, and run a clearly labelled demo analysis.',createdAt:now(),mode:'demo'});
      return send(view(store.save(p,'project.demo.created')),201);
    }
    if(parts[0]==='api'&&parts[1]==='projects'&&parts[2]) {
      const p=projectFor(parts[2]);const resource=parts[3];
      if(!resource&&req.method==='GET') return send(view(p));
      if(resource==='audit'&&req.method==='GET') return send(store.audit(p.id));
      if(resource==='export'&&req.method==='GET') {
        const format=url.searchParams.get('format')||'json';const runId=url.searchParams.get('analysis');const a=runId==='current'?null:runId?p.analyses.find(x=>x.id===runId):p.analyses.at(-1);
        assert(!runId||runId==='current'||a,'Analysis not found.',404);
        const exported=a?{...structuredClone(p),...structuredClone(a.snapshot),analyses:[a]}:p;
        const content=format==='md'?report(exported,a):format==='csv'?requirementsCSV(exported):JSON.stringify({...exported,audit:store.audit(p.id)},null,2);
        const type=format==='md'?'text/markdown':format==='csv'?'text/csv':'application/json';
        assert(['md','csv','json'].includes(format),'Unknown export format.');
        res.writeHead(200,{'Content-Type':`${type}; charset=utf-8`,'Content-Disposition':`attachment; filename="requirements-engine.${format}"`});return res.end(content);
      }
      unlocked(p.id);
      if(body.revision!==undefined) assert(body.revision===p.revision,'Project changed. Refresh and retry.',409);
      if(resource==='stakeholders'&&req.method==='POST') {
        assert(p.stakeholders.length<30,'Maximum 30 stakeholders per project.');
        const s={id:uid('s-'),name:text(body.name,'Stakeholder name',100),role:text(body.role,'Role',100),status:'open'};p.stakeholders.push(s);
        p.messages.push({id:uid('m-'),stakeholderId:s.id,role:'assistant',text:`Hello ${s.name}. From your perspective as ${s.role.toLowerCase()}, what problem should this project solve, who will use it, and what does a successful outcome look like?`,createdAt:now(),mode:settings.mode});
        return send(view(store.save(p,'stakeholder.added',s.id)),201);
      }
      if(resource==='stakeholders'&&parts[4]&&req.method==='PATCH') {
        const s=p.stakeholders.find(s=>s.id===parts[4]);assert(s,'Stakeholder not found.',404);assert(['open','complete','omitted'].includes(body.status),'Invalid interview status.');
        if(body.status==='complete') assert(p.messages.some(m=>m.stakeholderId===s.id&&m.role==='user'),'Collect an answer or mark the stakeholder omitted.');
        s.status=body.status;return send(view(store.save(p,'stakeholder.status',s.id)));
      }
      if(resource==='messages'&&req.method==='POST') {
        const s=p.stakeholders.find(s=>s.id===body.stakeholderId);assert(s,'Select a stakeholder.',404);assert(s.status==='open','Reopen the interview before adding answers.');
        assert(p.messages.length<160,'Interview limit reached. Export this project and start a new focused project.');
        const m={id:uid('m-'),stakeholderId:s.id,role:'user',text:text(body.text,'Answer',10000),createdAt:now(),mode:settings.mode};
        // Stage the answer; commit atomically with validated extraction only.
        p.messages.push(m);locks.add(p.id);
        try {
          const retrievalQuery=`${s.role} ${m.text} ${FACTORS.filter(f=>!p.factors[f.id]).map(f=>f.label).join(' ')}`;
          const refs=await rag.search(retrievalQuery,4);
          let ex;let actualModel='deterministic-demo';let usage=null;
          if(settings.mode==='demo') ex=demoExtract(p,s.id,m);
          else {
            const result=await complete({...settings},interviewPrompt(),{project:{name:p.name,description:p.description,domain:p.domain,jurisdiction:p.jurisdiction},stakeholder:s,latestAnswer:m,transcript:p.messages.filter(x=>x.stakeholderId===s.id).slice(-16),otherStakeholderEvidence:p.messages.filter(x=>x.role==='user'&&x.stakeholderId!==s.id),requirements:p.requirements,factors:p.factors,openConflicts:p.conflicts.filter(c=>c.status!=='resolved'),missingFactors:FACTORS.filter(f=>!p.factors[f.id]),references:refs},fetchImpl);
            ex=validateExtraction(result.output,p,s.id,m);actualModel=result.model;usage=result.usage;
          }
          for(const r of ex.requirements) {
            if(!CATEGORIES.includes(r.category)) r.category='Functional';
            if(!p.requirements.some(x=>x.statement.toLowerCase()===r.statement.toLowerCase()))p.requirements.push({...r,id:`REQ-${String(p.requirements.length+1).padStart(3,'0')}`,createdAt:now()});
          }
          // Conflicting factor estimates remain visible instead of replacing prior evidence silently.
          for(const [id,f] of Object.entries(ex.factors)) {
            const prev=p.factors[id];
            if(prev && Math.abs(prev.value-f.value)>=2) p.conflicts.push({id:uid('c-'),description:`${FACTORS.find(x=>x.id===id).label}: previous score ${prev.value}/5 conflicts with new estimate ${f.value}/5. ${f.reason}`,sourceIds:[...new Set([...prev.sourceIds,...f.sourceIds])],status:'open'});
            else if(prev?.status!=='confirmed') p.factors[id]=f;
          }
          for(const c of ex.conflicts) if(!p.conflicts.some(x=>x.description===c.description))p.conflicts.push({...c,id:uid('c-')});
          p.messages.push({id:uid('m-'),stakeholderId:s.id,role:'assistant',text:ex.reply,createdAt:now(),mode:settings.mode,model:actualModel,usage,referenceIds:refs.map(r=>r.id),retrieval:{query:retrievalQuery,passages:refs}});
          const saved=store.save(p,'interview.answer',m.id);
          locks.delete(p.id);
          return send(view(saved));
        }finally{locks.delete(p.id);}
      }
      if(resource==='requirements'&&parts[4]==='confirm'&&req.method==='POST') {
        assert(p.requirements.some(r=>r.status==='proposed'),'There are no proposed requirements to confirm.');
        for(const r of p.requirements)if(r.status==='proposed'){r.status='confirmed';r.updatedAt=now();}
        return send(view(store.save(p,'requirements.confirmed')));
      }
      if(resource==='requirements'&&parts[4]&&req.method==='PATCH') {
        const r=p.requirements.find(r=>r.id===parts[4]);assert(r,'Requirement not found.',404);
        const {history:oldHistory,...previous}=structuredClone(r);
        r.history=[...(oldHistory||[]),{...previous,replacedAt:now()}];
        if(body.statement!==undefined) {r.statement=text(body.statement,'Requirement',1500);r.status='proposed';}
        if(body.category!==undefined) {assert(CATEGORIES.includes(body.category),'Invalid category.');r.category=body.category;}
        if(body.priority!==undefined) {assert(['Must','Should','Could'].includes(body.priority),'Invalid priority.');r.priority=body.priority;}
        if(body.acceptanceCriteria!==undefined) {assert(typeof body.acceptanceCriteria==='string'&&body.acceptanceCriteria.length<=1500,'Invalid acceptance criteria.');r.acceptanceCriteria=body.acceptanceCriteria;}
        if(body.status!==undefined) {assert(['proposed','confirmed','rejected'].includes(body.status),'Invalid status.');r.status=body.status;}
        r.updatedAt=now();
        return send(view(store.save(p,'requirement.updated',r.id)));
      }
      if(resource==='factors'&&parts[4]&&req.method==='PUT') {
        assert(FACTORS.some(f=>f.id===parts[4]),'Unknown decision factor.');assert(Number.isInteger(body.value)&&body.value>=1&&body.value<=5,'Score must be 1–5.');
        p.factors[parts[4]]={value:body.value,reason:text(body.reason,'Reason',1500),sourceIds:sourceList(p,body.sourceIds),status:'confirmed'};
        return send(view(store.save(p,'factor.confirmed',parts[4])));
      }
      if(resource==='conflicts'&&parts[4]&&req.method==='PATCH') {
        const c=p.conflicts.find(c=>c.id===parts[4]);assert(c,'Conflict not found.',404);c.resolution=text(body.resolution,'Resolution',2000);c.status='resolved';c.resolvedAt=now();
        return send(view(store.save(p,'conflict.resolved',c.id)));
      }
      if(resource==='knowledge'&&req.method==='POST') {
        assert(p.knowledge.length<60,'Maximum 60 knowledge entries per project.');
        const source=typeof body.source==='string'?body.source.trim():'';assert(!source||/^https?:\/\//i.test(source),'Source must be an HTTP(S) URL or empty.');
        p.knowledge.push({id:uid('ref-'),title:text(body.title,'Title',150),text:text(body.text,'Reference text',12000),source:source.slice(0,1000),kind:'Project reference',version:body.version?text(body.version,'Version',150):'User supplied',addedAt:now()});
        return send(view(store.save(p,'knowledge.added')),201);
      }
      if(resource==='knowledge'&&parts[4]&&req.method==='DELETE') {
        assert(p.knowledge.some(r=>r.id===parts[4]),'Reference not found.',404);p.knowledge=p.knowledge.filter(r=>r.id!==parts[4]);return send(view(store.save(p,'knowledge.removed',parts[4])));
      }
      if(resource==='search'&&req.method==='POST') return send(await rag.search(text(body.query,'Search query',1000),5));
      if(resource==='analyses'&&req.method==='POST') {
        const ready=readiness(p);assert(ready.ready||body.provisional===true,'Project is not ready. Resolve the listed gaps or explicitly request provisional analysis.',409);
        assert(settings.mode!=='live'||settings.apiKey,'Add an OpenRouter API key in Settings.',400);
        assert(p.messages.some(m=>m.role==='user'),'Collect stakeholder evidence before analysis.');
        const snapshot=structuredClone(p);delete snapshot.analyses;
        const query=`SDLC lifecycle agile spiral waterfall V-Model risk security assurance ${p.description} ${p.requirements.map(r=>r.statement).join(' ')}`;
        const refs=await rag.search(query,6);
        // Retrieval can take a moment; re-check after awaiting before acquiring the write lock.
        unlocked(p.id);assert(store.get(p.id).revision===p.revision,'Project changed during retrieval. Retry analysis.',409);
        const a={id:uid('a-'),createdAt:now(),status:'running',mode:settings.mode,model:settings.model,provisional:!ready.ready,snapshotHash:snapshotHash(p),snapshot,readiness:ready,decision:rank(p),references:refs,rag:{...rag.status(),query},agents:[]};
        p.analyses.push(a);store.save(p,'analysis.started',a.id);locks.add(p.id);
        void runAnalysis(snapshot,a.id,{...settings});return send(view(store.get(p.id)),202);
      }
    }
    if(req.method==='GET'&&!url.pathname.startsWith('/api/')) {
      const files={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css','/favicon.svg':'favicon.svg'};
      const filename=files[url.pathname];assert(filename,'Not found.',404);
      const content=await readFile(join(root,'public',filename));const types={html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml'};
      res.writeHead(200,{'Content-Type':`${types[filename.split('.').at(-1)]}; charset=utf-8`});return res.end(content);
    }
    throw new HttpError(404,'Endpoint not found.');
  }
  const server=http.createServer((req,res)=>{
    route(req,res).catch(error=>{
      if(res.headersSent){res.end();return;}
      res.writeHead(error.status||500,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      res.end(JSON.stringify({error:error.status?error.message:'An unexpected server error occurred. Your saved project remains available.'}));
    });
  });
  return {server,store,settings};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const app=createApplication();
  const port=Number(process.env.PORT)||3000;
  app.server.listen(port,'127.0.0.1',()=>console.log(`Requirements Engine running at http://localhost:${port} · ${app.settings.mode} mode`));
  app.server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} is in use. Set PORT in .env to choose another port.`:'Server could not start.');process.exitCode=1;app.store.close();});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.server.close(()=>{app.store.close();process.exit(0);}));
}
