import { expect, test } from '@playwright/test';
import { NEW_PASSWORD, SEED_PASSWORD, addBeneficiary, createTenant, expectStatus, login, logout, unique, wizardToReview } from './helpers';

// Read-only checks use the seeded Acme Trading LLC tenant; flows that create payments make their own company.
const ADMIN = 'admin@acme.test';
const PLATFORM = 'platform.admin@paybridge.test';

test('the sandbox banner is on every page, signed in or not', async ({ page }) => {
  for (const path of ['/login', '/register']) {
    await page.goto(path);
    await expect(page.getByTestId('sandbox-banner')).toHaveText(/Educational Sandbox — No Real Money Movement/);
  }
  await login(page, ADMIN, SEED_PASSWORD);
  for (const path of ['/dashboard', '/payments', '/payments/new', '/beneficiaries', '/quotes', '/ledger', '/ledger/accounts', '/company', '/company/kyb', '/company/users', '/admin/audit-logs']) {
    await page.goto(path);
    await expect(page.getByTestId('sandbox-banner')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('error')).toHaveCount(0);
  }
});

test('an unauthenticated visitor is sent to sign in, and roles see only what they may use', async ({ page }) => {
  await page.goto('/payments');
  await expect(page).toHaveURL(/\/login\?next=%2Fpayments/);

  await login(page, 'viewer@acme.test', SEED_PASSWORD);
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Payments', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'New payment' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Users' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Compliance queue' })).toHaveCount(0);
  await logout(page);

  await login(page, PLATFORM, SEED_PASSWORD);
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Reconciliation' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'New payment' })).toHaveCount(0);
  await page.goto('/admin/reconciliation');
  // The seeded mismatch and duplicate are reported.
  await expect(page.getByTestId('recon-MISMATCH')).toContainText('1');
  await expect(page.getByTestId('recon-DUPLICATE')).toContainText('1');
});

test('a payment over the threshold is held for compliance, then cleared and approved', async ({ page, request }) => {
  const tenant = await createTenant(request);
  await login(page, tenant.maker, NEW_PASSWORD);
  await addBeneficiary(page, 'Mumbai Supplies Pvt Ltd');
  await wizardToReview(page, 'Mumbai Supplies Pvt Ltd', '60000.00');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByTestId('compliance-preview')).toHaveAttribute('data-status', 'REVIEW');
  await page.getByRole('button', { name: 'Continue to review' }).click();
  await expect(page.getByTestId('estimated-status')).toContainText('Compliance review');
  await page.getByTestId('submit-payment').click();
  await expect(page.getByTestId('created-status')).toHaveAttribute('data-status', 'COMPLIANCE_REVIEW');
  const reference = (await page.getByTestId('payment-reference').textContent())!;
  await page.getByRole('link', { name: 'View payment' }).click();
  await expectStatus(page, 'COMPLIANCE_REVIEW');
  const url = page.url();
  await logout(page);

  await login(page, tenant.approver, NEW_PASSWORD);
  await page.goto(url);
  await page.getByTestId('approve-button').click();
  await page.getByTestId('confirm-action').click();
  await expect(page.getByTestId('approval-status')).toHaveAttribute('data-status', 'APPROVED');
  await expectStatus(page, 'COMPLIANCE_REVIEW'); // still held: the compliance gate is open
  await logout(page);

  await login(page, PLATFORM, SEED_PASSWORD);
  await page.goto('/admin/compliance');
  const row = page.getByTestId('compliance-queue').getByRole('row', { name: new RegExp(reference) });
  await row.getByRole('button', { name: 'Decide' }).click();
  await expect(page.getByTestId('compliance-clear')).toBeDisabled(); // a reason is required
  await page.getByLabel('Reason (required)').fill('Invoice and contract verified (test)');
  await page.getByTestId('compliance-clear').click();
  await expect(row).toHaveCount(0);
  await page.goto(url);
  await expectStatus(page, 'PAID', 45_000);
  await expect(page.getByTestId('compliance-status')).toHaveAttribute('data-status', 'CLEARED_BY_ADMIN');
});

test('a failed payout shows as failed and returns the money, fee included', async ({ page, request }) => {
  const tenant = await createTenant(request, '20000.00');
  await login(page, tenant.maker, NEW_PASSWORD);
  await addBeneficiary(page, 'Kolkata Textiles (TEST-FAIL)');
  await page.goto('/payments/new');
  const available = async () => (await page.getByTestId('wallet-available').getAttribute('data-value')) ?? '';
  await expect(page.getByTestId('wallet-available')).toBeVisible();
  const before = await available();
  expect(before).toBe('20000.00');

  await wizardToReview(page, 'Kolkata Textiles', '1500.00');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to review' }).click();
  await page.getByTestId('submit-payment').click();
  await page.getByRole('link', { name: 'View payment' }).click();
  await expectStatus(page, 'CREATED');
  const url = page.url();
  await logout(page);

  await login(page, tenant.approver, NEW_PASSWORD);
  // An approver cannot create payments, and cannot reach the wizard by typing its address either.
  await page.goto('/payments/new');
  await expect(page.getByTestId('access-denied')).toBeVisible();
  await page.goto(url);
  await page.getByTestId('approve-button').click();
  await page.getByTestId('confirm-action').click();
  await expectStatus(page, 'FAILED', 45_000);
  await expect(page.getByText('The payout failed')).toBeVisible();
  await expect(page.getByTestId('ledger-transaction').last()).toHaveAttribute('data-type', 'PAYMENT_REVERSAL');
  await logout(page);

  await login(page, tenant.maker, NEW_PASSWORD);
  await page.goto('/payments/new');
  await expect.poll(available).toBe(before);
});

test('an expired quote cannot be submitted; a fresh quote can', async ({ page, request }) => {
  test.setTimeout(180_000);
  const tenant = await createTenant(request);
  await login(page, tenant.maker, NEW_PASSWORD);
  const name = `Expiry Check ${unique()}`;
  await addBeneficiary(page, name);
  await wizardToReview(page, name, '250.00');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to review' }).click();
  await expect(page.getByTestId('submit-payment')).toBeEnabled();

  // Let the 60-second lock run out.
  await expect(page.getByTestId('quote-expired')).toBeVisible({ timeout: 75_000 });
  await expect(page.getByTestId('submit-payment')).toBeDisabled();

  await page.getByRole('button', { name: /Get a new quote/ }).click();
  await expect(page.getByTestId('quote-countdown')).toHaveAttribute('data-seconds', /^(5\d|60)$/);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to review' }).click();
  // Double click: the idempotency key makes this one payment.
  await page.getByTestId('submit-payment').dblclick();
  await expect(page.getByTestId('payment-created')).toBeVisible();
  const reference = (await page.getByTestId('payment-reference').textContent())!;
  await page.goto('/payments');
  await expect(page.getByTestId('payments-table').getByRole('link', { name: reference })).toHaveCount(1);
});
