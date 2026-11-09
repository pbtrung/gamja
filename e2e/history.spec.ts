import { test, expect } from "./fixtures.ts";

test("loads the latest missed messages on reconnect, the rest on demand", async ({
	page,
	connect,
	bot,
	ircd,
	settings,
}) => {
	await settings({ backlogSize: 100 });
	const bob = await bot("bob");
	await connect(page, "tester");
	bob.privmsg("tester", "before the gap");
	const query = page.getByRole("tab", { name: "bob" });
	await query.click();
	await expect(page.locator("#buffer")).toContainText("before the gap");

	await page.getByRole("tab", { name: "FakeNet" }).click();
	for (const c of ircd.conns) {
		if (c.nick === "tester") {
			c.ws.terminate();
		}
	}
	const reconnect = page.getByRole("button", { name: "Reconnect", exact: true });
	await expect(reconnect).toBeVisible();
	for (let i = 0; i < 150; i++) {
		ircd.recordMissedMessage("bob", "tester", `missed ${i}`);
	}

	await reconnect.click();
	await expect(page.locator("#buffer")).toContainText("Connected to server", { timeout: 10000 });
	await query.click();
	const buffer = page.locator("#buffer");
	await expect(buffer).toContainText("missed 149");
	// Only the latest 100 were loaded
	await expect(buffer.locator(".logline", { hasText: /missed 49$/ })).toHaveCount(0);
	await expect(buffer.locator(".logline", { hasText: /missed 50$/ })).toHaveCount(1);
	const load = page.getByRole("button", { name: "Load missed messages" });
	await expect(load).toBeVisible();

	await load.click();
	await expect(load).toHaveCount(0);
	const texts = await buffer.locator(".logline", { hasText: /missed \d+$/ }).allInnerTexts();
	const order = texts.map((t) => Number(/missed (\d+)$/.exec(t.trim())![1]));
	expect(order).toEqual([...Array(150).keys()]);
});

test("scrolls to the latest messages from a button", async ({ page, connect, bot }) => {
	const bob = await bot("bob");
	await bob.join("#scroll");
	await connect(page, "tester", { channels: ["#scroll"] });
	await expect(page.locator("#buffer-header h1")).toHaveText("#scroll");
	for (let i = 0; i < 80; i++) {
		bob.privmsg("#scroll", `line ${i}`);
	}
	const last = page.locator("#buffer .logline", { hasText: "line 79" });
	await expect(last).toBeInViewport();

	const button = page.getByRole("button", { name: "Scroll to latest messages" });
	await expect(button).toHaveCount(0);
	await page.locator("#buffer").evaluate((el) => (el.scrollTop = 0));
	await expect(button).toBeVisible();
	await button.click();
	await expect(last).toBeInViewport();
	await expect(button).toHaveCount(0);
});

test("shows a loaded count, fills missed history in configured pages, and reveals the exact total", async ({
	page,
	connect,
	bot,
	ircd,
	settings,
}) => {
	await settings({ backlogSize: 200, bufferEvents: "hide" });
	const bob = await bot("bob");
	await connect(page, "tester");
	bob.privmsg("tester", "before the gap");
	const query = page.getByRole("tab", { name: "bob" });
	await query.click();
	await expect(page.locator("#buffer")).toContainText("before the gap");
	await expect.poll(() => ircd.readMarkers.get("tester\0bob")).toBeDefined();
	const read = ircd.readMarkers.get("tester\0bob");
	await page.getByRole("tab", { name: "FakeNet" }).click();
	for (const c of ircd.conns) {
		if (c.nick === "tester") {
			c.ws.terminate();
		}
	}
	const reconnect = page.getByRole("button", { name: "Reconnect", exact: true });
	await expect(reconnect).toBeVisible();
	for (let i = 0; i < 451; i++) {
		ircd.recordMissedMessage("bob", "tester", `missed ${i}`);
	}
	await reconnect.click();
	await expect(page.locator("#buffer")).toContainText("Connected to server", { timeout: 10000 });
	await query.click();
	const buffer = page.locator("#buffer");
	const missed = buffer.locator(".logline", { hasText: /missed \d+$/ });
	await expect(missed).toHaveCount(200);
	await expect(buffer.locator(".unread-separator")).toHaveAccessibleName(
		/^200 loaded · more available · since /,
	);
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(buffer.locator(".unread-compact")).toBeVisible();
	await expect(buffer.locator(".unread-compact")).toHaveText("200 loaded · more");
	await expect(buffer.locator(".unread-detail")).toBeHidden();
	const countBounds = await buffer.locator(".unread-compact").boundingBox();
	const timeBounds = await buffer.locator(".unread-since").boundingBox();
	expect(timeBounds!.y).toBeGreaterThan(countBounds!.y);
	await page.setViewportSize({ width: 1280, height: 720 });
	await expect(buffer.locator(".unread-detail")).toBeVisible();
	const pill = page.getByRole("button", { name: /^200\+ new since / });
	await expect(pill).toBeVisible();
	await expect.poll(() => ircd.readMarkers.get("tester\0bob")).not.toBe(read);
	const latestRead = ircd.readMarkers.get("tester\0bob");
	await pill.click();
	await expect(buffer.locator(".unread-separator")).toBeInViewport();
	await buffer.evaluate((el) => {
		el.scrollTop = 0;
	});
	await expect(missed).toHaveCount(400);
	await expect(buffer.locator(".unread-separator")).toHaveAccessibleName(
		/^400 loaded · more available · since /,
	);
	await expect(page.getByRole("group", { name: "New messages" })).toHaveCount(0);
	expect(ircd.readMarkers.get("tester\0bob")).toBe(latestRead);
	await buffer.evaluate((el) => {
		el.scrollTop = 100;
	});
	await buffer.evaluate((el) => {
		el.scrollTop = 0;
	});
	await expect(missed).toHaveCount(451);
	await expect(buffer.locator(".unread-separator")).toHaveAccessibleName(/^451 new · all loaded · since /);
});
