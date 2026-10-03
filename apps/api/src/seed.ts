import './env';
import 'reflect-metadata';
import { bootstrapReferenceData } from '@paybridge/database';
import { postings } from '@paybridge/shared';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createApp } from './app.factory';
import { Actor } from './common/actor';
import { AuthGuard } from './common/auth.guard';
import { hashPassword } from './common/crypto';
import { logger } from './common/logger';
import { PrismaService } from './common/prisma.service';
import { AppConfig, CONFIG } from './config';
import { AuthService } from './modules/auth/auth.service';
import { BeneficiariesService } from './modules/beneficiaries/beneficiaries.service';
import { CompaniesService } from './modules/companies/companies.service';
import { FxService } from './modules/fx/fx.service';
import { KybService } from './modules/kyb/kyb.service';
import { LedgerService } from './modules/ledger/ledger.service';
import { OutboxService } from './modules/outbox/outbox.service';
import { PaymentsService } from './modules/payments/payments.service';
import { ReconciliationService } from './modules/reconciliation/reconciliation.service';

/**
 * Seed data for the sandbox. Everything is fictional: names, licences, IFSC codes and account numbers are test
 * values. Business data is created through the application services — the same code paths the API uses — so
 * the seeded ledger is balanced by construction. Only the deliberate reconciliation mismatches are written
 * directly, because the services could not have produced them.
 */
const PASSWORD = process.env.SEED_PASSWORD ?? 'PayBridge-Demo-2026!';
const DAY = 86_400_000;

