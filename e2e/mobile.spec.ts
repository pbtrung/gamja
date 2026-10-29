import { test, expect } from "./fixtures.ts";

test("opens the buffer list from the header on small screens", async ({ page, connect, bot }) => {
	const bob = await bot("bob");
	await bob.join("#m");
	await connect(page, "tester", { channels: ["#m"] });
	await expect(page.locator("#buffer-header h1")).toHaveText("#m");

	await expect(page.locator("#buffer-list")).toBeHidden();
	await page.getByRole("button", { name: "Open buffer list" }).click();
	await expect(page.locator("#buffer-list")).toBeVisible();
	await expect(page.getByRole("button", { name: "Close buffer list" })).toHaveCount(0);
	await page.getByRole("tab", { name: "FakeNet" }).click();
	await expect(page.locator("#buffer-list")).toBeHidden();
	await expect(page.locator("#buffer-header h1")).toHaveText("FakeNet");
	// The on-screen keyboard would cover the buffer
	await expect(page.locator("#composer textarea")).not.toBeFocused();
});

for (const layout of ["comfortable", "compact", "columns", "bubbles"] as const) {
	test(`shows compact message times on small screens (${layout})`, async ({
		page,
		connect,
		bot,
		settings,
	}) => {
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
			await expect(ts).toBeVisible();
		}
		// No room for avatars, sender columns or bubbles: the compact style is used
		await expect(page.locator("#buffer .logline:is(.comfortable, .columns, .bubbles)")).toHaveCount(0);
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

test("opens member actions by tapping a nick on touch screens", async ({ page, connect, bot }) => {
	const bob = await bot("bob");
	await bob.join("#tap");
	await connect(page, "tester", { channels: ["#tap"] });
	await expect(page.locator("#buffer-header h1")).toHaveText("#tap");
	await page.getByRole("button", { name: "Open member list" }).click();
	const members = page.locator("#member-list");
	await expect(page.getByRole("button", { name: "Close member list" })).toHaveCount(0);
	await expect(members.getByRole("button", { name: "Actions for bob" })).toBeHidden();
	await members.getByRole("link", { name: "@bob" }).tap();
	const menu = page.getByRole("menu", { name: "Actions for bob" });
	await expect(menu).toBeVisible();
	const box = (await menu.boundingBox())!;
	expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
	await page.getByRole("menuitem", { name: "Send message" }).click();
	await expect(page.locator("#buffer-header h1")).toHaveText("bob");
});

test("honors the timestamp preference on mobile", async ({ page, connect, bot, settings }) => {
	await settings({ showTimestamps: false });
	const bob = await bot("bob");
	await bob.join("#no-times");
	await connect(page, "tester", { channels: ["#no-times"] });
	bob.privmsg("#no-times", "without a clock");
	const line = page.locator("#buffer .logline", { hasText: "without a clock" });
	await expect(line).toBeVisible();
	await expect(line.locator(".timestamp")).toBeHidden();
});

test("opens and closes the side panels by swiping", async ({ page, connect, bot }) => {
	const bob = await bot("bob");
	await bob.join("#swipe");
	await connect(page, "tester", { channels: ["#swipe"] });
	await expect(page.locator("#buffer-header h1")).toHaveText("#swipe");
	const swipe = (fromX: number, toX: number) =>
		page.locator("#buffer").evaluate(
			(el, [fromX, toX]) => {
				const point = (x: number) =>
					new Touch({ identifier: 1, target: el, clientX: x, clientY: 300 });
				el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [point(fromX)] }));
				el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, changedTouches: [point(toX)] }));
			},
			[fromX, toX],
		);

	await swipe(20, 300);
	await expect(page.locator("#buffer-list")).toBeVisible();
	await swipe(300, 20);
	await expect(page.locator("#buffer-list")).toBeHidden();
	await swipe(300, 20);
	await expect(page.locator("#member-list")).toBeVisible();
	await swipe(20, 300);
	await expect(page.locator("#member-list")).toBeHidden();
});
