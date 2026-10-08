import { test, expect } from "./fixtures.ts";

// Not a real test: renders screenshots of the main screens for visual review.
// Run with SCREENSHOTS=dir npx playwright test screenshots
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=<dir> to render screenshots");

for (const scheme of ["light", "dark"] as const) {
	test(`screenshots (${scheme})`, async ({ page, connect, bot }) => {
		await page.emulateMedia({ colorScheme: scheme });
		await page.setViewportSize({ width: 1280, height: 760 });
		const dir = process.env.SCREENSHOTS!;
		await page.goto("/?server=ws://invalid");
		await page.screenshot({ path: `${dir}/connect-${scheme}.png` });

		const bob = await bot("bob");
		const carol = await bot("carol");
		await bob.join("#gamja");
		await carol.join("#gamja");
		bob.send("TOPIC #gamja :Welcome to #gamja — the \x02modern\x02 IRC web client https://example.org");
		await connect(page, "tester", { channels: ["#gamja", "#other"] });
		await page.getByRole("tab", { name: "#gamja" }).click();
		bob.privmsg("#gamja", "hi everyone!");
		carol.privmsg("#gamja", "hey bob, check https://soju.im");
		bob.privmsg("#gamja", "tester: what do you think of the new UI?");
		carol.send("PRIVMSG #gamja :\x01ACTION waves\x01");
		bob.privmsg("#gamja", "the reactions and replies work too");
		await page.waitForTimeout(200);
		const line = page.locator("#buffer .logline", { hasText: "reactions and replies" });
		const msgid = await line.getAttribute("data-msgid");
		carol.send(`@+draft/react=🎉;+draft/reply=${msgid} TAGMSG #gamja`);
		bob.send(`@+draft/react=👍;+draft/reply=${msgid} TAGMSG #gamja`);
		carol.privmsg("#gamja", "indeed!", { "+draft/reply": msgid! });
		bob.send("@+typing=active TAGMSG #gamja");
		await page
			.getByRole("button", { name: "Open member list" })
			.click()
			.catch(() => {});
		await page.waitForTimeout(300);
		await page.getByRole("textbox", { name: "Type a message" }).fill("Looks great!");
		await page.screenshot({ path: `${dir}/chat-${scheme}.png` });
	});
}

test("theme screenshots", async ({ page, connect, bot }) => {
	const dir = process.env.SCREENSHOTS!;
	await page.setViewportSize({ width: 1100, height: 640 });
	const bob = await bot("bob");
	await bob.join("#themes");
	bob.send("TOPIC #themes :Theme preview — https://example.org");
	await connect(page, "tester", { channels: ["#themes"] });
	bob.privmsg("#themes", "hello tester, how do you like this theme?");
	bob.privmsg("#themes", "links work too: https://soju.im and #gamja");
	await page.getByRole("textbox", { name: "Type a message" }).fill("pretty!");
	await page.keyboard.press("Enter");
	for (const theme of [
		"dracula",
		"catppuccin-latte",
		"catppuccin-mocha",
		"solarized-light",
		"solarized-dark",
		"zenburn",
	]) {
		await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
		await page.waitForTimeout(300);
		await page.screenshot({ path: `${dir}/theme-${theme}.png` });
	}
});

test("settings screenshots", async ({ page, connect }) => {
	const dir = process.env.SCREENSHOTS!;
	for (const [width, height, name] of [
		[1280, 860, "desktop"],
		[390, 844, "mobile"],
	] as const) {
		await page.setViewportSize({ width, height });
		await connect(page, "tester", { channels: ["#gamja"] });
		await page.screenshot({ path: `${dir}/sidebar-${name}.png` });
		if (name === "mobile") {
			await page.getByRole("button", { name: "Open buffer list" }).click();
		}
		await page.getByRole("tab", { name: "FakeNet" }).click();
		await page.getByRole("button", { name: "Settings" }).click();
		await page.waitForTimeout(300);
		await page.screenshot({ path: `${dir}/settings-${name}.png` });
		await page.locator(".dialog-body").evaluate((el) => (el.scrollTop = el.scrollHeight));
		await page.waitForTimeout(100);
		await page.screenshot({ path: `${dir}/settings-${name}-bottom.png` });
		await page.locator(".dialog-body").evaluate((el) => (el.scrollTop = 0));
		await page
			.locator("label.theme-option")
			.filter({ has: page.getByRole("radio", { name: "Light", exact: true }) })
			.click();
		await page.waitForTimeout(300);
		await page.screenshot({ path: `${dir}/settings-${name}-light.png` });
		await page.locator("label.theme-option", { hasText: "Dracula" }).click();
		await page.keyboard.press("Escape");
	}
});

test("compact layout screenshots", async ({ page, connect, bot }) => {
	const dir = process.env.SCREENSHOTS!;
	await page.addInitScript(() =>
		localStorage.setItem("gamja_settings", JSON.stringify({ layout: "compact" })),
	);
	const bob = await bot("bob");
	const longnick = await bot("averyveryverylongnick");
	await bob.join("#compact");
	await connect(page, "tester", { channels: ["#compact"] });
	await longnick.join("#compact");
	bob.privmsg("#compact", "hi everyone, nicks line up in a column like WeeChat");
	longnick.privmsg("#compact", "long nicks are truncated");
	bob.send("PRIVMSG #compact :\x01ACTION waves\x01");
	bob.send("NOTICE #compact :a notice");
	await page.getByRole("textbox", { name: "Type a message" }).fill("looks neat");
	await page.keyboard.press("Enter");
	await expect(page.locator("#buffer")).toContainText("looks neat");
	for (const [width, height, name] of [
		[1100, 520, "desktop"],
		[390, 700, "mobile"],
	] as const) {
		await page.setViewportSize({ width, height });
		await page.waitForTimeout(200);
		await page.screenshot({ path: `${dir}/compact-${name}.png` });
	}
});
