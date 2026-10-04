import { test, expect, type Page } from '@playwright/test';

const password = 'Browser-test-only-2026';
async function login(page: Page, username = 'patient') {
  await page.goto('/');
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  // Keep console runtime failures distinct from intentional 401/403 test responses.
});
test.afterEach(async ({ page }) => { expect(pageErrors.get(page)).toEqual([]); });

test('login errors, role navigation, sign-out and session invalidation', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Username', { exact: true }).fill('patient');
  await page.getByLabel('Password', { exact: true }).fill('incorrect');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Incorrect username or password' })).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  await login(page);
  await fits(page);
  await expect(page.getByRole('navigation')).not.toContainText('API setup');
  expect((await page.request.get('/api/developer/apps')).status()).toBe(403);
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect((await page.request.get('/api/patient/dashboard')).status()).toBe(401);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
});

test('record search, PDF paging, keyboard tabs, downloads, image and processing states', async ({ page }, info) => {
  await login(page);
  const search = page.getByRole('textbox', { name: 'Search records' });
  await search.fill('no-such-record');
  await expect(page.getByText('No matching records')).toBeVisible();
  await search.fill('Synthetic visit');
  const opener = page.getByRole('button', { name: /Synthetic visit.pdf/ });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('.record-source summary').click();
  await expect(dialog.getByText('Synthetic browser fixture; not a patient record.')).toBeVisible();
  await dialog.locator('.record-source summary').click();
  await expect(dialog.getByRole('img', { name: 'PDF page 1', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: /Next/ }).click();
  await expect(dialog.getByText('Page 2 of 2')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Next/ })).toBeDisabled();
  await dialog.getByRole('button', { name: /Previous/ }).click();
  await expect(dialog.getByText('Page 1 of 2')).toBeVisible();
  await dialog.getByRole('tab', { name: 'Original', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('tab', { name: 'Extracted text' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.locator('pre')).toContainText('Synthetic Person reports a cough.');
  await dialog.getByRole('tab', { name: 'Redacted copy' }).click();
  await expect(dialog.getByRole('img', { name: 'PDF page 1', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Next page' })).toBeEnabled();
  await expect(dialog.getByText('Rendering…', { exact: true })).toHaveCount(0);
  expect(await dialog.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    return data.some((value, index) => index % 4 === 0 && value < 128 && data[index + 3] > 0);
  })).toBe(true);
  await dialog.getByLabel('Redaction details', { exact: true }).click();
  await expect(dialog.getByText('Automatic redaction may miss identifiers.')).toBeVisible();
  await dialog.getByLabel('Redaction details', { exact: true }).click();
  const download = page.waitForEvent('download');
  await dialog.getByRole('link', { name: /Download redacted/ }).click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
  await fits(page);
  await page.screenshot({ path: info.outputPath('record-preview.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await search.fill('Synthetic image');
  await page.getByRole('button', { name: /Synthetic image.png/ }).click();
  await expect(dialog.getByRole('img', { name: 'Original Synthetic image.png', exact: true })).toBeVisible();
  expect(await dialog.getByRole('img', { name: 'Original Synthetic image.png', exact: true }).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await dialog.getByRole('tab', { name: 'Redacted copy' }).click();
  await expect(dialog.getByRole('img', { name: /Redacted/ })).toBeVisible();
  await page.keyboard.press('Escape');
  for (const [title, status] of [['Failed scan', 'Processing failed'], ['Waiting scan', 'Waiting to process']]) {
    await search.fill(title);
    await page.getByRole('button', { name: new RegExp(title) }).click();
    await dialog.getByRole('tab', { name: 'Redacted copy' }).click();
    await expect(dialog.getByRole('heading', { name: status })).toBeVisible();
    await expect(dialog.getByRole('link', { name: /Download redacted/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
});

test('upload validation, preset, persistence and dialog cancellation', async ({ page }, info) => {
  await login(page);
  const opener = page.getByRole('button', { name: 'Upload', exact: true });
  await opener.click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(opener).toBeFocused();
  await opener.click(); dialog = page.getByRole('dialog');
  await dialog.getByLabel('Record file').setInputFiles({ name: 'invalid.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') });
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByLabel('Record file').setInputFiles({ name: 'oversized.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(20 * 1024 * 1024 + 1) });
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('smaller than 20 MB');
  await dialog.getByLabel('Redaction preset').selectOption('healthcare');
  const title = `Uploaded ${info.project.name}.pdf`;
  await dialog.getByLabel('Record file').setInputFiles({ name: title, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nsynthetic queued fixture') });
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: new RegExp(title) })).toContainText('Waiting');
  await page.reload();
  await expect(page.getByRole('button', { name: new RegExp(title) })).toBeVisible();
  const dashboard = await (await page.request.get('/api/patient/dashboard')).json();
  expect(dashboard.records.find((record: { title: string }) => record.title === title).profile).toBe('healthcare');
});

test('record grants persist, constrain real API reads, accept private reports and revoke access', async ({ page, playwright }, info) => {
  const developer = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3140', extraHTTPHeaders: { Origin: 'http://127.0.0.1:3140' } });
  await developer.post('/api/session', { data: { username: 'developer', password } });
  const { apps } = await (await developer.get('/api/developer/apps')).json();
  const app = apps.find((item: { name: string }) => item.name === `Browser Review ${info.project.name}`);
  const { token } = await (await developer.post(`/api/developer/apps/${app.id}/credential`, { data: {} })).json();
  const external = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3140', extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
  try {
    await login(page);
    const dashboard = await (await page.request.get('/api/patient/dashboard')).json();
    const record = dashboard.records.find((item: { title: string }) => item.title === 'Synthetic visit.pdf');
    await page.getByRole('button', { name: 'Apps', exact: true }).click();
    const card = page.locator('.integration-card').filter({ has: page.getByRole('heading', { name: app.name, exact: true }) });
    await card.getByLabel(`About ${app.name}`, { exact: true }).click();
    await expect(card.getByText('Synthetic browser test integration.')).toBeVisible();
    await card.getByLabel(`About ${app.name}`, { exact: true }).click();
    await page.screenshot({ path: info.outputPath('patient-apps.png'), fullPage: true });
    await card.getByRole('button', { name: 'Connect', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Synthetic visit.pdf: text', { exact: true }).check();
    await dialog.getByLabel('Allow report writes', { exact: true }).check();
    await dialog.getByRole('button', { name: 'Save access' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(card.getByText('Connected', { exact: true })).toBeVisible();
    await expect(card.getByRole('link', { name: /Open app/ })).toHaveAttribute('href', 'https://example.test/');
    await card.getByRole('button', { name: 'Manage access' }).click(); dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Synthetic visit.pdf: text', { exact: true })).toBeChecked();
    await expect(dialog.getByLabel('Synthetic visit.pdf: original', { exact: true })).not.toBeChecked();
    await fits(page);
    await dialog.getByLabel('Synthetic visit.pdf: redacted', { exact: true }).check();
    await dialog.getByLabel('Synthetic visit.pdf: original', { exact: true }).check();
    await dialog.getByRole('button', { name: 'Save access' }).click();
    await expect(dialog).toHaveCount(0);
    expect((await external.get(`/api/v2/records/${record.id}/files/redacted`)).status()).toBe(200);
    expect((await external.get(`/api/v2/records/${record.id}/files/original`)).status()).toBe(200);
    await card.getByRole('button', { name: 'Manage access' }).click();
    await dialog.getByLabel('Synthetic visit.pdf: redacted', { exact: true }).uncheck();
    await dialog.getByLabel('Synthetic visit.pdf: original', { exact: true }).uncheck();
    await dialog.getByRole('button', { name: 'Save access' }).click();
    await expect(dialog).toHaveCount(0);
    const released = await external.get(`/api/v2/records/${record.id}/text`);
    expect(released.ok()).toBe(true);
    expect(await released.text()).toContain('[REDACTED]');
    expect((await external.get(`/api/v2/records/${record.id}/files/original`)).status()).toBe(403);
    const written = await external.post('/api/v2/reports', { data: { title: `Browser report ${info.project.name}`, body: 'Unverified synthetic report.', sourceReceiptIds: [released.headers()['x-carevault-receipt']] } });
    expect(written.status()).toBe(201);
    const { records } = await (await external.get('/api/v2/records')).json();
    expect(records.length).toBe(1);
    await card.getByRole('button', { name: 'Manage access' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Disconnect all access' }).click();
    await expect(card.getByText('Not connected', { exact: true })).toBeVisible();
    expect((await external.get(`/api/v2/records/${record.id}/text`)).status()).toBe(403);
    await page.getByRole('button', { name: 'Records', exact: true }).click();
    await expect(page.getByRole('button', { name: new RegExp(`Browser report ${info.project.name}`) })).toBeVisible();
  } finally { await developer.dispose(); await external.dispose(); }
});

test('patient can retry a failed initial dashboard request', async ({ page }) => {
  let failed = false;
  await page.route('**/api/patient/dashboard', async route => {
    if (!failed) { failed = true; await route.fulfill({ status: 503, json: { message: 'Temporary connection failure.' } }); }
    else await route.continue();
  });
  await login(page);
  await expect(page.getByRole('alert').filter({ hasText: 'Temporary connection failure' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: /Synthetic visit.pdf/ })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Temporary connection failure' })).toHaveCount(0);
});

test('developer registration, URL validation, edit, credential reveal/rotation/revoke and API setup', async ({ page, playwright }, info) => {
  await login(page, 'developer');
  expect((await page.request.get('/api/patient/dashboard')).status()).toBe(403);
  const opener = page.getByRole('button', { name: 'New app', exact: true });
  await opener.click();
  let dialog = page.getByRole('dialog');
  const name = `Created ${info.project.name}`;
  await dialog.getByLabel('App name', { exact: true }).fill(name);
  await dialog.getByLabel('Description', { exact: true }).fill('Browser-created integration.');
  await dialog.getByLabel('App URL', { exact: true }).fill('http://unsafe.example/');
  await dialog.getByLabel('Read redacted text', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Save app', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Use HTTPS');
  await dialog.getByLabel('App URL', { exact: true }).fill('https://example.test/app');
  await dialog.getByRole('button', { name: 'Save app', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await page.getByRole('button', { name: `Edit ${name}`, exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Read redacted text', { exact: true })).toBeChecked();
  await dialog.getByLabel('Description', { exact: true }).fill('Edited browser integration.');
  await dialog.getByRole('button', { name: 'Save app', exact: true }).click();
  const manage = page.getByRole('button', { name: `Manage credentials for ${name}`, exact: true });
  await manage.click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Issue credential', exact: true }).click();
  const input = dialog.getByLabel('New credential', { exact: true });
  await expect(input).toHaveAttribute('type', 'password');
  const first = await input.inputValue();
  expect(first.length > 20).toBe(true);
  await dialog.getByRole('button', { name: 'Reveal credential' }).click();
  await expect(input).toHaveAttribute('type', 'text');
  await dialog.getByRole('button', { name: 'Hide credential' }).click();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(manage).toBeFocused();
  await manage.click();
  await expect(dialog.getByLabel('New credential')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Rotate credential' }).click();
  const rotated = await dialog.getByLabel('New credential').inputValue();
  expect(rotated !== first).toBe(true);
  const external = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3140' });
  try {
    expect((await external.get('/api/v2/records', { headers: { Authorization: `Bearer ${first}` } })).status()).toBe(401);
    expect((await external.get('/api/v2/records', { headers: { Authorization: `Bearer ${rotated}` } })).status()).toBe(403);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await manage.click();
    await dialog.getByRole('button', { name: 'Revoke', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Issue credential' })).toBeVisible();
    expect((await external.get('/api/v2/records', { headers: { Authorization: `Bearer ${rotated}` } })).status()).toBe(401);
  } finally { await external.dispose(); }
  await dialog.getByRole('button', { name: 'Close', exact: true }).filter({ hasText: 'Close' }).first().click();
  await page.getByRole('button', { name: 'API setup', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Write a report' })).toBeVisible();
  for (const title of ['Server setup', 'Read records', 'Write a report']) {
    const section = page.locator('.api-details').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    await section.locator('summary').click();
    await expect(section.locator('pre').first()).toBeVisible();
    await fits(page);
    await section.locator('summary').click();
  }
  await fits(page);
  await page.screenshot({ path: info.outputPath('developer-setup.png') });
  await page.goto('/trials');
  await expect(page.getByRole('heading', { name: 'Patient account required' })).toBeVisible();
});

test('Trial Explorer permissions, preview, single-use approval, denial and revocation', async ({ page }, info) => {
  await login(page);
  await page.getByRole('button', { name: 'Apps', exact: true }).click();
  await page.locator('.integration-card').filter({ has: page.getByRole('heading', { name: 'Trial Explorer', exact: true }) }).getByRole('link', { name: /Open app/ }).click();
  await expect(page).toHaveURL(/\/trials$/);
  await page.getByRole('button', { name: /Connect app|Manage access/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Permission help', { exact: true }).click();
  await expect(dialog.getByText(/Share reveals the value/)).toBeVisible();
  await dialog.getByLabel('Permission help', { exact: true }).click();
  await dialog.getByLabel('Read memory').check();
  await dialog.getByRole('group', { name: 'Medications access', exact: true }).getByRole('button', { name: 'Private', exact: true }).click();
  await dialog.getByRole('button', { name: 'Preview access' }).click();
  await expect(dialog.locator('.context-preview')).toBeVisible();
  await dialog.getByRole('button', { name: /^(Connect app|Save permissions)$/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.trial-card')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Manage access' })).toBeFocused();
  await page.getByRole('button', { name: 'Refresh matches' }).click();
  await page.getByRole('button', { name: 'Request one fact' }).click();
  await page.getByRole('button', { name: 'Approve one use' }).click();
  await page.getByRole('button', { name: 'Use approved fact once' }).click();
  await expect(page.getByText('One-time fact used', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use approved fact once' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Request one fact' }).click();
  await page.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve one use' })).toHaveCount(0);
  await expect(page.getByText('No access granted', { exact: true }).last()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await fits(page);
  await page.screenshot({ path: info.outputPath('trials.png') });
  await page.getByRole('button', { name: 'Manage access' }).click();
  await dialog.getByRole('button', { name: 'Revoke access' }).click();
  await expect(page.locator('.trial-card')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect app' })).toBeFocused();
  await page.getByRole('link', { name: 'CareVault', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Records' })).toBeVisible();
});
