// Buyer-app console auditor — migrated from the prototype and repathed to the
// current /shop routes (port 3000). Visits each page and reports console
// errors/warnings + uncaught page errors. Requires Playwright:
//   npm i -D playwright && npx playwright install chromium
//   node scripts/buyer-app-qa/console-check.mjs
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3000";
const paths = [
  "/shop",
  "/shop/search?q=rice",
  "/shop/product/b/p/i",
  "/shop/cart",
  "/shop/checkout",
  "/shop/orders",
  "/shop/order/t/b",
  "/shop/order/t/b/payment",
  "/shop/order/t/b/return",
  "/shop/order/t/b/issue",
  "/shop/order/t/b/rate",
  "/shop/account",
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

let total = 0;
for (const p of paths) {
  const msgs = [];
  const onMsg = (m) => {
    const t = m.type();
    if (t === "error" || t === "warning") msgs.push(`[${t}] ${m.text()}`);
  };
  const onErr = (e) => msgs.push(`[pageerror] ${e.message}`);
  page.on("console", onMsg);
  page.on("pageerror", onErr);
  await page
    .goto(BASE + p, { waitUntil: "networkidle", timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(1200);
  page.off("console", onMsg);
  page.off("pageerror", onErr);
  const filtered = msgs.filter(
    (m) =>
      !/Download the React DevTools|Fast Refresh|outdated|preload|was preloaded using/i.test(
        m
      )
  );
  total += filtered.length;
  console.log(`\n=== ${p} ===`);
  console.log(filtered.length ? filtered.join("\n") : "  (no errors/warnings)");
}

console.log(`\nTotal console issues: ${total}`);
await browser.close();
process.exit(total > 0 ? 1 : 0);
