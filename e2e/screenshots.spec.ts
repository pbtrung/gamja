import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures.ts";
import { THEMES } from "../src/themes.ts";

// Not a real test: renders screenshots of the main screens for visual review.
// Run with SCREENSHOTS=dir npx playwright test screenshots
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=<dir> to render screenshots");

const dir = () => process.env.SCREENSHOTS!;

test.beforeEach(async ({ page }) => {
	// No animations: screenshots don't need to wait for them to finish
	await page.emulateMedia({ reducedMotion: "reduce" });
});

/** Screenshot the open dialog, then close it */
async function shotDialog(page: Page, name: string) {
	await expect(page.getByRole("dialog")).toBeVisible();
	await page.screenshot({ path: `${dir()}/dialog-${name}.png` });
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).toBeHidden();
}

for (const scheme of ["light", "dark"] as const) {
	test(`screenshots (${scheme})`, async ({ page, connect, bot, settings }) => {
		// Follow the emulated color scheme rather than the default theme
		await settings({ theme: "system", layout: "comfortable" });
		await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
		await page.setViewportSize({ width: 1280, height: 760 });
		await page.goto("/?server=ws://invalid");
		await page.screenshot({ path: `${dir()}/connect-${scheme}.png` });

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
		const line = page.locator("#buffer .logline", { hasText: "reactions and replies" });
		await expect(line).toHaveAttribute("data-msgid", /.+/);
		const msgid = await line.getAttribute("data-msgid");
		carol.send(`@+draft/react=🎉;+draft/reply=${msgid} TAGMSG #gamja`);
		bob.send(`@+draft/react=👍;+draft/reply=${msgid} TAGMSG #gamja`);
		carol.privmsg("#gamja", "indeed!", { "+draft/reply": msgid! });
		bob.send("@+typing=active TAGMSG #gamja");
		const memberList = page.getByRole("button", { name: "Open member list" });
		if (await memberList.isVisible()) {
			await memberList.click();
		}
		await expect(page.locator("#buffer")).toContainText("indeed!");
		await expect(page.locator(".typing-indicator")).toContainText("bob is typing");
		await page.getByRole("textbox", { name: "Type a message" }).fill("Looks great!");
		await page.screenshot({ path: `${dir()}/chat-${scheme}.png` });
	});
}

test("theme screenshots", async ({ page, connect, bot }) => {
	await page.setViewportSize({ width: 1100, height: 640 });
	const bob = await bot("bob");
	await bob.join("#themes");
	bob.send("TOPIC #themes :Theme preview — https://example.org");
	await connect(page, "tester", { channels: ["#themes"] });
	bob.privmsg("#themes", "hello tester, how do you like this theme?");
	bob.privmsg("#themes", "links work too: https://soju.im and #gamja");
	await page.getByRole("textbox", { name: "Type a message" }).fill("pretty!");
	await page.keyboard.press("Enter");
	await expect(page.locator("#buffer")).toContainText("pretty!");
	for (const theme of THEMES.filter((t) => t.id !== "system").map((t) => t.id)) {
		await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
		await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
		await page.screenshot({ path: `${dir()}/theme-${theme}.png` });
	}
});

