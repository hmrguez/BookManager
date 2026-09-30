import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const baseURL = process.env.MARKETING_URL ?? "http://127.0.0.1:4321";
const browser = await chromium.launch({ headless: true });
const languages = ["en", "es", "de", "it", "fr"];
const output = [];
for (const language of languages) {
  const context = await browser.newContext({
      viewport: { width: 320, height: 844 },
      locale: "en-US",
    }),
    page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const route of ["/", "/privacy/", "/terms/", "/screenshots/library/"]) {
    const path = language === "en" ? route : `/${language}${route}`;
    const response = await page.goto(baseURL + path);
    assert.equal(response.status(), 200, path);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator("html").getAttribute("lang"), language);
    assert.equal(await page.locator('link[rel="alternate"]').count(), 6);
    assert.equal(
      await page.locator('link[rel="canonical"]').getAttribute("href"),
      "https://wovenleaf.app" + path,
    );
    assert.equal((await page.locator("h1, main img").count()) > 0, true);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      path + " mobile overflow",
    );
    await page.locator(".language-menu summary").click();
    for (const target of languages) {
      const href = target === "en" ? route : `/${target}${route}`;
      assert.equal(
        await page
          .locator(`.language-menu a[hreflang="${target}"]`)
          .getAttribute("href"),
        href,
      );
    }
    await page.locator(".language-menu summary").click();
    for (const image of await page.locator("img").all()) {
      await image.scrollIntoViewIfNeeded();
      await page.waitForFunction(
        (img) => img.complete && img.naturalWidth > 0,
        await image.elementHandle(),
        { timeout: 10000 },
      );
    }
    if (language !== "en" && ["/privacy/", "/terms/"].includes(route))
      assert.ok(
        (await page.locator(`.legal-main a[href="${route}"]`).count()) >= 1,
        path + " authoritative English link",
      );
    await page.setViewportSize({ width: 1280, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      path + " desktop overflow",
    );
    await page.setViewportSize({ width: 320, height: 844 });
    output.push(path);
  }
  assert.deepEqual(errors, []);
  await context.close();
}
const context = await browser.newContext({
    locale: "es-ES",
    viewport: { width: 390, height: 844 },
  }),
  page = await context.newPage();
await page.goto(baseURL + "/terms/");
assert.equal(new URL(page.url()).pathname, "/terms/");
assert.equal(await page.locator(".language-suggestion").isVisible(), true);
assert.equal(
  await page.locator(".language-suggestion-link").getAttribute("href"),
  baseURL + "/es/terms/",
);
await page.locator(".language-suggestion-link").click();
assert.equal(new URL(page.url()).pathname, "/es/terms/");
await page.goto(baseURL + "/terms/");
assert.equal(await page.locator(".language-suggestion").isVisible(), false);
await context.close();
await browser.close();
console.log(
  `PASS: ${output.length} localized production pages, responsive layouts, imagery, canonical links, page-preserving switches, and browser-language suggestion without redirect.`,
);
