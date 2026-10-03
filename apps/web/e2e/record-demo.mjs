// Records the product demo video against a running local sandbox (fictional data only).
// node e2e/record-demo.mjs <outDir>  →  <outDir>/raw.webm and <outDir>/paybridge-demo.vtt
// Needs the seeded accounts and an "Acme India Pvt Ltd" beneficiary for Acme Trading LLC.
import { chromium } from '@playwright/test';
import { readdirSync, renameSync, writeFileSync } from 'node:fs';

const outDir = process.argv[2];
const base = process.env.BASE_URL ?? 'http://localhost:3000';
const PASSWORD = process.env.SEED_PASSWORD ?? 'PayBridge-Demo-2026!';
const size = { width: 1280, height: 720 };

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, recordVideo: { dir: outDir, size } });
const started = Date.now();
const cues = [];

// A caption bar that survives navigations: the text lives in sessionStorage and is redrawn on every page.
await context.addInitScript(() => {
  const draw = () => {
    let el = document.getElementById('__caption');
    const text = sessionStorage.getItem('__caption') ?? '';
    if (!el) {
      el = document.createElement('div');
      el.id = '__caption';
      el.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;max-width:900px;padding:10px 18px;border-radius:10px;background:rgba(11,18,32,.88);color:#fff;font:500 17px/1.4 Inter,system-ui,sans-serif;text-align:center;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,.25)';
      document.documentElement.appendChild(el);
    }
    el.textContent = text;
    el.style.display = text ? 'block' : 'none';
  };
  window.__drawCaption = draw;
  document.addEventListener('DOMContentLoaded', draw);
});

const page = await context.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const ts = (ms) => new Date(ms).toISOString().slice(11, 23);
async function caption(text) {
  const now = Date.now() - started;
  if (cues.length) cues.at(-1).end = now;
  if (text) cues.push({ start: now, end: now, text });
  await page.evaluate((t) => { sessionStorage.setItem('__caption', t); window.__drawCaption?.(); }, text ?? '');
}
async function highlightClick(locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator.evaluate((el) => { el.style.outline = '3px solid rgba(37,99,235,.55)'; el.style.outlineOffset = '2px'; });
  await wait(600);
  await locator.click();
}
async function smoothScrollTo(y, ms = 1600) {
  await page.evaluate(({ y, ms }) => new Promise((done) => {
    const from = window.scrollY; const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / ms); window.scrollTo(0, from + (y - from) * (1 - Math.cos(Math.PI * k)) / 2); if (k < 1) requestAnimationFrame(step); else done(); };
    requestAnimationFrame(step);
  }), { y, ms });
}
async function scrollToId(id, offset = -80) {
  const y = await page.evaluate(({ id, offset }) => document.getElementById(id).getBoundingClientRect().top + window.scrollY + offset, { id, offset });
  await smoothScrollTo(y);
}
async function login(email) {
  await page.goto(`${base}/login`);
  await page.getByLabel('Email address').pressSequentially(email, { delay: 35 });
  await page.getByLabel('Password').fill(PASSWORD);
  await highlightClick(page.getByRole('button', { name: 'Sign in', exact: true }));
  await page.getByTestId('user-name').waitFor();
}
async function logout() {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('heading', { name: 'Welcome back' }).waitFor();
}

// 1. Landing
await page.goto(base);
await caption('PayBridge — an educational sandbox for UAE → India business payments. No real money moves.');
await wait(4500);
await caption('Follow one payment through FX, compliance, the ledger, the provider and reconciliation.');
await scrollToId('flow');
await wait(2500);
await scrollToId('demo');
await wait(4500);

