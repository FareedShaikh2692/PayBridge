import { expect, type Page } from '@playwright/test';

/** Seeded test accounts (see apps/api/src/seed.ts). Fictional, sandbox-only. */
export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'PayBridge-Demo-2026!';
export const PLATFORM_ADMIN = 'platform.admin@paybridge.test';
export const NEW_PASSWORD = 'E2E-Sandbox-Pass-1!';

export const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

export async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByTestId('user-name')).toBeVisible();
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

export async function addBeneficiary(page: Page, name: string) {
  await page.goto('/beneficiaries/new');
  await page.getByLabel('Beneficiary name').fill(name);
  await page.getByLabel('Bank name').fill('Test Bank');
  await page.getByLabel('Account number').fill(`9${Date.now().toString().slice(-11)}`);
  await page.getByLabel('IFSC').fill('TEST0001234');
  await page.getByLabel('Account holder name').fill(name);
  await page.getByRole('button', { name: 'Save beneficiary' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByTestId('masked-account')).toHaveText(/^XXXXXX\d{4}$/);
}

/** Walks the six-step wizard up to the review step. */
export async function wizardToReview(page: Page, beneficiary: string, amount: string) {
  await page.goto('/payments/new');
  await page.getByRole('radio', { name: new RegExp(beneficiary) }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('You send (AED)').fill(amount);
  await page.getByRole('button', { name: 'Get quote' }).click();
  await expect(page.getByTestId('quote-countdown')).toBeVisible();
}

export async function expectStatus(page: Page, status: string, timeout = 30_000) {
  await expect(page.getByTestId('payment-status')).toHaveAttribute('data-status', status, { timeout });
}

export interface E2eTenant {
  admin: string;
  maker: string;
  approver: string;
  companyId: string;
}

/**
 * Creates an isolated, KYB-approved, funded company through the API, so a flow under test does not depend on
 * what earlier runs left behind (the velocity rule, for one, counts a company's recent payments).
 */
export async function createTenant(request: import('@playwright/test').APIRequestContext, fund = '500000.00'): Promise<E2eTenant> {
  const id = unique();
  const emails = { admin: `admin-${id}@e2e.test`, maker: `maker-${id}@e2e.test`, approver: `approver-${id}@e2e.test` };
  const post = async (path: string, data: unknown, token?: string) => {
    const res = await request.post(`/api/v1${path}`, { data, headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok()) throw new Error(`${path} → ${res.status()} ${await res.text()}`);
    return (await res.json()).data;
  };
  const token = async (email: string, password: string) => (await post('/auth/login', { email, password })).accessToken as string;

  await post('/auth/register', { email: emails.admin, password: NEW_PASSWORD, fullName: 'E2E Admin' });
  let admin = await token(emails.admin, NEW_PASSWORD);
  const company = await post('/companies', {
    name: `E2E Trading ${id} LLC`, country: 'AE', tradeLicenseNumber: `TEST-TL-${id}`, tradeLicenseExpiry: '2030-12-31', registrationNumber: `TEST-REG-${id}`,
    businessType: 'General Trading', registeredAddress: 'Test Tower, Dubai (fictional)', contactEmail: `ops-${id}@e2e.test`, contactPhone: '+971500000000',
  }, admin);
  admin = await token(emails.admin, NEW_PASSWORD);
  await post(`/companies/${company.id}/users`, { email: emails.maker, fullName: 'E2E Maker', role: 'MAKER', password: NEW_PASSWORD }, admin);
  await post(`/companies/${company.id}/users`, { email: emails.approver, fullName: 'E2E Approver', role: 'APPROVER', password: NEW_PASSWORD }, admin);
  const kyb = await post('/kyb/submit', {}, admin);
  await post(`/kyb/${kyb.id}/approve`, { riskLevel: 'LOW' }, await token(PLATFORM_ADMIN, SEED_PASSWORD));
  await post('/sandbox/wallet/topup', { amount: fund }, admin);
  return { ...emails, companyId: company.id };
}
