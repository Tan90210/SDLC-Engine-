export const FACTORS = [
  { id: 'stability', label: 'Requirement stability', question: 'How stable are the requirements? What is likely to change, and how frequently?', low: 'Evolving frequently', high: 'Stable and agreed' },
  { id: 'risk', label: 'Failure consequences', question: 'What are the business, financial, security, or safety consequences of failure?', low: 'Low impact', high: 'Severe impact' },
  { id: 'uncertainty', label: 'Technical uncertainty', question: 'Which technologies, integrations, or business assumptions are unproven?', low: 'Well understood', high: 'Highly uncertain' },
  { id: 'assurance', label: 'Verification and approvals', question: 'What testing, traceability, audit evidence, and formal approvals are required before release?', low: 'Lightweight validation', high: 'Formal verification gates' },
  { id: 'feedback', label: 'Stakeholder availability', question: 'How often can stakeholders review increments and make decisions?', low: 'Rarely available', high: 'Frequent collaboration' },
  { id: 'delivery', label: 'Incremental delivery', question: 'Can the system be released in small increments? What release deadlines or external dependencies apply?', low: 'Single constrained release', high: 'Frequent incremental releases' },
  { id: 'capability', label: 'Team capability', question: 'What experience, team capacity, automated testing, and delivery infrastructure are available?', low: 'Limited delivery capability', high: 'Mature delivery capability' },
  { id: 'constraints', label: 'Dependencies and constraints', question: 'What fixed budget, schedule, legacy systems, vendor contracts, or approval dependencies constrain delivery?', low: 'Few constraints', high: 'Many fixed constraints' }
];

export const CATEGORIES = ['Business', 'Functional', 'Security', 'Privacy', 'Compliance', 'Performance', 'Availability', 'Integration', 'Auditability', 'Operational', 'Usability', 'Data'];
export const ROLES = ['Business / product owner', 'Customers / end users', 'Software architects / developers', 'Security / privacy', 'Compliance / legal', 'Operations', 'Risk / audit'];

export const AGENTS = [
  { id: 'requirements', name: 'Requirements reviewer', focus: 'Assess requirement stability, testability, completeness, contradictions and unsupported assumptions.' },
  { id: 'risk', name: 'Risk and assurance analyst', focus: 'Assess technical uncertainty, failure consequences, security needs, evidence and approval gates. Do not make legal determinations.' },
  { id: 'delivery', name: 'Delivery analyst', focus: 'Assess stakeholder availability, increments, delivery constraints, dependencies and team capability.' },
  { id: 'review', name: 'Recommendation reviewer', focus: 'Challenge the preceding analyses and ranking. Identify unsupported claims, material missing information and conditions that would change the ranking.' }
];
