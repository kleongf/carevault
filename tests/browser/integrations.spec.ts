import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Real shipped HTML/CSS/JS; every network response is mocked. These tests do not
// exercise Python, CareVault authorization, classifiers, OCR, or model providers.
type App = 'medicine' | 'xray';
type Call = { path: string; method: string; authorization?: string; requestedWith?: string; body: unknown };
const origin = 'http://integration.test';
const username = 'browser-fixture';
const password = 'synthetic-test-password';
const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
const report = 'Synthetic discussion <img src=x onerror="window.injected=true">';
const sharedText = 'Synthetic redacted note: [REDACTED]. Discuss this fictional example.';
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

async function mockedApp(page: Page, app: App) {
  const state = {
    calls: [] as Call[], blocked: [] as string[], empty: false,
    failure: null as null | { path: string; status: number; error: string },
  };
  const assets: Record<string, { file: string; contentType: string }> = {
    '/': { file: 'index.html', contentType: 'text/html' },
    '/app.js': { file: 'app.js', contentType: 'text/javascript' },
    '/style.css': { file: 'style.css', contentType: 'text/css' },
  };
  // Catch ALL requests: an accidental external URL must never reach a real app.
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) { state.blocked.push(request.url()); await route.abort(); return; }
    const asset = assets[url.pathname];
    if (asset) {
      await route.fulfill({ contentType: asset.contentType, body: await readFile(resolve(process.cwd(), `examples/${app}-app/${asset.file}`)) });
      return;
    }
    if (!url.pathname.startsWith('/api/')) { await route.fulfill({ status: 404 }); return; }
    const headers = request.headers();
    state.calls.push({ path: url.pathname + url.search, method: request.method(), authorization: headers.authorization,
      requestedWith: headers['x-requested-with'], body: request.postDataJSON() });
    const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (headers.authorization !== authorization) { await json({ error: 'sign_in_required' }, 401); return; }
    if (state.failure?.path === url.pathname) { await json({ error: state.failure.error }, state.failure.status); return; }
    if (url.pathname === '/api/session') { await json({ authenticated: true }); return; }
    if (url.pathname === '/api/records') {
      await json({ records: state.empty ? [] : app === 'medicine'
        ? [{ id: 'fixture-note', kind: 'document' }, { id: 'fixture-report', kind: 'report' }]
        : [{ id: 'fixture-image', variants: ['redacted', 'original'] }, { id: 'fixture-image-two', variants: ['redacted'] }] });
      return;
    }
    if (url.pathname === '/api/context') { await json({ context: [{ recordId: 'fixture-note', text: sharedText }] }); return; }
    if (url.pathname === '/api/image') { await route.fulfill({ contentType: 'image/png', body: image }); return; }
    if (url.pathname === '/api/analyze') { await json({ draftId: 'fixture-draft', report }); return; }
    if (url.pathname === '/api/save') { await json({ reportId: 'fixture-saved-report' }); return; }
    state.blocked.push(request.url()); await route.fulfill({ status: 404 });
  });
  await page.goto(origin);
  return state;
}

async function signIn(page: Page, app: App, suppliedPassword = password) {
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(suppliedPassword);
  // Exercise native form submission with the keyboard, not a JS event dispatch.
  await page.getByLabel('Password', { exact: true }).press('Enter');
  if (suppliedPassword === password) {
    await expect(page.locator('#workspace')).toBeVisible();
    if (app === 'medicine') await expect(page.locator('#records input')).toHaveCount(2);
    else await expect(page.locator('#image option')).toHaveCount(2);
  }
}

async function selectContext(page: Page, app: App) {
  if (app === 'medicine') await page.locator('#records input').first().check();
  else await page.getByLabel('Image', { exact: true }).selectOption('fixture-image');
}