test("settings screenshots", async ({ page, connect }) => {
	for (const [width, height, name] of [
		[1280, 860, "desktop"],
		[390, 844, "mobile"],
	] as const) {
		await page.setViewportSize({ width, height });
		await connect(page, "tester", { channels: ["#gamja"] });
		await page.screenshot({ path: `${dir()}/sidebar-${name}.png` });
		if (name === "mobile") {
			await page.getByRole("button", { name: "Open buffer list" }).click();
		}
		await page.getByRole("tab", { name: "FakeNet" }).click();
		if (name === "mobile") {
			// Small screens put header actions in a menu
			await page.getByRole("button", { name: "More actions" }).click();
			await page.screenshot({ path: `${dir()}/header-menu-mobile.png` });
			await page.getByRole("menuitem", { name: "Settings" }).click();
		} else {
			await page.getByRole("button", { name: "Settings" }).click();
		}
		const body = page.locator(".dialog-body");
		await expect(body).toBeVisible();
		await page.screenshot({ path: `${dir()}/settings-${name}.png` });
		await body.evaluate((el) => (el.scrollTop = el.scrollHeight));
		await page.screenshot({ path: `${dir()}/settings-${name}-bottom.png` });
		await body.evaluate((el) => (el.scrollTop = 0));
		await page
			.locator("label.theme-option")
			.filter({ has: page.getByRole("radio", { name: "Light", exact: true }) })
			.click();
		await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
		await page.screenshot({ path: `${dir()}/settings-${name}-light.png` });
		await page.locator("label.theme-option", { hasText: "Dracula" }).click();
		await page.keyboard.press("Escape");
	}
});

for (const layout of ["comfortable", "compact"] as const) {
	test(`${layout} layout screenshots`, async ({ page, connect, bot, settings }) => {
		await settings({ layout });
		const bob = await bot("bob");
		await bob.join("#layout");
		await connect(page, "tester", { channels: ["#layout"] });
		bob.privmsg("#layout", `hi everyone, this is the ${layout} layout`);
		bob.send("PRIVMSG #layout :\x01ACTION waves\x01");
		bob.send("NOTICE #layout :a notice");
		await page.getByRole("textbox", { name: "Type a message" }).fill("looks neat");
		await page.keyboard.press("Enter");
		await expect(page.locator("#buffer")).toContainText("looks neat");
		// Small screens: no times, and the comfortable layout uses the compact style
		for (const [width, height, name] of [
			[1100, 520, "desktop"],
			[390, 700, "mobile"],
		] as const) {
			await page.setViewportSize({ width, height });
			await page.screenshot({ path: `${dir()}/${layout}-${name}.png` });
		}
	});
}

test.describe("bouncer dialog screenshots", () => {
	test.use({ serverOptions: { bouncer: true } });

	test("dialogs", async ({ page, connect, bot }) => {
		await page.setViewportSize({ width: 1100, height: 720 });
		const bob = await bot("bob");
		await bob.join("#dialogs");
		await connect(page, "alice", { password: "secret" });
		const tabs = page.getByRole("tablist", { name: "Buffer list" });

		await tabs.getByRole("tab", { name: "FakeNet" }).click();
		await page.getByRole("textbox", { name: /Type a command/ }).fill("/join #dialogs");
		await page.keyboard.press("Enter");
		await expect(tabs.getByRole("tab", { name: "#dialogs" })).toBeVisible();
		await tabs.getByRole("tab", { name: "FakeNet" }).click();
		await page.getByRole("button", { name: "Join channel" }).click();
		await shotDialog(page, "join");
		await page.getByRole("button", { name: "Manage network" }).click();
		await shotDialog(page, "network");
		await page.locator("#buffer").click();
		await page.keyboard.press("Control+k");
		await shotDialog(page, "switcher");
		await tabs.getByRole("tab", { name: "#dialogs" }).click();
		await page.getByRole("button", { name: "Search" }).click();
		await shotDialog(page, "search");
		await page.getByRole("textbox", { name: "Type a message" }).fill("/help");
		await page.keyboard.press("Enter");
		await shotDialog(page, "help");
		await tabs.getByRole("tab", { name: "bouncer" }).click();
		await page.getByRole("button", { name: "Add network" }).first().click();
		await shotDialog(page, "add-network");
	});
});

test("account dialog screenshots", async ({ page, connect }) => {
	await page.setViewportSize({ width: 1100, height: 720 });
	await connect(page, "tester");
	await page.getByRole("link", { name: "login" }).click();
	await shotDialog(page, "auth");
	await page.getByRole("link", { name: "register", exact: true }).click();
	await shotDialog(page, "register");
});
