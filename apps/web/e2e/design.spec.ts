import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { SEED_PASSWORD, login } from './helpers';

const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

/** Accessibility: no serious or critical WCAG A/AA violations. */
const expectAccessible = async (page: Page) => {
  // Let entrance animations finish: a half-faded element would be measured as low contrast.
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking.map((v) => `${v.id}: ${v.nodes.length} × ${v.nodes[0]?.target}`)).toEqual([]);
};

test.describe('landing page', () => {
  test('explains the product and leads to the sandbox, with no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.getByTestId('sandbox-banner')).toContainText('Educational Sandbox — No Real Money Movement');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Cross-Border Payments');
    for (const id of ['how-it-works', 'features', 'lifecycle', 'dashboard', 'security']) await expect(page.locator(`#${id}`)).toBeAttached();
    await noOverflow(page);

    // Navigation scrolls to its section.
    await page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('link', { name: 'Features' }).click();
    await expect(page.locator('#features')).toBeInViewport();

    // The lifecycle timeline shows the matching detail for the step in focus.
    await page.getByRole('button', { name: /Quote created/ }).hover();
    await expect(page.getByRole('heading', { name: 'FX quote', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Compliance cleared/ }).focus();
    await expect(page.getByRole('heading', { name: 'Compliance checks' })).toBeVisible();

    // Footer links resolve.
    await page.getByRole('contentinfo').getByRole('link', { name: 'Documentation' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Using the sandbox' })).toBeVisible();
    await page.goto('/legal#privacy');
    await expect(page.getByRole('heading', { name: 'Privacy', exact: true })).toBeVisible();

    // Primary call to action.
    await page.goto('/');
    await page.getByRole('main').getByRole('link', { name: 'Enter sandbox' }).first().click();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('is accessible', async ({ page }) => {
    await page.goto('/');
    await expectAccessible(page);
  });

  for (const [name, width, height] of [['mobile', 390, 844], ['tablet', 820, 1180]] as const) {
    test(`fits a ${name} screen and offers a menu`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      for (const path of ['/', '/docs', '/legal', '/login', '/register']) {
        await page.goto(path);
        await noOverflow(page);
      }
      await page.goto('/');
      if (width < 768) {
        await page.getByRole('button', { name: 'Open menu' }).click();
        await page.getByRole('navigation', { name: 'Primary mobile' }).getByRole('link', { name: 'Security' }).click();
        await expect(page.locator('#security')).toBeInViewport();
        await expect(page.getByRole('navigation', { name: 'Primary mobile' })).toHaveCount(0);
      }
    });
  }
});

test.describe('sign-in', () => {
  test('validates, reports a failed sign-in clearly, and recovers', async ({ page }) => {
    await page.goto('/login');
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText('Enter your email address')).toBeVisible();
    await expect(page.getByText('Enter your password')).toBeVisible();

    await page.getByLabel('Email address').fill('maker@acme.test');
    await page.getByLabel('Password').fill('definitely-the-wrong-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const error = page.getByTestId('error');
    await expect(error).toContainText('Unable to sign in.');
    await expect(error).toContainText('Please check your email and password.');
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();

    await page.getByLabel('Password').fill(SEED_PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText('Signed in.')).toBeVisible();
    await expect(page.getByTestId('user-name')).toBeVisible();
  });

  test('the demo account button opens the sandbox in one step', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Continue with demo account' }).click();
    await expect(page.getByTestId('user-role')).toHaveText('Maker');
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  });
});

test.describe('application', () => {
  test('dashboard is accessible and usable on a phone', async ({ page }) => {
    await login(page, 'maker@acme.test', SEED_PASSWORD);
    await expect(page.getByTestId('stat-balance')).toBeVisible();
    await expectAccessible(page);

    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ['/dashboard', '/payments', '/payments/new', '/beneficiaries', '/quotes', '/company/kyb']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await noOverflow(page);
    }
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Payments', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Payments' })).toBeVisible();
  });

  test('shows a clear error state with a retry when data cannot be loaded', async ({ page }) => {
    await login(page, 'maker@acme.test', SEED_PASSWORD);
    await page.route('**/api/v1/payments?**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' }, requestId: 'req_test' }) }));
    await page.goto('/payments');
    await expect(page.getByText('Something went wrong')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('An unexpected error occurred.')).toBeVisible();
    await page.unroute('**/api/v1/payments?**');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('payments-table')).toBeVisible();
  });
});
