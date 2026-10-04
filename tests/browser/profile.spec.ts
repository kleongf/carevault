import { test, expect, type Page } from '@playwright/test';
import type { PatientProfile } from '../../lib/profile';

// Uses only the disposable Playwright vault and real HTTP routes. No OCR worker
// runs in this harness; new profile snapshots intentionally remain queued.
const origin = 'http://127.0.0.1:3140';
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Username', { exact: true }).fill('patient');
  await page.getByLabel('Password', { exact: true }).fill('Browser-test-only-2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
}
async function profile(page: Page): Promise<PatientProfile> {
  const response = await page.request.get('/api/patient/profile');
  expect(response.ok()).toBe(true);
  return response.json();
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('patient profile saves all sections, updates identity and requires explicit app sharing', async ({ page }, info) => {
  await login(page);
  const before = await profile(page);
  await expect(page.getByRole('table', { name: 'Basics', exact: true }).getByRole('row')).toHaveCount(5);
  await expect(page.getByRole('table', { name: 'Critical information', exact: true }).getByRole('row')).toHaveCount(3);
  await expect(page.getByRole('table', { name: 'Care preferences', exact: true }).getByRole('row')).toHaveCount(3);
  const fields = {
    name: `Jamie ${info.project.name}`, dateOfBirth: '1992-04-18', email: 'jamie@example.test',
    phone: '202-555-0199', address: '10 Fictional Lane', allergies: 'Patient-reported peanut allergy',
    medications: 'Example medication, patient reported', conditions: 'Example condition, unverified',
    accessibilityNeeds: 'Large print', emergencyContact: 'Taylor, 202-555-0188', carePreferences: 'Written instructions',
  };
  for (const [label, value] of [
    ['Name', fields.name], ['Date of birth', fields.dateOfBirth], ['Email', fields.email],
    ['Phone', fields.phone], ['Address', fields.address], ['Allergies', fields.allergies],
    ['Medications', fields.medications], ['Conditions', fields.conditions],
    ['Accessibility needs', fields.accessibilityNeeds], ['Emergency contact', fields.emergencyContact],
    ['Care preferences', fields.carePreferences],
  ]) await page.getByLabel(label, { exact: true }).and(page.locator('input, textarea')).fill(value);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  const saved = await profile(page);
  expect(saved.version).toBe(before.version + 1);
  expect(saved.fields).toEqual(fields);
  expect(saved.snapshotId).toBeTruthy();
  await expect(page.locator('.patient strong')).toHaveText(fields.name);
  await expect(page.locator('.avatar')).toHaveText(info.project.name === 'desktop' ? 'JD' : 'JM');
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  await fits(page);
  await page.screenshot({ path: info.outputPath('patient-profile.png'), fullPage: true });
  await page.reload();
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(page.getByLabel('Allergies', { exact: true })).toHaveValue(fields.allergies);
  await page.getByRole('button', { name: 'Records', exact: true }).click();
  await expect(page.locator('.record-row').filter({ hasText: 'Patient profile' })).toHaveCount(0);
  const dashboard = await (await page.request.get('/api/patient/dashboard')).json();
  expect(dashboard.records.filter((record: { profileSnapshotVersion?: number }) => record.profileSnapshotVersion !== undefined)).toHaveLength(1);
  const app = dashboard.apps.find((item: { name: string }) => item.name === `Browser Review ${info.project.name}`);
  expect(app.recordGrant.records[saved.snapshotId!]).toBeUndefined();
  await page.getByRole('button', { name: 'Apps', exact: true }).click();
  const card = page.locator('.integration-card').filter({ has: page.getByRole('heading', { name: app.name, exact: true }) });
  await card.getByRole('button', { name: /^(Connect|Manage access)$/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Patient profile: text', { exact: true })).not.toBeChecked();
  await expect(dialog.getByLabel('Patient profile: original', { exact: true })).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('profile drafts survive navigation and polling; reset, queued previews and validation work', async ({ page }) => {
  await login(page);
  let saved = await profile(page);
  if (!saved.snapshotId) {
    const response = await page.request.put('/api/patient/profile', { headers: { Origin: origin }, data: { version: saved.version, fields: saved.fields } });
    expect(response.ok()).toBe(true);
    saved = await response.json();
    await page.reload();
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
  }
  await page.getByLabel('Name', { exact: true }).fill('Unsaved draft');
  await page.getByRole('button', { name: 'Apps', exact: true }).click();
  await page.waitForResponse(response => response.url().endsWith('/api/patient/dashboard') && response.ok());
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Unsaved draft');
  expect((await profile(page)).fields.name).toBe(saved.fields.name);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(saved.fields.name);
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  const preview = page.getByRole('button', { name: 'Preview snapshot', exact: true });
  await preview.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Patient profile', exact: true })).toBeVisible();
  await expect(dialog.locator('iframe')).toHaveAttribute('src', `/api/patient/records/${saved.snapshotId}/files/original`);
  await dialog.getByRole('tab', { name: 'Extracted text', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Waiting to process', exact: true })).toBeVisible();
  await dialog.getByRole('tab', { name: 'Redacted copy', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Waiting to process', exact: true })).toBeVisible();
  await expect(dialog.getByRole('link', { name: /Download redacted/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(preview).toBeFocused();
  await page.getByLabel('Date of birth', { exact: true }).fill('9999-01-01');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('.alert.error')).toContainText('Enter a valid birth date');
  await expect(page.getByLabel('Date of birth', { exact: true })).toHaveValue('9999-01-01');
  expect((await profile(page)).version).toBe(saved.version);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveAttribute('maxlength', '120');
  await expect(page.getByLabel('Allergies', { exact: true })).toHaveAttribute('placeholder', 'Not entered');
  await fits(page);
});

test('a second patient session cannot silently overwrite an unsaved profile draft', async ({ page, browser }) => {
  await login(page);
  const baseline = await profile(page);
  await page.getByRole('textbox', { name: 'Care preferences', exact: true }).fill('Unsaved local preference');
  const other = await browser.newContext({ baseURL: origin });
  try {
    const second = await other.newPage();
    await login(second);
    await second.getByRole('textbox', { name: 'Care preferences', exact: true }).fill(`Saved elsewhere ${baseline.version}`);
    await second.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(second.getByRole('status')).toHaveText('Saved.');
    await page.waitForResponse(response => response.url().endsWith('/api/patient/dashboard') && response.ok());
    await expect(page.getByRole('textbox', { name: 'Care preferences', exact: true })).toHaveValue('Unsaved local preference');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.locator('.alert.error')).toContainText('Profile changed. Reload before saving.');
    expect((await profile(page)).fields.carePreferences).toBe(`Saved elsewhere ${baseline.version}`);
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: 'Reload profile', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Care preferences', exact: true })).toHaveValue('Unsaved local preference');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Reload profile', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Care preferences', exact: true })).toHaveValue(`Saved elsewhere ${baseline.version}`);
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    await expect(page.locator('.alert.error')).toHaveCount(0);
  } finally { await other.close(); }
});