async function main() {
  const allowed = process.env.APP_ENV === 'development' || process.env.APP_ENV === undefined || process.env.ALLOW_SEED === 'true';
  if (!allowed) throw new Error('Refusing to seed: APP_ENV is not "development". Set ALLOW_SEED=true to seed a sandbox deployment on purpose.');

  process.env.MOCK_PROVIDER_DELAY_MS = '0';
  process.env.RATE_LIMIT_DISABLED = 'true';
  logger.level = 'warn';
  const app = await createApp();
  await app.listen(0);
  const config = app.get<AppConfig>(CONFIG);
  config.WEBHOOK_TARGET_URL = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

  const prisma = app.get(PrismaService).client;
  const guard = app.get(AuthGuard);
  const auth = app.get(AuthService);
  const companies = app.get(CompaniesService);
  const kyb = app.get(KybService);
  const beneficiaries = app.get(BeneficiariesService);
  const fx = app.get(FxService);
  const payments = app.get(PaymentsService);
  const ledger = app.get(LedgerService);
  const outbox = app.get(OutboxService);
  const reconciliation = app.get(ReconciliationService);

  await bootstrapReferenceData(prisma);
  if (await prisma.user.findUnique({ where: { email: 'platform.admin@paybridge.test' } })) {
    console.log('Seed data already present — nothing to do. Use `pnpm db:reset` to start again.');
    await app.close();
    return;
  }

  const actor = (userId: string): Promise<Actor> => guard.loadActor(userId);
  const register = async (email: string, fullName: string) => (await auth.register({ email, fullName, password: PASSWORD })).id;

  // ── Platform admin ──
  const platformRole = await prisma.role.findUniqueOrThrow({ where: { name: 'PLATFORM_ADMIN' } });
  const platformUser = await prisma.user.create({
    data: { email: 'platform.admin@paybridge.test', fullName: 'Parisa Platform (Ops)', passwordHash: await hashPassword(PASSWORD, config.PASSWORD_SCRYPT_N), platformRoleId: platformRole.id },
  });
  const platform = await actor(platformUser.id);

  // INR the simulated payout partner holds for us.
  await prisma.$transaction((tx) => ledger.post(tx, { postingKey: 'seed:nostro-funding', type: 'NOSTRO_FUNDING', description: 'Simulated nostro pre-funding (sandbox)', entries: postings.nostroFunding('50000000.00') }));

  // ── Companies ──
  const newCompany = async (slug: string, name: string, n: number, adminName: string) => {
    const adminId = await register(`admin@${slug}.test`, adminName);
    const company = await companies.create(await actor(adminId), {
      name,
      country: 'AE',
      tradeLicenseNumber: `TEST-TL-00000${n}`,
      tradeLicenseExpiry: '2028-12-31',
      registrationNumber: `TEST-REG-00000${n}`,
      businessType: 'General Trading',
      registeredAddress: `Test Tower ${n}, Sheikh Zayed Road, Dubai (fictional)`,
      contactEmail: `ops@${slug}.test`,
      contactPhone: `+97150000000${n}`,
      website: `https://${slug}.test`,
    });
    return { id: company.id, kybProfileId: company.kybProfileId as string, adminId };
  };
  const addUser = async (companyId: string, adminId: string, email: string, fullName: string, role: string) =>
    (await companies.addUser(await actor(adminId), companyId, { email, fullName, role, password: PASSWORD })).userId;

  const acme = await newCompany('acme', 'Acme Trading LLC', 1, 'Aisha Khan (Acme Admin)');
  const acmeMaker = await addUser(acme.id, acme.adminId, 'maker@acme.test', 'Omar Farouk (Maker)', 'MAKER');
  const acmeApprover = await addUser(acme.id, acme.adminId, 'approver@acme.test', 'Layla Hassan (Approver)', 'APPROVER');
  await addUser(acme.id, acme.adminId, 'viewer@acme.test', 'Yusuf Ali (Viewer)', 'VIEWER');

  const dubaiTech = await newCompany('dubaitech', 'Dubai Tech Supplies LLC', 2, 'Noor Saeed (Dubai Tech Admin)');
  await addUser(dubaiTech.id, dubaiTech.adminId, 'maker@dubaitech.test', 'Hamad Rashid (Maker)', 'MAKER');

  const gulf = await newCompany('gulfimports', 'Gulf Imports LLC', 3, 'Fatima Noor (Gulf Admin)');
  const gulfMaker = await addUser(gulf.id, gulf.adminId, 'maker@gulfimports.test', 'Khalid Mansour (Maker)', 'MAKER');
  const gulfApprover = await addUser(gulf.id, gulf.adminId, 'approver@gulfimports.test', 'Mariam Saleh (Approver)', 'APPROVER');

  // ── KYB: Acme and Gulf approved, Dubai Tech awaiting review ──
  for (const c of [acme, gulf]) {
    await kyb.submit(await actor(c.adminId));
    await kyb.approve(platform, c.kybProfileId, 'LOW', 'Seeded as approved');
  }
  await kyb.submit(await actor(dubaiTech.adminId));
  await ledger.topup(await actor(acme.adminId), acme.id, '500000.00', 'seed-topup');
  await ledger.topup(await actor(gulf.adminId), gulf.id, '250000.00', 'seed-topup');

  // ── Beneficiaries (fictional) ──
  let account = 100200300400;
  const addBeneficiary = async (userId: string, name: string, bankName = 'Test Bank of India') =>
    (await beneficiaries.create(await actor(userId), { name, country: 'IN', bankName, accountNumber: String(account++), ifsc: 'TEST0001234', accountHolderName: name })).id;
  const rahul = await addBeneficiary(acmeMaker, 'Rahul Sharma');
  const priya = await addBeneficiary(acmeMaker, 'Priya Enterprises');
  const mumbai = await addBeneficiary(acmeMaker, 'Mumbai Supplies Pvt Ltd', 'Sandbox National Bank');
  const failing = await addBeneficiary(acmeMaker, 'Kolkata Textiles (TEST-FAIL)');
  await addBeneficiary(acmeMaker, 'Acme India Pvt Ltd', 'Sandbox National Bank'); // the landing page's demo payee
  await addBeneficiary(acmeMaker, 'TEST-SANCTION Holdings'); // created BLOCKED by the mock screening
  const chennai = await addBeneficiary(gulfMaker, 'Chennai Components Pvt Ltd');

  // ── Payments ──
  type Outcome = 'paid' | 'awaiting' | 'cancelled' | 'review';
  const pay = async (maker: string, approver: string, beneficiaryId: string, amount: string, purpose: string, outcome: Outcome, daysAgo: number) => {
    const makerActor = await actor(maker);
    const quote = await fx.createQuote(makerActor, { baseCurrency: 'AED', quoteCurrency: 'INR', baseAmount: amount });
    const { payment } = await payments.create(makerActor, { quoteId: quote.id, beneficiaryId, purpose }, `seed-${randomUUID()}`);
    if (outcome === 'paid') {
      await payments.approve(await actor(approver), payment.id, 'Seeded approval');
      await outbox.drainAll();
    } else if (outcome === 'cancelled') {
      await payments.cancel(makerActor, payment.id, 'Duplicate instruction');
    }
    // Spread history over the past fortnight so the dashboard has something to show.
    if (daysAgo > 0) {
      const at = new Date(Date.now() - daysAgo * DAY - Math.floor(Math.random() * 6 * 3_600_000));
      await prisma.paymentOrder.update({ where: { id: payment.id }, data: { createdAt: at, completedAt: outcome === 'awaiting' || outcome === 'review' ? null : new Date(at.getTime() + 90_000) } });
      await prisma.fxQuote.updateMany({ where: { id: quote.id }, data: { usedAt: at } });
    }
    return payment.id as string;
  };

  await pay(acmeMaker, acmeApprover, rahul, '10000.00', 'Supplier invoice INV-1001', 'paid', 12);
  const mismatchId = await pay(acmeMaker, acmeApprover, priya, '18500.00', 'Supplier invoice INV-1002', 'paid', 10);
  await pay(acmeMaker, acmeApprover, mumbai, '42000.00', 'Raw materials PO-2291', 'paid', 8);
  await pay(acmeMaker, acmeApprover, failing, '7300.00', 'Fabric order FO-77', 'paid', 6); // provider scenario: ends FAILED, refunded
  const duplicateId = await pay(acmeMaker, acmeApprover, rahul, '3250.50', 'Consulting retainer', 'paid', 5);
  await pay(acmeMaker, acmeApprover, priya, '26400.00', 'Supplier invoice INV-1017', 'paid', 3);
  await pay(acmeMaker, acmeApprover, mumbai, '5600.00', 'Duplicate instruction', 'cancelled', 2);
  await pay(acmeMaker, acmeApprover, mumbai, '15750.00', 'Packaging order PK-12', 'paid', 1);
  await pay(acmeMaker, acmeApprover, rahul, '75000.00', 'Machinery deposit MD-4', 'review', 0); // above the AED 50,000 threshold → compliance alert
  await pay(acmeMaker, acmeApprover, priya, '12000.00', 'Supplier invoice INV-1024', 'awaiting', 0);
  await pay(gulfMaker, gulfApprover, chennai, '22000.00', 'Component order CO-9', 'paid', 4);
  await pay(gulfMaker, gulfApprover, chennai, '8900.00', 'Component order CO-11', 'awaiting', 0);
  await outbox.drainAll();

  // ── Reconciliation examples, written directly: the application could not have produced these ──
  await prisma.providerPayment.updateMany({ where: { paymentId: mismatchId }, data: { status: 'FAILED', failureReason: 'SEEDED_MISMATCH' } });
  const original = await prisma.providerPayment.findFirstOrThrow({ where: { paymentId: duplicateId } });
  await prisma.providerPayment.create({ data: { providerPaymentId: `${original.providerPaymentId}_dup`, paymentId: duplicateId, amount: original.amount, currency: original.currency, status: 'PAID', scenario: 'SEEDED_DUPLICATE' } });
  const run = await reconciliation.runNow(platform.userId);

  const trial = await ledger.trialBalance();
  if (!trial.balanced) throw new Error(`Seed left the ledger unbalanced: ${JSON.stringify(trial)}`);

  console.log(`
PayBridge sandbox seeded — Educational Sandbox, no real money movement.

  Companies      Acme Trading LLC (KYB approved) · Gulf Imports LLC (KYB approved) · Dubai Tech Supplies LLC (KYB under review)
  Payments       ${await prisma.paymentOrder.count()} across every status; ledger trial balance is zero in AED and INR
  Reconciliation ${run.totalItems} items, ${run.issueCount} needing attention (seeded mismatch and duplicate)

  Test logins (password for all: ${PASSWORD})
    platform.admin@paybridge.test   Platform admin
    admin@acme.test                 Company admin   Acme Trading LLC
    maker@acme.test                 Maker           Acme Trading LLC
    approver@acme.test              Approver        Acme Trading LLC
    viewer@acme.test                Viewer          Acme Trading LLC
    admin@dubaitech.test            Company admin   Dubai Tech Supplies LLC (KYB under review)
    admin@gulfimports.test          Company admin   Gulf Imports LLC
`);
  await app.close();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
