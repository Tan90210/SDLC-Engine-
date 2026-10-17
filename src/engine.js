import { createHash } from 'node:crypto';
import { FACTORS } from './catalog.js';

const tokenize = text => text.toLowerCase().match(/[a-z0-9]{3,}/g) || [];
const stop = new Set(['the','and','that','with','for','are','this','from','what','how','can','our','should','will','have']);
export function retrieve(knowledge, query, count = 4) {
  const terms = [...new Set(tokenize(query).filter(t => !stop.has(t)))];
  const docs = knowledge.map(d => ({ ...d, tokens: tokenize(d.title + ' ' + d.text) }));
  const avg = docs.reduce((s,d) => s + d.tokens.length,0) / (docs.length || 1);
  const documentFrequencies=new Map();
  for(const d of docs)for(const token of new Set(d.tokens))documentFrequencies.set(token,(documentFrequencies.get(token)||0)+1);
  return docs.map(d => {
    let score = 0;
    for (const t of terms) {
      const tf = d.tokens.filter(w => w === t).length;
      const df = documentFrequencies.get(t)||0;
      const idf = Math.log(1 + (docs.length - df + .5)/(df + .5));
      score += idf * tf * 2.2 / (tf + 1.2 * (.25 + .75 * d.tokens.length/(avg || 1)));
    }
    const { tokens, ...result } = d;
    return { ...result, retrievalScore: Math.round(score * 100)/100 };
  }).filter(d => d.retrievalScore > 0).sort((a,b) => b.retrievalScore-a.retrievalScore).slice(0,count);
}

export function readiness(project) {
  const accepted = project.requirements.filter(r => r.status === 'confirmed');
  const factors = FACTORS.map(f => ({ ...f, known: Boolean(project.factors[f.id]?.sourceIds?.length), value: project.factors[f.id]?.value ?? null }));
  const unresolved = project.conflicts.filter(c => c.status !== 'resolved');
  const missing = factors.filter(f => !f.known);
  const blockers = [];
  if (!project.stakeholders.length) blockers.push('Select at least one stakeholder.');
  const pending = project.stakeholders.filter(s => s.status !== 'complete' && s.status !== 'omitted');
  if (pending.length) blockers.push(`${pending.length} stakeholder interview(s) still open.`);
  if (!accepted.length) blockers.push('Confirm at least one source-linked requirement.');
  if (missing.length) blockers.push(`Evidence missing for: ${missing.map(f=>f.label).join(', ')}.`);
  if (unresolved.length) blockers.push(`${unresolved.length} unresolved conflict(s).`);
  const coverage = Math.round((factors.length-missing.length)/factors.length*100);
  return { ready: !blockers.length, coverage, factors, blockers, confirmed: accepted.length, proposed: project.requirements.filter(r=>r.status==='proposed').length, unresolved: unresolved.length };
}

// Source checks apply to every model write; retrieval cannot create project evidence.
export function validateExtraction(raw, project, stakeholderId, message) {
  if (!raw || typeof raw !== 'object' || typeof raw.reply !== 'string') throw new Error('The model returned an invalid interview response. Try again or choose another free model.');
  const ids = new Set(project.messages.filter(m=>m.role==='user').map(m=>m.id));
  const requirements = (Array.isArray(raw.requirements) ? raw.requirements : []).slice(0,12).flatMap(r => {
    if (typeof r.statement !== 'string' || r.statement.length < 8) return [];
    const quote = typeof r.quote === 'string' ? r.quote.trim() : '';
    if (!quote || !message.text.toLowerCase().includes(quote.toLowerCase())) return [];
    return [{ statement: r.statement.slice(0,1500), category: typeof r.category==='string' ? r.category : 'Functional',
      acceptanceCriteria: typeof r.acceptanceCriteria==='string' ? r.acceptanceCriteria.slice(0,1500) : '',
      quote, sourceIds: [message.id], stakeholderId, status: 'proposed', priority: ['Must','Should','Could'].includes(r.priority) ? r.priority : 'Should' }];
  });
  const factors = {};
  for (const f of FACTORS) {
    const v = raw.factors?.[f.id];
    if (!v || !Number.isInteger(v.value) || v.value < 1 || v.value > 5 || typeof v.reason !== 'string') continue;
    const quote = typeof v.quote === 'string' ? v.quote.trim() : '';
    if (!quote || !message.text.toLowerCase().includes(quote.toLowerCase())) continue;
    factors[f.id] = { value: v.value, reason: v.reason.slice(0,1000), quote, sourceIds: [message.id], status: 'inferred' };
  }
  const conflicts = (Array.isArray(raw.conflicts) ? raw.conflicts : []).slice(0,8).flatMap(c => {
    if (typeof c.description!=='string' || !Array.isArray(c.sourceIds)) return [];
    const sources = [...new Set(c.sourceIds)].filter(id => ids.has(id));
    return sources.length >= 2 ? [{ description: c.description.slice(0,1500), sourceIds: sources, status: 'open' }] : [];
  });
  return { reply: raw.reply.slice(0,5000), requirements, factors, conflicts };
}