for (const app of ['medicine', 'xray'] as const) {
  test.describe(`${app} frontend — mocked APIs`, () => {
    test('bad login, successful login, logout and reload keep private state out of storage', async ({ page }) => {
      const state = await mockedApp(page, app);
      expect(state.calls).toHaveLength(0);
      await expect(page.locator('#workspace')).toBeHidden();
      await signIn(page, app, 'deliberately-wrong');
      await expect(page.locator(app === 'medicine' ? '#status' : '#login-error')).toContainText(/username or password/i);
      await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
      await expect(page.locator('#workspace')).toBeHidden();
      await signIn(page, app);
      await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
      await selectContext(page, app);
      await page.locator(app === 'medicine' ? '#generate' : '#analyze').click();
      await expect(page.locator('#report')).toHaveText(report);
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await expect(page.locator('#workspace')).toBeHidden();
      await expect(page.locator('#report')).toBeEmpty();
      if (app === 'medicine') await expect(page.locator('#context')).toBeEmpty();
      else await expect(page.locator('#preview')).not.toHaveAttribute('src');
      await expect(page.getByLabel('Username', { exact: true })).toBeFocused();
      expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
      const previousCalls = state.calls.length;
      await page.reload();
      await expect(page.locator('#workspace')).toBeHidden();
      expect(state.calls).toHaveLength(previousCalls);
      expect(state.blocked).toEqual([]);
    });

    test('selected context previews, escaped drafts, explicit save and narrow-screen layout', async ({ page }, info) => {
      const state = await mockedApp(page, app);
      await signIn(page, app);
      await page.getByLabel('About and data usage', { exact: true }).click();
      await expect(page.locator('#data-usage')).toHaveAttribute('open', '');
      await expect(page.locator('#data-usage')).toContainText('OpenRouter');
      await page.getByLabel('About and data usage', { exact: true }).click();
      await page.screenshot({ path: info.outputPath(`${app}-workspace.png`), fullPage: true });
      await selectContext(page, app);
      if (app === 'medicine') {
        await page.locator('#preview').click();
        await expect(page.getByRole('dialog', { name: 'Shared text' })).toBeVisible();
        await expect(page.locator('#context')).toContainText(sharedText);
        expect(state.calls.find(call => call.path === '/api/context')?.body).toEqual({ recordIds: ['fixture-note'] });
      } else {
        await page.getByLabel('Shared version').selectOption('original');
        await expect(page.locator('#preview')).toBeVisible();
        await expect.poll(() => page.locator('#preview').evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
        expect(state.calls.some(call => call.path === '/api/image?id=fixture-image&variant=original')).toBe(true);
      }
      await page.locator(app === 'medicine' ? '#generate' : '#analyze').click();
      await expect(page.locator('#report')).toHaveText(report);
      await expect(page.locator('#report img')).toHaveCount(0);
      expect(state.calls.find(call => call.path === '/api/analyze')?.body).toEqual(app === 'medicine'
        ? { recordIds: ['fixture-note'] } : { recordId: 'fixture-image', variant: 'original' });
      expect(state.calls.filter(call => call.path === '/api/save')).toHaveLength(0);
      await page.locator('#save').click();
      await expect(page.locator('#status')).toContainText(/saved to carevault/i);
      expect(state.calls.find(call => call.path === '/api/save')?.body).toEqual({ draftId: 'fixture-draft' });
      expect(state.calls.every(call => call.authorization === authorization && call.requestedWith === 'CareVaultDemo')).toBe(true);
      expect(state.blocked).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    });

    test('permission errors hide inaccessible previews and a 401 clears the private workspace', async ({ page }) => {
      const state = await mockedApp(page, app);
      await signIn(page, app); await selectContext(page, app);
      await page.locator(app === 'medicine' ? '#generate' : '#analyze').click();
      await expect(page.locator('#report')).toHaveText(report);
      if (app === 'medicine') {
        state.failure = { path: '/api/context', status: 403, error: 'record_not_shared' };
        await page.locator('#preview').click();
        await expect(page.locator('#status')).toContainText('no longer shared');
        await expect(page.getByRole('dialog', { name: 'Shared text' })).toBeHidden();
        await expect(page.locator('#report')).toBeEmpty();
        await expect(page.locator('#save')).toBeDisabled();
      } else {
        state.failure = { path: '/api/image', status: 403, error: 'image_not_shared' };
        await page.getByLabel('Shared version').selectOption('original');
        await expect(page.locator('#status')).toContainText('no longer shared');
        await expect(page.locator('#preview')).toBeHidden();
        await expect(page.locator('#report')).toBeEmpty();
      }
      state.failure = { path: '/api/records', status: 401, error: 'sign_in_required' };
      await page.locator('#refresh').click();
      await expect(page.locator('#workspace')).toBeHidden();
      await expect(page.locator('#report')).toBeEmpty();
      expect(state.blocked).toEqual([]);
    });

    test('empty grants offer no generation and provider errors never create a savable draft', async ({ page }) => {
      const state = await mockedApp(page, app);
      await signIn(page, app);
      state.empty = true;
      await page.locator('#refresh').click();
      await expect(page.locator(app === 'medicine' ? '#generate' : '#analyze')).toBeDisabled();
      if (app === 'medicine') await expect(page.locator('#records')).toContainText('No shared records');
      else await expect(page.locator('#image')).toContainText('No images shared');
      state.empty = false;
      await page.locator('#refresh').click();
      await selectContext(page, app);
      state.failure = { path: '/api/analyze', status: 503, error: 'selected_model_not_available_free' };
      await page.locator(app === 'medicine' ? '#generate' : '#analyze').click();
      await expect(page.locator('#status')).toContainText('no longer free');
      await expect(page.locator(app === 'medicine' ? '#report-actions' : '#result')).toBeHidden();
      expect(state.calls.some(call => call.path === '/api/save')).toBe(false);
      expect(state.blocked).toEqual([]);
    });
  });
}
