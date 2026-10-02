import { expect, test } from '@playwright/test';
import { NEW_PASSWORD, PLATFORM_ADMIN, SEED_PASSWORD, addBeneficiary, expectStatus, login, logout, unique, wizardToReview } from './helpers';

/**
 * The demo scenario from the brief, end to end through the browser, across four logins:
 * register → company → KYB → approval → fund → beneficiary → quote → payment → approval → ledger →
 * provider → webhook → PAID → reconciliation MATCHED → admin inspection.
 */
test('demo scenario: onboarding to a reconciled payment', async ({ page }) => {
  const id = unique();
  const company = `Acme Trading ${id} LLC`;
  const admin = `admin-${id}@acme-e2e.test`;
  const maker = `maker-${id}@acme-e2e.test`;
  const approver = `approver-${id}@acme-e2e.test`;

  await test.step('1–2. Register as company admin and register the company', async () => {
    await page.goto('/register');
    await expect(page.getByTestId('sandbox-banner')).toContainText('No Real Money Movement');
    await page.getByLabel('Full name').fill('Aisha Khan');
    await page.getByLabel('Email').fill(admin);
    await page.getByLabel('Password', { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel('Confirm password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByRole('heading', { name: 'Register your company' })).toBeVisible();
    await page.getByLabel('Company name').fill(company);
    await page.getByLabel('Trade licence number').fill(`TEST-TL-${id}`);
    await page.getByLabel('Trade licence expiry').fill('2030-12-31');
    await page.getByLabel('Registration number').fill(`TEST-REG-${id}`);
    await page.getByLabel('Business type').fill('General Trading');
    await page.getByLabel('Registered address').fill('Test Tower, Dubai (fictional)');
    await page.getByLabel('Contact email').fill(`ops-${id}@acme-e2e.test`);
    await page.getByLabel('Contact phone').fill('+971500000000');
    await page.getByRole('button', { name: 'Register company' }).click();
  });

  await test.step('3. Submit KYB', async () => {
    await expect(page.getByRole('heading', { name: 'KYB — Know Your Business' })).toBeVisible();
    await expect(page.getByTestId('kyb-status')).toHaveAttribute('data-status', 'DRAFT');
    await page.getByRole('button', { name: 'Submit KYB' }).click();
    await expect(page.getByTestId('kyb-status')).toHaveAttribute('data-status', 'UNDER_REVIEW');
    await expect(page.getByText('Mock provider result')).toBeVisible();
    await logout(page);
  });

  await test.step('4. Platform admin approves KYB', async () => {
    await login(page, PLATFORM_ADMIN, SEED_PASSWORD);
    await page.goto('/admin/companies');
    const row = page.getByRole('row', { name: new RegExp(company) });
    await row.getByRole('button', { name: 'Review' }).click();
    await page.getByTestId('kyb-approve').click();
    await expect(row.locator('[data-status="APPROVED"]')).toBeVisible();
    await logout(page);
  });

  await test.step('Company admin funds the wallet and adds a maker and an approver', async () => {
    await login(page, admin, NEW_PASSWORD);
    await expect(page.getByTestId('kyb-status-header')).toHaveAttribute('data-status', 'APPROVED');
    await page.goto('/company');
    await page.getByLabel('Simulated top-up (AED)').fill('100000.00');
    await page.getByRole('button', { name: 'Add funds' }).click();
    await expect(page.getByText('100,000.00').first()).toBeVisible();

    await page.goto('/company/users');
    for (const [email, name, role] of [[maker, 'Omar Maker', 'MAKER'], [approver, 'Layla Approver', 'APPROVER']] as const) {
      await page.getByRole('button', { name: 'Add user' }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Full name').fill(name);
      await dialog.getByLabel('Email').fill(email);
      await dialog.getByLabel('Role').selectOption(role);
      await dialog.getByLabel('Initial password').fill(NEW_PASSWORD);
      await dialog.getByRole('button', { name: 'Add user' }).click();
      await expect(page.getByRole('cell', { name: new RegExp(email) })).toBeVisible();
    }
    await logout(page);
  });

  let paymentUrl = '';
  let reference = '';
  await test.step('5–9. Maker adds a beneficiary, gets a quote and creates the payment', async () => {
    await login(page, maker, NEW_PASSWORD);
    await addBeneficiary(page, 'Rahul Sharma');

    await wizardToReview(page, 'Rahul Sharma', '10000.00');
    // 8. Exchange rate, spread, fee, INR amount and the 60-second countdown.
    await expect(page.getByTestId('quote-rate')).toHaveText('1 AED = 22.586500 INR');
    await expect(page.getByText('0.5000%')).toBeVisible();
    await expect(page.getByTestId('quote-recipient')).toContainText('225,865.00');
    await expect(page.getByText('10,025.00')).toBeVisible();
    const seconds = Number(await page.getByTestId('quote-countdown').getAttribute('data-seconds'));
    expect(seconds).toBeGreaterThan(50);
    expect(seconds).toBeLessThanOrEqual(60);

    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    // 10. Compliance engine runs (preview).
    await expect(page.getByTestId('compliance-preview')).toHaveAttribute('data-status', 'CLEAR');
    await page.getByRole('button', { name: 'Continue to review' }).click();
    await expect(page.getByTestId('estimated-status')).toContainText('Awaiting approval by a second user');
    await page.getByLabel('Purpose / reference (optional)').fill('Supplier invoice INV-E2E');
    await page.getByTestId('submit-payment').click();

    await expect(page.getByTestId('payment-created')).toBeVisible();
    await expect(page.getByTestId('created-status')).toHaveAttribute('data-status', 'CREATED');
    reference = (await page.getByTestId('payment-reference').textContent()) ?? '';
    expect(reference).toMatch(/^PB-\d{8}-[0-9A-F]{8}$/);
    await page.getByRole('link', { name: 'View payment' }).click();
    await expectStatus(page, 'CREATED');
    paymentUrl = page.url();
    // A maker cannot approve — least of all their own payment.
    await expect(page.getByTestId('approve-button')).toHaveCount(0);
    await logout(page);
  });

  await test.step('12–18. Approver approves; ledger posts; provider webhook marks it PAID', async () => {
    await login(page, approver, NEW_PASSWORD);
    await page.goto(paymentUrl);
    await expect(page.getByTestId('approval-status')).toHaveAttribute('data-status', 'PENDING');
    await page.getByTestId('approve-button').click();
    await page.getByTestId('confirm-action').click();
    await expect(page.getByTestId('approval-status')).toHaveAttribute('data-status', 'APPROVED');
    // 15–17. Mock provider receives the payment and emits webhooks: processing → paid.
    await expectStatus(page, 'PAID', 45_000);
    await expect(page.getByTestId('recipient-amount')).toContainText('225,865.00');
    // 14 + 18. Hold, capture and settlement are posted and balanced.
    const ledger = page.getByTestId('ledger-transaction');
    await expect(ledger).toHaveCount(3);
    await expect(ledger.nth(0)).toHaveAttribute('data-type', 'PAYMENT_HOLD');
    await expect(ledger.nth(1)).toHaveAttribute('data-type', 'PAYMENT_CAPTURE');
    await expect(ledger.nth(2)).toHaveAttribute('data-type', 'PAYOUT_SETTLEMENT');
    await expect(page.getByText('Unbalanced')).toHaveCount(0);
    await logout(page);
  });

  await test.step('19–21. Platform admin reconciles and inspects payment, ledger, webhooks and audit trail', async () => {
    await login(page, PLATFORM_ADMIN, SEED_PASSWORD);
    const paymentId = paymentUrl.split('/').pop()!;

    await page.goto('/admin/reconciliation');
    await page.getByTestId('run-reconciliation').click();
    await page.getByLabel('Payment ID').fill(paymentId);
    const row = page.getByTestId('recon-table').getByRole('row', { name: new RegExp(reference) });
    await expect(row.locator('[data-status="MATCHED"]')).toBeVisible({ timeout: 30_000 }); // 20. Result: MATCHED

    await page.goto(paymentUrl);
    await expectStatus(page, 'PAID');
    await expect(page.getByTestId('compliance-status')).toHaveAttribute('data-status', 'CLEAR');
    await expect(page.getByRole('cell', { name: /Amount threshold/ })).toBeVisible();

    await page.goto('/ledger');
    await expect(page.getByTestId('trial-balance')).toContainText('The ledger balances');

    await page.goto('/admin/webhooks');
    await expect(page.getByTestId('webhook-table')).toContainText('payment.paid');

    await page.goto(`/admin/audit-logs?entityId=${paymentId}`);
    const audit = page.getByTestId('audit-table');
    for (const action of ['PAYMENT_CREATED', 'PAYMENT_APPROVED', 'PAYMENT_PROCESSING', 'PAYMENT_PAID']) await expect(audit).toContainText(action);
  });
});
