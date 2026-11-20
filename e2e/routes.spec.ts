import { test, expect } from "./fixtures";
import { PAGES, seedScript, type Theme } from "./seed";

// Every one of the 21 pages, loaded directly at its own address, in both themes and at desktop and phone width: it renders with its title, the saved
// theme is applied, nothing throws, nothing logs, nothing scrolls sideways at 375px.
const VIEWPORTS = [
  { name: "1280px", width: 1280, height: 900 },
  { name: "375px", width: 375, height: 800 },
];

for (const theme of ["dark", "light"] as Theme[]) {
  for (const vp of VIEWPORTS) {
    test.describe(`${theme} theme at ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });
      test.beforeEach(async ({ context }) => {
        await context.addInitScript(seedScript({ theme }));
      });

      for (const [path, title] of PAGES) {
        test(`${path} renders as "${title}"`, async ({ page }) => {
          await page.goto(path);
          await expect(page.locator("header .font-display")).toHaveText(title);
          expect(new URL(page.url()).pathname).toBe(path);
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
          await expect(page.locator("main")).not.toBeEmpty();
          if (vp.width < 500) {
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
            expect(overflow, "horizontal scroll").toBe(false);
          }
        });
      }
    });
  }
}
