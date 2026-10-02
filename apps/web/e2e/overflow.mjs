// Lists elements that extend past the viewport: node e2e/overflow.mjs <path> <width>
import { chromium } from '@playwright/test';
const [path = '/', width = '390'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width), height: 844 } });
await page.goto(`${process.env.BASE_URL ?? 'http://localhost:3000'}${path}`);
await page.waitForLoadState('networkidle');
const found = await page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  return [...document.querySelectorAll('body *')]
    .filter((el) => el.getBoundingClientRect().right > vw + 1 && !el.closest('.table-wrap, pre, [aria-hidden="true"]'))
    .slice(0, 8)
    .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 70)} right=${Math.round(el.getBoundingClientRect().right)} text="${(el.textContent ?? '').trim().slice(0, 40)}"`);
});
console.log(found.length ? found.join('\n') : 'nothing overflows');
await browser.close();
