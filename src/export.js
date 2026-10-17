export function report(project, analysis) {
  const lines = [`# ${project.name}`, '', project.description, '', `Domain: ${project.domain} · Jurisdiction: ${project.jurisdiction}`, '', '## Requirements', ''];
  for (const r of project.requirements) lines.push(`### ${r.id} — ${r.status}`,r.statement,`Category: ${r.category} · Priority: ${r.priority}`,`Evidence: ${r.sourceIds.join(', ')}`,`Quote: ${r.quote || ''}`,`Acceptance criteria: ${r.acceptanceCriteria || 'Not yet specified'}`,'');
  lines.push('## Decision factors','');
  for (const [id,f] of Object.entries(project.factors)) lines.push(`- ${id}: ${f.value}/5 — ${f.reason} [${f.sourceIds.join(', ')}]`);
  lines.push('','## Open conflicts','');
  for(const c of project.conflicts.filter(c=>c.status!=='resolved')) lines.push(`- ${c.description} [${c.sourceIds.join(', ')}]`);
  if (analysis) {
    lines.push('','## SDLC analysis',`Mode: ${analysis.mode} · Created: ${analysis.createdAt} · Status: ${analysis.status}`,`Snapshot: ${analysis.snapshotHash}`,`Provisional: ${analysis.provisional ? 'yes' : 'no'}`,'',analysis.decision.warning,'');
    for (const c of analysis.decision.rankings) lines.push(`- ${c.name}: ${c.score}/100. ${c.tradeoff}`);
    for(const a of analysis.agents) {
      lines.push('',`### ${a.name}`,a.summary||a.error||'Pending');
      for(const f of a.findings||[]) {lines.push(`- ${f.text} [${[...f.sourceIds,...f.referenceIds].join(', ')}]`);if(f.referenceQuote)lines.push(`  PDF quote: ${f.referenceQuote}`);}
      if(a.recommendation) lines.push('',a.recommendation);
    }
    lines.push('','## Reference snapshot','');
    for (const r of analysis.references) lines.push(`- ${r.id}: ${r.title}${r.page?`, PDF page ${r.page}`:''}. ${r.version}. ${r.source||'Project-authored rubric'}`);
    if(analysis.rag)lines.push('',`Retrieval: ${analysis.rag.method}. Embedding model: ${analysis.rag.model}. Indexed passages: ${analysis.rag.chunkCount}.`);
  }
  lines.push('','## Interview evidence','');
  for(const m of project.messages) lines.push(`### ${m.id} · ${m.role} · ${m.createdAt}`,m.text,'');
  return lines.join('\n');
}
const cell = value => '"'+String(value??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
export function requirementsCSV(project) {
  return [['ID','Statement','Category','Priority','Status','Acceptance criteria','Stakeholder ID','Message IDs','Evidence quote'],...project.requirements.map(r=>[r.id,r.statement,r.category,r.priority,r.status,r.acceptanceCriteria,r.stakeholderId,r.sourceIds.join('; '),r.quote])].map(row=>row.map(cell).join(',')).join('\r\n');
}
