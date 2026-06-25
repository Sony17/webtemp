import { chromium } from "playwright";
import { mkdirSync } from "fs";

const BASE = "http://localhost:3100";
const OUT = "scripts/shots";
mkdirSync(OUT, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

// Seed a populated cart so /cart and /checkout render real content.
const CART_SEED = `(() => {
  const seller = (id,name,price,mrp,eta1,eta2)=>({id,name,providerId:"p-"+id,logo:"https://picsum.photos/seed/"+id+"/80/80",rating:4.5,ratingCount:1200,etaMinMins:eta1,etaMaxMins:eta2,price,mrp,deliveryFee:0,freeDeliveryAbove:499,distanceKm:2.4});
  const img=(s)=>["https://picsum.photos/seed/"+s+"-0/800/800"];
  const p=(id,title,unit,price,mrp,cat)=>({id,title,brand:"Brand",description:"desc",categoryId:cat,images:img(id),rating:4.5,ratingCount:1200,startingPrice:price,mrp,unit,sellers:[],inStock:true});
  const s1=seller("freshmart","FreshMart",249,320,20,30);
  const s2=seller("glowbeauty","Glow Beauty",449,599,40,70);
  const lines=[
    {productId:"aashirvaad-atta-5kg",product:p("aashirvaad-atta-5kg","Aashirvaad Whole Wheat Atta","5 kg",249,320,"grocery"),sellerId:"freshmart",seller:s1,quantity:2},
    {productId:"amul-butter-500g",product:p("amul-butter-500g","Amul Butter Pasteurised","500 g",265,290,"grocery"),sellerId:"freshmart",seller:seller("freshmart","FreshMart",265,290,20,30),quantity:1},
    {productId:"cetaphil-cleanser",product:p("cetaphil-cleanser","Cetaphil Gentle Skin Cleanser","250 ml",449,599,"beauty"),sellerId:"glowbeauty",seller:s2,quantity:1}
  ];
  localStorage.setItem("openidea.cart.v1", JSON.stringify(lines));
  localStorage.setItem("openidea.recentlyViewed.v1", JSON.stringify(["boat-airdopes","samsung-m34","nike-revolution"]));
  localStorage.setItem("openidea.favourites.v1", JSON.stringify(["boat-airdopes","amul-butter-500g"]));
})()`;

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

// Scroll the whole page in steps to trigger Framer Motion whileInView reveals,
// then return to the top so the full-page screenshot shows all content visible.
async function revealAll(page) {
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.8);
    const max = document.body.scrollHeight;
    for (let y = 0; y <= max; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 220));
    }
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 350));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 250));
  });
}

async function shoot(context, label, theme) {
  const page = await context.newPage();
  await page.addInitScript(CART_SEED);
  await page.addInitScript(
    (t) => localStorage.setItem("openidea.theme", t),
    theme
  );
  for (const p of pages) {
    try {
      await page.goto(BASE + p.path, { waitUntil: "networkidle", timeout: 30000 });
    } catch {
      await page.goto(BASE + p.path, { waitUntil: "load", timeout: 30000 }).catch(() => {});
    }
    await page.waitForTimeout(800);
    await revealAll(page);
    await page.waitForTimeout(400);
    const file = `${OUT}/${label}-${p.name}-${theme}.png`;
    await page.screenshot({ path: file, fullPage: true }).catch((e) => console.log("ERR", file, e.message));
    console.log("✓", file);
  }
  await page.close();
}

const browser = await chromium.launch();

const dDesktop = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1 });
await shoot(dDesktop, "desktop", "light");
await shoot(dDesktop, "desktop", "dark");
await dDesktop.close();

const dMobile = await browser.newContext({ viewport: MOBILE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await shoot(dMobile, "mobile", "light");
await dMobile.close();

await browser.close();
console.log("DONE");
