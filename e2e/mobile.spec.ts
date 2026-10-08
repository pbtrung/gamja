import { test, expect } from "./fixtures.ts";

test("opens the buffer and member lists from the header on small screens", async ({ page, connect, bot }) => {
	const bob = await bot("bob");
	await bob.join("#m");
	await connect(page, "tester", { channels: ["#m"] });
	await expect(page.locator("#buffer-header h1")).toHaveText("#m");

	await expect(page.locator("#buffer-list")).toBeHidden();
	await page.getByRole("button", { name: "Open buffer list" }).click();
	await expect(page.locator("#buffer-list")).toBeVisible();
	await page.getByRole("tab", { name: "FakeNet" }).click();
	await expect(page.locator("#buffer-list")).toBeHidden();
	await expect(page.locator("#buffer-header h1")).toHaveText("FakeNet");
});
