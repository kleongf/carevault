export const categories = ['identity', 'demographics', 'symptoms', 'medications', 'allergies', 'preferences', 'mental_health', 'notes', 'reports'] as const;
export type Category = typeof categories[number];
export type Disclosure = 'share' | 'redact' | 'private';
export const categoryLabels: Record<Category, string> = {
  identity: 'Identity & contact', demographics: 'Demographics', symptoms: 'Symptoms & history',
  medications: 'Medications', allergies: 'Allergies', preferences: 'Care preferences',
  mental_health: 'Mental health', notes: 'Clinical notes', reports: 'Integration reports'
};
export const scopes = ['facts:read', 'files:download', 'reports:create'] as const;
export type Scope = typeof scopes[number];
export interface Grant {
  connected: boolean; scopes: Scope[]; categories: Record<Category, Disclosure>;
  overrides: Record<string, Disclosure>; version: number;
}
export interface Integration {
  id: string; name: string; publisher: string; description: string;
  developerId?: string; appUrl?: string; capabilities?: ('text:read' | 'files:redacted' | 'files:original' | 'reports:create')[];
  recordApiOnly?: boolean;
  track: string; icon: 'scan' | 'flask' | 'pill' | 'chat'; grant: Grant;
}
export interface Segment { text: string; category: Category; parentIds?: string[]; }
export interface MemoryItem {
  id: string; patientId: string; kind: 'fact' | 'note' | 'summary' | 'report';
  category: Category; label: string; value: string; sourceIds: string[];
  parentIds: string[]; verification: string; author: string; createdAt: string; version: number;
  restriction: Disclosure; segments?: Segment[]; pendingReview?: boolean;
}
export interface Source {
  id: string; title: string; type: string; status: 'prepared'; itemIds: string[];
  rendition: boolean;
}
export interface ReleasedItem {
  id: string; version: number; field: string; disclosure: 'shared' | 'redacted'; value: string;
  verification?: string; sourceRefs?: string[];
}
export interface ContextResponse { requestId?: string; policyVersion: number; items: ReleasedItem[]; }
export interface Activity {
  id: string; actor: string; operation: string; outcome: string; detail: string;
  at: string; policyVersion?: number; itemIds: string[];
}
export interface Dashboard {
  patient: { id: string; name: string; initials: string; subtitle: string };
  integrations: Integration[]; memories: MemoryItem[]; sources: Source[]; activity: Activity[];
}
