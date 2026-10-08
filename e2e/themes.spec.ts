import { test, expect } from "./fixtures.ts";

test("switches and remembers the theme", async ({ page, connect }) => {
	await page.emulateMedia({ colorScheme: "light" });
	await connect(page);
	const bodyBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
	expect(await bodyBg()).toBe("rgb(255, 255, 255)");

	await page.getByRole("button", { name: "Settings" }).click();
	await page.locator("label.theme-option", { hasText: "Dracula" }).click();
	await expect(page.getByRole("radio", { name: "Dracula" })).toBeChecked();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dracula");
	expect(await bodyBg()).toBe("rgb(40, 42, 54)");

	await page.reload();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dracula");
	expect(await bodyBg()).toBe("rgb(40, 42, 54)");
});

test("follows the system color scheme by default", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "dark" });
	await page.goto("/?server=ws://invalid");
	expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
		"rgb(22, 24, 29)",
	);
});
