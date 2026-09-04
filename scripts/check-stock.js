// Stock USA — automatic stock/price checker.
// Runs unattended on a GitHub Actions schedule (see ../.github/workflows/check-stock.yml).
// No human approval is ever needed — that's the whole point of moving this off Claude.
//
// What it does, per product:
//   1. Skip products marked dataSource === "manual" (the seller tracks those by hand)
//      or with no sourceUrl.
//   2. Open the product page in a real headless Chromium (via Playwright), so
//      JavaScript-rendered shops work, not just plain HTML.
//   3. Try, in order:
//        a) schema.org JSON-LD <script type="application/ld+json"> Product/Offer data
//           (most reliable — many modern shops embed this for Google/SEO)
//        b) common <meta> tags (og:price:amount, og:availability, product:price:amount)
//        c) last-resort keyword search in the page text ("out of stock", "sold out",
//           "add to cart" button state) for in/out-of-stock only
//   4. Write the result straight back to Firestore. The storefront (index.html) reads
//      Firestore live, so there is no separate "regenerate/republish" step anymore.
//
// Honest limitation: this generic script does NOT attempt to detect a per-size
// breakdown (which size is sold out vs. available) — that needs a hand-written
// CSS selector per site, which is far more fragile to maintain for free than it's
// worth here. It reliably detects overall in-stock/out-of-stock + price. If you
// want per-size detection for one specific site you sell a lot from, look at the
// SITE_SELECTORS section below and extend it — otherwise leave hasSizes products'
// sizesAll/sizesInStock untouched and let the seller maintain sizes manually via
// admin.html's "Stok/ölçünü özüm daxil edim" toggle.
//
// Also honest: some sites will always fail here (Cloudflare/CAPTCHA/login-walled
// catalogs) — same as with any scraper, free or paid. Those get marked
// needs_manual_check, same fallback the previous Claude-based system used.

const { chromium } = require("playwright");
const admin = require("firebase-admin");

// ---------- Firebase Admin init ----------
// FIREBASE_SERVICE_ACCOUNT is a GitHub Actions secret containing the full JSON
// key downloaded from Firebase Console → Project settings → Service accounts →
// Generate new private key. See README.md, step 6. NEVER commit this file/value
// to the repo — it bypasses firestore.rules entirely.
const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
if (!svc.project_id) {
  console.error("FIREBASE_SERVICE_ACCOUNT secret is missing or invalid JSON. Aborting.");
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(svc) });
const db = admin.firestore();

// Optional: paste site-specific CSS selectors here if you want tighter
// extraction for a particular domain than the generic heuristics give you.
// Example:
//   "www.example.com": { price: ".price", outOfStock: ".sold-out-badge" }
const SITE_SELECTORS = {};

function log(...args) {
  console.log(new Date().toISOString(), "-", ...args);
}

function extractJsonLdProduct(jsonLdBlocks) {
  for (const raw of jsonLdBlocks) {
    let data;
    try { data = JSON.parse(raw); } catch (e) { continue; }
    const items = Array.isArray(data) ? data : (data["@graph"] || [data]);
    for (const item of items) {
      if (!item) continue;
      const type = item["@type"];
      const isProduct = type === "Product" || (Array.isArray(type) && type.includes("Product"));
      if (!isProduct) continue;
      let offers = item.offers;
      if (Array.isArray(offers)) offers = offers[0];
      if (!offers) continue;
      const price = offers.price != null ? Number(offers.price) : (offers.lowPrice != null ? Number(offers.lowPrice) : null);
      const currency = offers.priceCurrency || null;
      const availability = (offers.availability || "").toLowerCase();
      let inStock = null;
      if (availability.includes("instock") || availability.includes("in_stock")) inStock = true;
      else if (availability.includes("outofstock") || availability.includes("sold") || availability.includes("out_of_stock")) inStock = false;
      else if (availability.includes("limitedavailability") || availability.includes("preorder")) inStock = true;
      if (price != null || inStock != null) {
        return { price: (price != null && !isNaN(price)) ? price : null, currency, inStock };
      }
    }
  }
  return null;
}