const candidates = [
  { id: 'agile', name: 'Agile / incremental', ideal: [1,2,2,2,5,5,4,2], guidanceDocuments: ['scrum-guide','nist-ssdf'], tradeoff: 'Needs timely feedback, disciplined testing and useful release increments.' },
  { id: 'spiral', name: 'Spiral / risk-driven', ideal: [2,5,5,4,4,3,4,3], guidanceDocuments: ['sei-spiral','nist-ssdf'], tradeoff: 'Adds risk-analysis effort; each cycle must retire a specific risk.' },
  { id: 'vmodel', name: 'V-Model', ideal: [5,5,2,5,2,2,3,5], guidanceDocuments: ['nasa-handbook','nist-ssdf'], tradeoff: 'Strong specification-to-test traceability; changes can require substantial rework.' },
  { id: 'waterfall', name: 'Waterfall / sequential', ideal: [5,3,1,4,1,1,3,5], guidanceDocuments: ['nasa-handbook','sei-spiral'], tradeoff: 'Fits agreed phase boundaries; late feedback is costly when assumptions are wrong.' },
  { id: 'hybrid', name: 'Incremental + assurance gates', ideal: [2,5,3,5,4,4,4,4], guidanceDocuments: ['scrum-guide','nasa-handbook','nist-ssdf'], tradeoff: 'Requires explicit gate owners and evidence, with care to avoid excessive process overhead.' }
];
export const WEIGHTS = [1.3,1.4,1.3,1.4,1,1.1,.7,.8];
function score(ideal, values) {
  const total = WEIGHTS.reduce((a,b)=>a+b,0);
  return Math.round(100 * WEIGHTS.reduce((sum,w,i)=>sum+w*(1-Math.abs(values[i]-ideal[i])/4),0)/total);
}
export function rank(project) {
  const values = FACTORS.map(f=>project.factors[f.id]?.value ?? 3);
  const rankings = candidates.map(c => ({ ...c, score: score(c.ideal,values), breakdown: FACTORS.map((f,i)=>({ factor:f.id, label:f.label, value:values[i], unknown:!project.factors[f.id]?.sourceIds?.length, ideal:c.ideal[i], weight:WEIGHTS[i], sourceIds:project.factors[f.id]?.sourceIds || [] })) })).sort((a,b)=>b.score-a.score);
  const changes = [];
  for (let i=0; i<FACTORS.length; i++) {
    for (const value of [1,5]) {
      const scenario = [...values]; scenario[i] = value;
      const best = candidates.map(c=>({ name:c.name, score:score(c.ideal,scenario) })).sort((a,b)=>b.score-a.score)[0];
      if (best.name !== rankings[0].name) changes.push({ factor:FACTORS[i].label, value, winner:best.name });
    }
  }
  return { rankings, sensitivity:changes, rubricVersion:'1.0', warning:'Suitability scores are heuristic rubric scores, not probabilities. Rubric requires independent expert validation.', securityPractices:['Threat modelling and security requirements','Automated security checks where feasible','Vulnerability response and release evidence'] };
}
export function snapshotHash(project) {
  return createHash('sha256').update(JSON.stringify({ requirements:project.requirements, factors:project.factors, conflicts:project.conflicts, messages:project.messages, knowledge:project.knowledge, stakeholders:project.stakeholders })).digest('hex');
}
export function demoExtract(project, stakeholderId, message) {
  const text = message.text;
  const lower = text.toLowerCase();
  const factors = {};
  const patterns = {
    stability: [/stable|fixed scope|change|evolv/i, /stable|fixed scope/i.test(text)?5:2],
    risk: [/risk|fraud|loss|failure|critical|financial/i, /critical|severe|loss|fraud/i.test(text)?5:3],
    uncertainty: [/uncertain|unproven|prototype|integration|technical|legacy/i, /uncertain|unproven|prototype/i.test(text)?5:3],
    assurance: [/audit|approval|verif|compliance|regulat|test/i, /audit|approval|compliance|regulat/i.test(text)?5:3],
    feedback: [/stakeholder|feedback|review|weekly|daily/i, /weekly|daily|frequent/i.test(text)?5:3],
    delivery: [/release|increment|deploy|deadline|delivery/i, /increment|weekly|frequent/i.test(text)?5:3],
    capability: [/team|automat|experience|capacity|pipeline/i, /automat|experienced|mature/i.test(text)?4:3],
    constraints: [/budget|schedule|legacy|vendor|dependenc|deadline/i, /fixed|legacy|vendor/i.test(text)?4:3]
  };
  for(const [key,[pattern,value]] of Object.entries(patterns)) if(pattern.test(text)) factors[key]={value,reason:'Demo keyword heuristic; review the score before relying on it.',quote:text.slice(0,160),sourceIds:[message.id],status:'inferred'};
  const missing = FACTORS.find(f=>!factors[f.id] && !project.factors[f.id]);
  return { reply: `Recorded your answer and proposed source-linked requirements. ${missing ? missing.question : 'The decision factors have evidence. Review proposed requirements, verify the factor scores, and mark completed interviews before analysis.'}`,
    requirements:text.split(/\n|(?<=[.!?])\s+/).filter(s=>s.trim().length>15).slice(0,6).map(statement=>({statement:statement.trim().slice(0,1500),category:/audit|trace/i.test(statement)?'Auditability':/latency|second|volume/i.test(statement)?'Performance':/auth|secur/i.test(statement)?'Security':'Functional',quote:statement.trim().slice(0,160),sourceIds:[message.id],stakeholderId,status:'proposed',priority:'Should',acceptanceCriteria:''})), factors,conflicts:[] };
}