// 2. Maker creates a payment
await caption('Sign in with a demo account. First, the Maker.');
await login('maker@acme.test');
await wait(2000);
await caption('The overview: balance, volume, payment status and recent payments.');
await wait(3500);
await page.goto(`${base}/payments/new`);
await caption('New payment: choose the beneficiary — Acme India Pvt Ltd, Mumbai.');
await highlightClick(page.getByRole('radio', { name: /Acme India Pvt Ltd/ }));
await highlightClick(page.getByRole('button', { name: 'Continue', exact: true }));
await caption('Lock an AED → INR quote: rate, spread and fee shown up front, valid for 60 seconds.');
await page.getByLabel('You send (AED)').fill('');
await page.getByLabel('You send (AED)').pressSequentially('10000.00', { delay: 60 });
await highlightClick(page.getByRole('button', { name: 'Get quote' }));
await page.getByTestId('quote-countdown').waitFor();
await wait(3500);
await highlightClick(page.getByRole('button', { name: 'Continue', exact: true }));
await caption('Compliance rules run before the payment is submitted.');
await page.getByTestId('compliance-preview').waitFor();
await wait(3000);
await highlightClick(page.getByRole('button', { name: 'Continue to review' }));
await page.getByLabel('Purpose / reference (optional)').pressSequentially('Supplier invoice INV-DEMO-421', { delay: 30 });
await caption('Review and submit. Funds are held in the ledger straight away.');
await wait(1200);
await highlightClick(page.getByTestId('submit-payment'));
await page.getByTestId('payment-created').waitFor();
await caption('Payment created — it now needs a second person to approve it (maker-checker).');
await wait(3000);
await highlightClick(page.getByRole('link', { name: 'View payment' }));
await page.getByTestId('payment-lifecycle').waitFor();
const paymentUrl = page.url();
await wait(2500);
await logout();

// 3. Approver approves; provider webhooks settle it
await caption('Now the Approver signs in and approves.');
await login('approver@acme.test');
await page.goto(paymentUrl);
await page.getByTestId('approve-button').waitFor();
await wait(1500);
await highlightClick(page.getByTestId('approve-button'));
await wait(800);
await highlightClick(page.getByTestId('confirm-action'));
await caption('The mock provider processes the payout and reports back with signed webhooks.');
await page.locator('[data-testid="payment-status"][data-status="PAID"]').waitFor({ timeout: 60_000 });
await wait(2500);
await caption('Paid. Hold, capture and settlement are posted — debits equal credits in every currency.');
await page.getByTestId('ledger-totals').scrollIntoViewIfNeeded();
await wait(4000);
await caption('Every compliance rule is listed with its result.');
await page.getByTestId('compliance-checklist').scrollIntoViewIfNeeded();
await wait(4000);
await logout();

// 4. Platform admin reconciles
await caption('Finally, a platform admin runs reconciliation.');
await login('platform.admin@paybridge.test');
await page.goto(`${base}/admin/webhooks`);
await caption('Webhooks: received, signature verified, persisted, then applied — once.');
await page.getByTestId('event-stream').waitFor();
await wait(4000);
await page.goto(`${base}/admin/reconciliation`);
await highlightClick(page.getByTestId('run-reconciliation'));
await caption('Reconciliation compares the internal payment, the provider record and the ledger.');
await wait(3500);
await page.getByLabel('Payment ID').fill(paymentUrl.split('/').pop());
await page.getByRole('button', { name: 'Compare' }).first().waitFor({ timeout: 30_000 });
await highlightClick(page.getByRole('button', { name: 'Compare' }).first());
await page.getByTestId('recon-compare').waitFor();
await caption('Matched: expected and received amounts agree, with zero difference.');
await wait(4500);
await page.goto(paymentUrl);
await page.getByTestId('payment-lifecycle').waitFor();
await caption('Created → Compliance → Approved → Processing → Paid → Reconciled.');
await wait(4500);
await caption('PayBridge · Educational Sandbox — No Real Money Movement.');
await wait(3000);
await caption('');

await context.close();
await browser.close();

const vtt = ['WEBVTT', '', ...cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`)].join('\n');
writeFileSync(`${outDir}/paybridge-demo.vtt`, vtt);
const webm = readdirSync(outDir).find((f) => f.endsWith('.webm') && f !== 'raw.webm');
renameSync(`${outDir}/${webm}`, `${outDir}/raw.webm`);
console.log(`recorded ${Math.round((Date.now() - started) / 1000)}s, ${cues.length} captions`);
