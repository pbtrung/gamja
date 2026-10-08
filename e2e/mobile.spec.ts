import { test, expect } from "./fixtures.ts";

test("opens the buffer list from the header on small screens", async ({ page, connect, bot }) => {
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

for (const layout of ["comfortable", "compact"] as const) {
	test(`hides message times on small screens (${layout})`, async ({ page, connect, bot, settings }) => {
		await settings({ layout });
		const bob = await bot("bob");
		await bob.join("#t");
		await connect(page, "tester", { channels: ["#t"] });
		bob.privmsg("#t", "what time is it?");
		const line = page.locator("#buffer .logline", { hasText: "what time is it?" });
		await expect(line).toBeVisible();
		const times = await line.locator(".timestamp").all();
		expect(times.length).toBeGreaterThan(0);
		for (const ts of times) {
			await expect(ts).toBeHidden();
		}
		// No room for avatars and sender headers: the compact style is used
		await expect(page.locator("#buffer .logline.comfortable")).toHaveCount(0);
	});
}

test("opens header actions from a menu on small screens", async ({ page, connect, bot }) => {
	const bob = await bot("bob");
	await bob.join("#menu");
	await connect(page, "tester", { channels: ["#menu"] });
	await expect(page.locator("#buffer-header h1")).toHaveText("#menu");
	const header = page.locator("#buffer-header");
	await expect(header.getByRole("button")).toHaveCount(3);
	await header.getByRole("button", { name: "More actions" }).click();
	await page.getByRole("menuitem", { name: "Leave" }).click();
	await expect(header.getByRole("button", { name: "More actions" })).toBeVisible();
	await header.getByRole("button", { name: "More actions" }).click();
	await expect(page.getByRole("menuitem", { name: "Join" })).toBeVisible();
});
