import { chromium } from "playwright";
import { mkdirSync } from "fs";

const BASE = "http://localhost:3100";
const OUT = "scripts/shots2";
mkdirSync(OUT, { recursive: true });

const CART_SEED = `(() => {
  const seller = (id,name,price,mrp,eta1,eta2)=>({id,name,providerId:"p-"+id,logo:"https://picsum.photos/seed/"+id+"/80/80",rating:4.5,ratingCount:1200,etaMinMins:eta1,etaMaxMins:eta2,price,mrp,deliveryFee:0,freeDeliveryAbove:499,distanceKm:2.4});
  const img=(s)=>["https://picsum.photos/seed/"+s+"-0/800/800"];
  const p=(id,title,unit,price,mrp,cat)=>({id,title,brand:"Brand",description:"desc",categoryId:cat,images:img(id),rating:4.5,ratingCount:1200,startingPrice:price,mrp,unit,sellers:[],inStock:true});
  const lines=[
    {productId:"aashirvaad-atta-5kg",product:p("aashirvaad-atta-5kg","Aashirvaad Whole Wheat Atta","5 kg",249,320,"grocery"),sellerId:"freshmart",seller:seller("freshmart","FreshMart",249,320,20,30),quantity:2},
    {productId:"amul-butter-500g",product:p("amul-butter-500g","Amul Butter Pasteurised","500 g",265,290,"grocery"),sellerId:"freshmart",seller:seller("freshmart","FreshMart",265,290,20,30),quantity:1},
    {productId:"cetaphil-cleanser",product:p("cetaphil-cleanser","Cetaphil Gentle Skin Cleanser","250 ml",449,599,"beauty"),sellerId:"glowbeauty",seller:seller("glowbeauty","Glow Beauty",449,599,40,70),quantity:1}
  ];
  localStorage.setItem("openidea.cart.v1", JSON.stringify(lines));
  localStorage.setItem("openidea.recentlyViewed.v1", JSON.stringify(["boat-airdopes","samsung-m34","nike-revolution"]));
  localStorage.setItem("openidea.favourites.v1", JSON.stringify(["boat-airdopes","amul-butter-500g"]));
  localStorage.setItem("openidea.theme","light");
})()`;

async function revealAll(page) {
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.8);
    const max = document.body.scrollHeight;
    for (let y = 0; y <= max; y += step) { window.scrollTo(0, y); await new Promise(r=>setTimeout(r,180)); }
    window.scrollTo(0, document.body.scrollHeight); await new Promise(r=>setTimeout(r,300));
    window.scrollTo(0, 0); await new Promise(r=>setTimeout(r,200));
  });
}

const browser = await chromium.launch();

// 1) Responsive sweep of key pages across widths
const widths = [320, 375, 390, 414, 768, 1024, 1280, 1440, 1920];
const pages = [
  { name: "home", path: "/" },
  { name: "search", path: "/search?q=" },
  { name: "product", path: "/product/boat-airdopes" },
  { name: "cart", path: "/cart" },
  { name: "checkout", path: "/checkout" },
  { name: "orders", path: "/orders" },
  { name: "order-details", path: "/orders/OID-2026-10241" },
  { name: "profile", path: "/profile" },
];

for (const w of widths) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: 900 },
    deviceScaleFactor: 1,
    isMobile: w < 768,
    hasTouch: w < 768,
  });
  const page = await ctx.newPage();
  await page.addInitScript(CART_SEED);
  for (const p of pages) {
    await page.goto(BASE + p.path, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(700);
    await revealAll(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/w${w}-${p.name}.png`, fullPage: true }).catch(() => {});
  }
  await ctx.close();
  console.log("✓ width", w);
}

// 2) Mobile sticky purchase bar — capture viewport (not full page) after scrolling down
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.addInitScript(CART_SEED);
  await page.goto(BASE + "/product/boat-airdopes", { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(800);
  // scroll past the inline purchase box to reveal the sticky bar
  await page.evaluate(() => window.scrollTo(0, 1400));
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/mobile-sticky-bar.png`, fullPage: false });
  console.log("✓ sticky bar");
  await ctx.close();
}

await browser.close();
console.log("DONE");
