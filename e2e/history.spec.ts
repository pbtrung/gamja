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
	const reconnect = page.getByRole("button", { name: "Reconnect" });
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
