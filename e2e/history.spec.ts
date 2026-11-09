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

	// Scrolling up to the gap loads it automatically. Clicking the button
	// can race that load when the browser first scrolls it into view.
	await buffer.evaluate((el) => {
		el.scrollTop = 0;
	});
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
	await page.clock.install();
	await page.clock.pauseAt(new Date());
	await buffer.evaluate((el) => {
		el.scrollTop = 100;
	});
	await buffer.evaluate((el) => {
		el.scrollTop = 0;
	});
	await expect(missed).toHaveCount(451);
	await expect(buffer.locator(".unread-separator")).toHaveAccessibleName(/^451 new · all loaded · since /);
	const divider = buffer.locator(".unread-separator");
	await expect(divider).toBeInViewport();
	await page.clock.runFor(7000);
	await expect(divider).toBeInViewport();
	await buffer.evaluate((el) => {
		el.scrollTop = el.scrollHeight;
	});
	await page.clock.runFor(1000);
	await buffer.evaluate((el) => {
		el.scrollTop = 0;
	});
	await expect(divider).toBeInViewport();
	await page.clock.runFor(7000);
	await expect(divider).toBeInViewport();
	await page.clock.runFor(1500);
	await expect(divider).toHaveCount(0);
});

test("adds DD/MM/YY for old read markers while keeping the mobile pill on one line at 320px", async ({
	page,
	connect,
	ircd,
	settings,
}) => {
	await settings({ backlogSize: 200, bufferEvents: "hide", clock12h: true });
	const old = new Date(2024, 0, 1, 12, 30).toISOString();
	ircd.readMarkers.set("tester\0bob", old);
	for (let i = 0; i < 200; i++) {
		ircd.recordMissedMessage("bob", "tester", `old backlog ${i}`);
	}
	await page.addInitScript(
		({ url, time }) => {
			localStorage.setItem(
				"gamja_buffers",
				JSON.stringify({
					saved: {
						name: "bob",
						unread: "",
						closed: false,
						server: { url, bouncerNetwork: null },
						receipts: { read: { time }, delivered: { time } },
					},
				}),
			);
		},
		{ url: `ws://localhost:${ircd.port}`, time: old },
	);
	await connect(page, "tester");
	await page.getByRole("tab", { name: "bob" }).click();
	const pill = page.getByRole("button", { name: /^200\+ new since 01\/01\/24 / });
	await expect(pill).toBeVisible();
	await page.setViewportSize({ width: 320, height: 720 });
	const compact = page.locator(".jump-label-compact");
	await expect(compact).toBeVisible();
	await expect(compact).toHaveText(/^200\+ new · 01\/01\/24 \d{2}:\d{2} [AP]M$/);
	await expect(page.locator(".jump-label-wide")).toBeHidden();
	const metrics = await compact.evaluate((el) => {
		const style = getComputedStyle(el);
		const pill = el.closest(".jump-pill")!.getBoundingClientRect();
		return {
			whiteSpace: style.whiteSpace,
			fits: el.scrollWidth <= el.clientWidth,
			oneLine: el.getBoundingClientRect().height <= parseFloat(style.lineHeight) + 1,
			insideScreen: pill.left >= 0 && pill.right <= window.innerWidth,
		};
	});
	expect(metrics).toEqual({ whiteSpace: "nowrap", fits: true, oneLine: true, insideScreen: true });
	await expect(page.locator(".unread-separator")).toHaveAccessibleName(
		/^200 loaded · more available · since 01\/01\/24 /,
	);
	await expect(page.locator(".unread-since")).toHaveText(/^since 01\/01\/24 /);
});
