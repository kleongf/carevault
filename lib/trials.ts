import type { ReleasedItem, TrialMatch } from './types.ts';

type Rule = 'adult' | 'reported-cough' | 'san-diego' | 'swallowing-need' | 'fact-present' | 'afternoon';
interface Criterion { id: string; label: string; factId: string; rule: Rule; }
interface Study {
  studyId: string; title: string; sponsor: string; summary: string;
  criteria: Criterion[]; requestFactId?: string;
}

const studies: Study[] = [
  {
    studyId: 'community-respiratory-diary', title: 'Community Respiratory Diary', sponsor: 'Care Research Network',
    summary: 'A synthetic observational study about recording respiratory symptoms.',
    criteria: [
      { id: 'adult', label: 'Age 18 or older', factId: 'age', rule: 'adult' },
      { id: 'cough', label: 'Reports a cough', factId: 'symptom', rule: 'reported-cough' },
      { id: 'location', label: 'Located in San Diego', factId: 'city', rule: 'san-diego' },
    ]
  },
  {
    studyId: 'medication-routine-interviews', title: 'Medication Routine Interviews', sponsor: 'Community Health Studies',
    summary: 'A synthetic interview study about medication routines and administration needs.',
    criteria: [
      { id: 'adult', label: 'Age 18 or older', factId: 'age', rule: 'adult' },
      { id: 'administration', label: 'Has a reported administration need', factId: 'swallowing', rule: 'swallowing-need' },
      { id: 'medication', label: 'Medication information available', factId: 'medication', rule: 'fact-present' },
    ],
    requestFactId: 'medication'
  },
  {
    studyId: 'afternoon-access-interviews', title: 'Afternoon Care Access Interviews', sponsor: 'Patient Access Lab',
    summary: 'A synthetic study about scheduling preferences and access to care.',
    criteria: [
      { id: 'location', label: 'Located in San Diego', factId: 'city', rule: 'san-diego' },
      { id: 'availability', label: 'Prefers afternoon appointments', factId: 'availability', rule: 'afternoon' },
    ]
  }
];

function check(rule: Rule, value: string): boolean {
  const normalized = value.toLowerCase();
  if (rule === 'adult') return Number(value) >= 18;
  if (rule === 'reported-cough') return normalized.includes('cough');
  if (rule === 'san-diego') return normalized.includes('san diego');
  if (rule === 'swallowing-need') return normalized.includes('difficulty swallowing');
  if (rule === 'afternoon') return normalized.includes('afternoon');
  return value.trim().length > 0;
}

export function evaluateTrials(items: ReleasedItem[]): TrialMatch[] {
  const shared = new Map(items.filter(item => item.disclosure === 'shared').map(item => [item.id, item.value]));
  return studies.map(study => {
    const criteria = study.criteria.map(criterion => {
      const value = shared.get(criterion.factId);
      return { id: criterion.id, label: criterion.label, status: value === undefined ? 'unknown' as const : check(criterion.rule, value) ? 'met' as const : 'not_met' as const };
    });
    const unresolvedCount = criteria.filter(criterion => criterion.status === 'unknown').length;
    return {
      studyId: study.studyId, title: study.title, sponsor: study.sponsor, summary: study.summary,
      status: criteria.some(criterion => criterion.status === 'not_met') ? 'not_potential' : 'potential',
      criteria, unresolvedCount,
      additionalFactRequestAvailable: Boolean(study.requestFactId && criteria.some(criterion => criterion.status === 'unknown' && criterion.id === 'medication'))
    };
  });
}

export function requestedFactForStudy(studyId: string): string | undefined {
  return studies.find(study => study.studyId === studyId)?.requestFactId;
}