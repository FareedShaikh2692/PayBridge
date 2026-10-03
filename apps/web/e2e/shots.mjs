// Captures screenshots for visual review: node e2e/shots.mjs <outDir> <name>=<path>[@width[x height]][:full] ...
// Optional: LOGIN=email to sign in with the seeded demo password first.
import { chromium } from '@playwright/test';

const [outDir, ...targets] = process.argv.slice(2);
const base = process.env.BASE_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const errors = [];
for (const target of targets) {
  const [name, rest] = target.split('=');
  const full = rest.endsWith(':full');
  const [path, size = '1440x900'] = rest.replace(/:full$/, '').split('@');
  const [width, height = '900'] = size.split('x');
  const context = await browser.newContext({ viewport: { width: Number(width), height: Number(height) }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  if (process.env.LOGIN) {
    await page.goto(`${base}/login`);
    await page.getByLabel('Email address').fill(process.env.LOGIN);
    await page.getByLabel('Password').fill(process.env.SEED_PASSWORD ?? 'PayBridge-Demo-2026!');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByTestId('user-name').waitFor();
  }
  await page.goto(`${base}${path}`);
  await page.waitForLoadState('networkidle');
  if (full) {
    // Scroll through so in-view animations and lazily rendered sections play before the capture.
    for (let y = 0; y < (await page.evaluate(() => document.body.scrollHeight)); y += 500) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  await page.waitForTimeout(600);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) errors.push(`${name}: horizontal overflow of ${overflow}px at ${width}px`);
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: full });
  await context.close();
}
await browser.close();
console.log(errors.length ? `ISSUES:\n${errors.join('\n')}` : 'no console errors, no horizontal overflow');
