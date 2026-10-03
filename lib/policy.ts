import { categories, scopes } from './types.ts';
import type { Category, Disclosure, Grant, MemoryItem, ReleasedItem, Scope, Segment } from './types.ts';

export class ApiError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message = code.replaceAll('_', ' ')) {
    super(message); this.status = status; this.code = code;
  }
}
const rank: Record<Disclosure, number> = { share: 0, redact: 1, private: 2 };
export function stricter(...modes: Disclosure[]): Disclosure {
  return modes.reduce((a, b) => rank[a] >= rank[b] ? a : b, 'share');
}
export function validateGrant(input: unknown, validIds: Set<string>): Grant {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'invalid_grant');
  const g = input as Grant;
  if (typeof g.connected !== 'boolean' || !Array.isArray(g.scopes) || g.scopes.length > scopes.length || !g.scopes.every(s => scopes.includes(s))) throw new ApiError(400, 'invalid_scopes');
  if (!g.categories || typeof g.categories !== 'object' || categories.some(c => !['share', 'redact', 'private'].includes(g.categories[c]))) throw new ApiError(400, 'invalid_categories');
  if (!g.overrides || typeof g.overrides !== 'object' || Array.isArray(g.overrides) || Object.keys(g.overrides).length > 100) throw new ApiError(400, 'invalid_overrides');
  for (const [id, mode] of Object.entries(g.overrides)) {
    if (!validIds.has(id) || !['share', 'redact', 'private'].includes(mode)) throw new ApiError(400, 'invalid_override');
  }
  return { connected: g.connected, scopes: [...new Set(g.scopes)], categories: Object.fromEntries(categories.map(c => [c, g.categories[c]])) as Record<Category, Disclosure>, overrides: { ...g.overrides }, version: 1 };
}
export function authorize(grant: Grant, scope: Scope): void {
  if (!grant.connected || !grant.scopes.includes(scope)) throw new ApiError(403, 'access_not_authorized');
}
export function project(memories: MemoryItem[], grant: Grant, patientId: string): ReleasedItem[] {
  const map = new Map(memories.filter(m => m.patientId === patientId).map(m => [m.id, m]));
  function segmentMode(segment: Segment, path = new Set<string>()): Disclosure {
    let result = grant.categories[segment.category] ?? 'private';
    for (const id of segment.parentIds ?? []) {
      const parent = map.get(id);
      if (!parent) return 'private';
      result = stricter(result, mode(parent, path));
    }
    return result;
  }
  function mode(item: MemoryItem, path = new Set<string>()): Disclosure {
    if (path.has(item.id) || item.pendingReview || !item.sourceIds.length) return 'private';
    const next = new Set(path).add(item.id);
    let result = stricter(item.restriction, grant.categories[item.category] ?? 'private', grant.overrides[item.id] ?? 'share');
    for (const id of item.parentIds) {
      const parent = map.get(id);
      if (!parent) return 'private';
      result = stricter(result, mode(parent, next), ...(parent.segments ?? []).map(s => segmentMode(s, next)));
    }
    return result;
  }
  const out: ReleasedItem[] = [];
  for (const item of map.values()) {
    const disclosure = mode(item);
    if (disclosure === 'private') continue;
    if (disclosure === 'redact') {
      // Clinical labels and arbitrary report titles can themselves reveal protected information.
      if (item.category === 'mental_health' || item.kind === 'report' || item.kind === 'summary') continue;
      out.push({ id: item.id, version: item.version, field: item.label, disclosure: 'redacted', value: '[REDACTED]' });
      continue;
    }
    const parts = item.segments?.map(s => {
      const state = segmentMode(s, new Set([item.id]));
      return state === 'private' || (state === 'redact' && s.category === 'mental_health') ? '' : state === 'redact' ? '[REDACTED] ' : s.text;
    });
    const value = parts ? parts.join('').trim() : item.value;
    if (!value) continue;
    // Never expose source titles, authors, or unfiltered source snippets to integrations.
    out.push({ id: item.id, version: item.version, field: item.label, disclosure: 'shared', value, verification: item.verification, sourceRefs: [...item.sourceIds] });
  }
  return out;
}
