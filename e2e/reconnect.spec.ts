import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures.ts";

for (const width of [1280, 393]) {
	test(`shows reconnection status and preserves the composer draft (${width}px)`, async ({
		page,
		connect,
		bot,
		ircd,
	}) => {
		await page.setViewportSize({ width, height: 850 });
		await page.emulateMedia({ reducedMotion: "no-preference" });
		const bob = await bot("bob");
		await bob.join("#reconnect");
		await connect(page, "tester", { channels: ["#reconnect"] });
		const input = page.locator("#composer textarea");
		await input.fill("keep this draft");
		await page.clock.install();
		for (const conn of ircd.conns) {
			if (conn.nick === "tester") {
				conn.ws.close(1000);
			}
		}
		const banner = page.locator(".reconnect-banner");
		await expect(banner).toBeVisible();
		await expect(banner).toHaveText("Connection to FakeNet lost. Reconnecting…");
		await expect(banner.getByRole("button")).toHaveCount(0);
		await expect(input).toBeHidden();
		await expect(page.locator("#buffer-header h1")).toHaveText("#reconnect");
		const spinner = banner.locator(".reconnect-spinner");
		await expect(spinner).toHaveCSS("animation-name", "spin");
		await page.emulateMedia({ reducedMotion: "reduce" });
		await expect(spinner).toHaveCSS("animation-name", "none");
		const box = (await banner.boundingBox())!;
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(width);
		const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
		expect(audit.violations.map((v) => `${v.id}: ${v.description}`)).toEqual([]);
		await page.clock.fastForward(10_000);
		await expect(banner).toHaveCount(0);
		await expect(input).toBeVisible();
		await expect(input).toHaveValue("keep this draft");
	});
}
