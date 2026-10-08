import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures.ts";
import { THEMES } from "../src/themes.ts";

// Audit without animations, which would be measured mid-fade
test.beforeEach(async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
});

async function audit(page: Page) {
	const results = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
		.analyze();
	const summary = results.violations.flatMap((v) =>
		v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}: ${n.failureSummary}`),
	);
	expect(summary).toEqual([]);
}

test("connect form is accessible", async ({ page }) => {
	await page.goto("/?server=ws://invalid");
	await audit(page);
});

test("chat and dialogs are accessible", async ({ page, connect, bot }) => {
	const bob = await bot("bob");
	await bob.join("#a11y");
	await connect(page, "tester", { channels: ["#a11y"] });
	await expect(page.locator("#buffer-header h1")).toHaveText("#a11y");
	bob.privmsg("#a11y", "hello tester https://example.org");
	await expect(page.locator("#buffer")).toContainText("hello tester");
	await audit(page);

	await page.getByRole("button", { name: "Open settings" }).click();
	await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
	await audit(page);
	await page.keyboard.press("Escape");

	await page.keyboard.press("Control+k");
	await expect(page.getByRole("dialog")).toBeVisible();
	await audit(page);
});

for (const theme of THEMES.filter((t) => t.id !== "system")) {
	test(`${theme.name} theme has sufficient contrast`, async ({ page, connect, bot }) => {
		const bob = await bot("bob");
		await bob.join("#contrast");
		await connect(page, "tester", { channels: ["#contrast"] });
		bob.privmsg("#contrast", "tester: mentions, links https://example.org and #channels");
		await expect(page.locator("#buffer")).toContainText("mentions");
		await page.evaluate((id) => (document.documentElement.dataset.theme = id), theme.id);
		await page.waitForTimeout(100);
		const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
		const summary = results.violations.flatMap((v) =>
			v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary}`),
		);
		expect(summary).toEqual([]);
	});
}
