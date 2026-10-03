import type { Category, Disclosure, Grant, Integration, MemoryItem, Source } from './types.ts';
import { categories } from './types.ts';

export const patient = { id: 'patient-demo-001', name: 'Alex Morgan', initials: 'AM', subtitle: 'Your personal health memory · synthetic patient' };
const createdAt = '2026-10-03T09:30:00.000Z';
export function defaultGrant(): Grant {
  const modes = Object.fromEntries(categories.map(c => [c, 'private'])) as Record<Category, Disclosure>;
  Object.assign(modes, { identity: 'redact', demographics: 'share', symptoms: 'share', preferences: 'share', notes: 'share', reports: 'share' });
  return { connected: false, scopes: ['facts:read', 'reports:create'], categories: modes, overrides: {}, version: 1 };
}
export function integrations(): Integration[] {
  return [
    { id: 'care-assistant', name: 'Health companion', publisher: 'CareVault · live AI demo', description: 'Ask questions about the health context you choose to share.', track: 'Personal health assistant', icon: 'chat', grant: { ...defaultGrant(), scopes: ['facts:read'] } },
    { id: 'scan-review', name: 'Scan Review', publisher: 'Imaging team · demo slot', description: 'An imaging workflow that requests only the context it needs.', track: 'Swarm-powered diagnostics', icon: 'scan', grant: defaultGrant() },
    { id: 'trial-explorer', name: 'Trial Explorer', publisher: 'Research team · demo slot', description: 'Discover research opportunities using an authorized patient profile.', track: 'AI-powered clinical trials', icon: 'flask', grant: defaultGrant() },
    { id: 'formulation-review', name: 'Formulation Review', publisher: 'Pharmacy team · demo slot', description: 'Prepare a source-linked formulation review for a pharmacist.', track: 'Personalized medicine', icon: 'pill', grant: defaultGrant() }
  ];
}
function fact(id: string, category: Category, label: string, value: string, extras: Partial<MemoryItem> = {}): MemoryItem {
  return { id, patientId: patient.id, kind: 'fact', category, label, value, sourceIds: ['source-intake'], parentIds: [], verification: 'patient_reported', author: 'Alex Morgan', createdAt, version: 1, restriction: 'share', ...extras };
}
export function memories(): MemoryItem[] {
  return [
    fact('name', 'identity', 'Preferred name', 'Alex Morgan'),
    fact('email', 'identity', 'Email address', 'alex.morgan@example.test'),
    fact('phone', 'identity', 'Phone number', '+1 202-555-0148'),
    fact('address', 'identity', 'Street address', '100 Example Lane, San Diego'),
    fact('age', 'demographics', 'Age', '34'),
    fact('city', 'demographics', 'City', 'San Diego'),
    fact('symptom', 'symptoms', 'Reported symptom', 'Intermittent cough for two weeks', { sourceIds: ['source-visit'] }),
    fact('swallowing', 'symptoms', 'Administration need', 'Difficulty swallowing large tablets'),
    fact('medication', 'medications', 'Medication record', 'Medication A — illustrative prescription only', { verification: 'source_extracted', sourceIds: ['source-scan'] }),
    fact('allergy', 'allergies', 'Ingredient restriction', 'Patient reports a peanut allergy; requires clinical confirmation'),
    fact('availability', 'preferences', 'Appointment preference', 'Tuesday and Thursday afternoons'),
    fact('language', 'preferences', 'Preferred language', 'English'),
    fact('contact', 'preferences', 'Contact preference', 'Secure portal messages'),
    fact('mental-note', 'mental_health', 'Private health note', 'Patient reports anxiety before appointments', { sourceIds: ['source-visit'] }),
    fact('visit-note', 'notes', 'Visit note', 'Alex Morgan reports intermittent cough. Contact: alex.morgan@example.test. Patient reports anxiety before appointments. Afternoon visits are preferred.', {
      kind: 'note', verification: 'source_extracted', sourceIds: ['source-visit'], author: 'Prepared extraction',
      segments: [
        { text: 'Patient: Alex Morgan. Contact: alex.morgan@example.test. ', category: 'identity', parentIds: ['name', 'email'] },
        { text: 'Reports intermittent cough. ', category: 'symptoms', parentIds: ['symptom'] },
        { text: 'Patient reports anxiety before appointments. ', category: 'mental_health', parentIds: ['mental-note'] },
        { text: 'Afternoon visits are preferred.', category: 'preferences', parentIds: ['availability'] }
      ]
    }),
    fact('visit-summary', 'notes', 'Derived visit summary', 'Afternoon visits may suit the patient, who reports anxiety before appointments.', {
      kind: 'summary', parentIds: ['mental-note', 'availability'], sourceIds: ['source-visit'], verification: 'prepared_summary', author: 'Prepared memory example'
    }),
    fact('lab-status', 'symptoms', 'Lab report status', 'A synthetic lab report is available for review; no clinical conclusion is inferred.', { sourceIds: ['source-lab'], verification: 'source_extracted' }),
    fact('image-status', 'notes', 'Image record status', 'De-identified image slot prepared for the imaging team; analysis is not implemented.', { sourceIds: ['source-image'], verification: 'prepared_example' }),
    fact('other-patient', 'identity', 'Other patient record', 'Isolation test — never part of Alex’s vault', { patientId: 'patient-demo-002', sourceIds: ['source-other'] })
  ];
}
export const sources: Source[] = [
  { id: 'source-intake', title: 'Patient intake', type: 'Structured record', status: 'prepared', itemIds: ['name', 'email', 'phone', 'address', 'age', 'city', 'availability', 'language', 'contact', 'allergy', 'swallowing'], rendition: true },
  { id: 'source-visit', title: 'Visit summary', type: 'Text note', status: 'prepared', itemIds: ['visit-note'], rendition: true },
  { id: 'source-lab', title: 'Lab report', type: 'PDF example', status: 'prepared', itemIds: ['lab-status'], rendition: false },
  { id: 'source-scan', title: 'Prescription scan', type: 'Scanned document example', status: 'prepared', itemIds: ['medication'], rendition: false },
  { id: 'source-image', title: 'Imaging study', type: 'Medical image slot', status: 'prepared', itemIds: ['image-status'], rendition: false }
];