function extractFromMeta(metaMap) {
  const price = metaMap["og:price:amount"] || metaMap["product:price:amount"] || metaMap["twitter:data1"];
  const currency = metaMap["og:price:currency"] || metaMap["product:price:currency"];
  const availabilityRaw = (metaMap["og:availability"] || metaMap["product:availability"] || "").toLowerCase();
  let inStock = null;
  if (availabilityRaw.includes("instock") || availabilityRaw.includes("in stock")) inStock = true;
  else if (availabilityRaw.includes("out of stock") || availabilityRaw.includes("oos")) inStock = false;
  const priceNum = price ? Number(String(price).replace(/[^0-9.]/g, "")) : null;
  if ((priceNum != null && !isNaN(priceNum)) || inStock != null) {
    return { price: (priceNum != null && !isNaN(priceNum)) ? priceNum : null, currency: currency || null, inStock };
  }
  return null;
}

function extractFromText(bodyText) {
  const t = bodyText.toLowerCase();
  const outPhrases = ["out of stock", "sold out", "currently unavailable", "no longer available", "coming soon"];
  const inPhrases = ["add to cart", "add to bag", "in stock", "buy now"];
  const hasOut = outPhrases.some(p => t.includes(p));
  const hasIn = inPhrases.some(p => t.includes(p));
  if (hasOut && !hasIn) return { price: null, currency: null, inStock: false };
  if (hasIn && !hasOut) return { price: null, currency: null, inStock: true };
  return null;
}

async function checkOne(browser, product) {
  const url = product.sourceUrl;
  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    // Give client-side rendered shops a moment to paint.
    await page.waitForTimeout(1500);

    const jsonLdBlocks = await page.$$eval('script[type="application/ld+json"]', els => els.map(e => e.textContent || ""));
    const metaMap = await page.$$eval("meta[property], meta[name]", els => {
      const m = {};
      els.forEach(e => {
        const k = e.getAttribute("property") || e.getAttribute("name");
        const v = e.getAttribute("content");
        if (k && v) m[k] = v;
      });
      return m;
    });
    const bodyText = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 20000) : "");

    let result = extractJsonLdProduct(jsonLdBlocks) || extractFromMeta(metaMap) || extractFromText(bodyText);

    if (!result || result.inStock == null) {
      return {
        ok: false,
        update: {
          status: "needs_manual_check",
          checkRequested: false,
          lastCheckedAt: new Date().toISOString(),
          lastNote: "Avtomatik yoxlama stok statusunu tapa bilmədi — əl ilə yoxlayın",
        },
      };
    }

    const update = {
      status: "ok",
      dataSource: "auto",
      inStock: result.inStock,
      checkRequested: false,
      lastCheckedAt: new Date().toISOString(),
      lastNote: result.inStock ? "Stokda (avtomatik yoxlanıldı)" : "Bitib (avtomatik yoxlanıldı)",
    };
    if (result.price != null) update.price = result.price;
    return { ok: true, update };
  } catch (err) {
    return {
      ok: false,
      update: {
        status: "needs_manual_check",
        checkRequested: false,
        lastCheckedAt: new Date().toISOString(),
        lastNote: "Sayt açılmadı və ya bloklandı — əl ilə yoxlayın",
      },
    };
  } finally {
    await page.close();
  }
}

async function main() {
  const snap = await db.collection("products").get();
  const products = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  const queue = products.filter(p => p.dataSource !== "manual" && p.sourceUrl);
  log(`${products.length} product(s) total, ${queue.length} eligible for automatic check.`);

  if (queue.length === 0) {
    log("Nothing to check. Done.");
    return;
  }

  const browser = await chromium.launch();
  let checked = 0, changed = 0;
  try {
    for (const product of queue) {
      const { ok, update } = await checkOne(browser, product);
      await db.collection("products").doc(product.id).update(update);
      checked++;
      if (ok && product.inStock !== update.inStock) changed++;
      log(`${product.code || product.id}: ${ok ? (update.inStock ? "in stock" : "sold out") : "needs manual check"}`);
    }
  } finally {
    await browser.close();
  }

  log(`Done. Checked ${checked} product(s), ${changed} stock-status change(s).`);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
