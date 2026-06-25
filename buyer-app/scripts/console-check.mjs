import { chromium } from "playwright";

const BASE = "http://localhost:3100";
const paths = [
  "/", "/search?q=", "/product/boat-airdopes", "/cart",
  "/checkout", "/orders", "/orders/OID-2026-10241", "/profile",
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript(() => {
  localStorage.setItem("openidea.cart.v1", JSON.stringify([]));
  localStorage.setItem("openidea.favourites.v1", JSON.stringify(["boat-airdopes"]));
});

for (const p of paths) {
  const msgs = [];
  const onMsg = (m) => {
    const t = m.type();
    if (t === "error" || t === "warning") msgs.push(`[${t}] ${m.text()}`);
  };
  const onErr = (e) => msgs.push(`[pageerror] ${e.message}`);
  page.on("console", onMsg);
  page.on("pageerror", onErr);
  await page.goto(BASE + p, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
  page.off("console", onMsg);
  page.off("pageerror", onErr);
  const filtered = msgs.filter(
    (m) => !/Download the React DevTools|Fast Refresh|outdated|preload|was preloaded using/i.test(m)
  );
  console.log(`\n=== ${p} ===`);
  console.log(filtered.length ? filtered.join("\n") : "  (no errors/warnings)");
}

await browser.close();
