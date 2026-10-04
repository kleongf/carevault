import { ApiError } from './policy.ts';

export const profileLimits = {
  name: 120, dateOfBirth: 10, email: 254, phone: 60, address: 300,
  allergies: 2000, medications: 2000, conditions: 2000,
  accessibilityNeeds: 2000, emergencyContact: 300, carePreferences: 2000,
} as const;
export type ProfileFields = { -readonly [K in keyof typeof profileLimits]: string };
export interface PatientProfile {
  version: number; updatedAt: string | null; snapshotId: string | null; fields: ProfileFields;
}
export function initialProfile(): PatientProfile {
  return { version: 0, updatedAt: null, snapshotId: null, fields: {
    name: 'Alex Morgan', dateOfBirth: '', email: '', phone: '', address: '',
    allergies: '', medications: '', conditions: '', accessibilityNeeds: '', emergencyContact: '', carePreferences: '',
  } };
}
export function validateProfile(input: unknown, current: PatientProfile): ProfileFields {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'invalid_profile');
  const { version, fields } = input as Record<string, unknown>;
  if (!Number.isSafeInteger(version) || (version as number) < 0) throw new ApiError(400, 'invalid_profile_version');
  if (version !== current.version) throw new ApiError(409, 'profile_conflict', 'Profile changed. Reload before saving.');
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new ApiError(400, 'invalid_profile');
  const values = fields as Record<string, unknown>;
  if (Object.keys(values).length !== Object.keys(profileLimits).length || Object.keys(values).some(key => !Object.hasOwn(profileLimits, key))) throw new ApiError(400, 'invalid_profile');
  const result = {} as ProfileFields;
  for (const key of Object.keys(profileLimits) as (keyof ProfileFields)[]) {
    const value = values[key];
    if (typeof value !== 'string' || value.length > profileLimits[key] || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw new ApiError(400, 'invalid_profile_field', `Check ${key.replace(/([A-Z])/g, ' $1').toLowerCase()}.`);
    result[key] = value.trim();
  }
  if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw new ApiError(400, 'invalid_email', 'Enter a valid email address.');
  if (result.dateOfBirth) {
    const value = result.dateOfBirth, date = new Date(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || value > new Date().toISOString().slice(0, 10) || value < '1900-01-01') throw new ApiError(400, 'invalid_birth_date', 'Enter a valid birth date between 1900 and today.');
  }
  return result;
}
export function profileText(profile: PatientProfile): string {
  const labels: Record<keyof ProfileFields, string> = {
    name: 'Name', dateOfBirth: 'Date of birth', email: 'Email', phone: 'Phone', address: 'Address',
    allergies: 'Allergies', medications: 'Medications', conditions: 'Conditions',
    accessibilityNeeds: 'Accessibility needs', emergencyContact: 'Emergency contact', carePreferences: 'Care preferences',
  };
  return ['Patient profile — patient-reported, unverified', `Version: ${profile.version}`, `Updated: ${profile.updatedAt}`,
    'Blank or omitted information is unknown, not a negative finding.', '',
    ...Object.entries(labels).map(([key, label]) => `${label}: ${profile.fields[key as keyof ProfileFields] || 'Not entered'}`),
  ].join('\n');
}
