import { test, expect } from "./fixtures.ts";

const bodyBg = (page: import("@playwright/test").Page) =>
	page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test("switches and remembers the theme", async ({ page, connect }) => {
	await page.emulateMedia({ colorScheme: "light" });
	await connect(page);
	expect(await bodyBg(page)).toBe("rgb(40, 42, 54)");

	await page.getByRole("button", { name: "Settings" }).click();
	await page
		.locator("label.theme-option")
		.filter({ has: page.getByRole("radio", { name: "Light", exact: true }) })
		.click();
	await expect(page.getByRole("radio", { name: "Light", exact: true })).toBeChecked();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
	expect(await bodyBg(page)).toBe("rgb(255, 255, 255)");

	await page.reload();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
	expect(await bodyBg(page)).toBe("rgb(255, 255, 255)");
});

test("uses Dracula by default", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "light" });
	await page.goto("/?server=ws://invalid");
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dracula");
	expect(await bodyBg(page)).toBe("rgb(40, 42, 54)");
});

test("follows the system color scheme when picked", async ({ page, connect }) => {
	await page.emulateMedia({ colorScheme: "dark" });
	await connect(page);
	await page.getByRole("button", { name: "Settings" }).click();
	await page.locator("label.theme-option", { hasText: "System" }).click();
	await expect(page.locator("html")).not.toHaveAttribute("data-theme");
	expect(await bodyBg(page)).toBe("rgb(22, 24, 29)");
});
