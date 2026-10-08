import { test, expect } from "./fixtures.ts";

test("searches messages and jumps to a result", async ({ page, connect, bot }) => {
	const bob = await bot("bob");
	await bob.join("#search");
	await connect(page, "tester", { channels: ["#search"] });
	await expect(page.locator("#buffer-header h1")).toHaveText("#search");

	bob.privmsg("#search", "the quick brown fox");
	bob.privmsg("#search", "jumps over the lazy dog");
	await expect(page.locator("#buffer")).toContainText("lazy dog");

	await page.getByRole("button", { name: "Search" }).click();
	const dialog = page.getByRole("dialog", { name: "Search FakeNet" });
	await dialog.getByRole("searchbox").fill("brown");
	await dialog.getByRole("searchbox").press("Enter");
	await expect(dialog.getByRole("status")).toHaveText("1 message found");
	await dialog.getByRole("button", { name: /quick brown fox/ }).click();
	await expect(dialog).toBeHidden();
	await expect(page.locator("#buffer .logline.flash")).toContainText("quick brown fox");
});
