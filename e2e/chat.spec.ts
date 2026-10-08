import { test, expect } from "./fixtures.ts";

test("connects and shows the server buffer", async ({ page, connect }) => {
	await connect(page);
	await expect(page.locator("#buffer")).toContainText("Connected to server, your nickname is tester");
	await expect(page.locator("#buffer")).toContainText("Welcome to the fake IRC server");
	await expect(page.getByRole("tab", { name: "FakeNet" })).toHaveAttribute("aria-selected", "true");
	await expect(page).toHaveTitle(/gamja/);
});

test("joins a channel and chats with another user", async ({ page, connect, bot }) => {
	const bob = await bot("bob");
	await bob.join("#test");

	await connect(page);
	await page.keyboard.type("/join #test");
	await page.keyboard.press("Enter");

	await expect(page.locator("#buffer-header h1")).toHaveText("#test");
	await expect(page.locator(".member-items")).toContainText("bob");

	// Send a message
	const composer = page.getByRole("textbox", { name: "Type a message" });
	await composer.fill("hello bob");
	await composer.press("Enter");
	await bob.waitFor((l) => l.includes("PRIVMSG #test :hello bob"));
	await expect(page.locator("#buffer .talk").last()).toContainText("hello bob");
	await expect(composer).toHaveValue("");

	// Receive a message, with formatting and a link
	bob.privmsg("#test", "check \x02this\x02 out: https://example.org/");
	const line = page.locator("#buffer .talk").last();
	await expect(line).toContainText("check this out");
	await expect(line.locator(".fmt-bold")).toHaveText("this");
	await expect(line.getByRole("link", { name: "https://example.org/" })).toHaveAttribute(
		"target",
		"_blank",
	);
});

test("highlights and private messages mark buffers unread", async ({ page, connect, bot }) => {
	const bob = await bot("bob");
	await bob.join("#test");
	await connect(page, "tester", { channels: ["#test"] });
	await expect(page.locator("#buffer-header h1")).toHaveText("#test");

	// Switch away, then get mentioned
	await page.getByRole("tab", { name: "FakeNet" }).click();
	bob.privmsg("#test", "tester: ping");
	await expect(page.locator(".buffer-items li.unread-highlight")).toContainText("#test");

	// A private message opens a new buffer
	bob.privmsg("tester", "psst");
	const query = page.getByRole("tab", { name: "bob" });
	await expect(query).toBeVisible();
	await query.click();
	await expect(page.locator("#buffer")).toContainText("psst");
	await expect(page.locator("#buffer-header")).toContainText("bob the bot");
});

test("switches buffers with the keyboard switcher", async ({ page, connect, bot }) => {
	const bob = await bot("bob");
	await bob.join("#alpha");
	await bob.join("#beta");
	await connect(page, "tester", { channels: ["#alpha", "#beta"] });
	await expect(page.getByRole("tab", { name: "#beta" })).toBeVisible();

	await page.locator("#buffer").click();
	await page.keyboard.press("Control+k");
	const dialog = page.getByRole("dialog", { name: "Switch to a channel or user" });
	await expect(dialog).toBeVisible();
	await page.keyboard.type("alp");
	await page.keyboard.press("Enter");
	await expect(dialog).toBeHidden();
	await expect(page.locator("#buffer-header h1")).toHaveText("#alpha");
});

test("leaves a channel", async ({ page, connect, bot }) => {
	const bob = await bot("bob");
	await bob.join("#bye");
	await connect(page, "tester", { channels: ["#bye"] });
	await expect(page.locator("#buffer-header h1")).toHaveText("#bye");
	await page.getByRole("button", { name: "Leave" }).click();
	await bob.waitFor((l) => l.includes("PART #bye"));
	await expect(page.getByRole("tab", { name: "#bye" })).toHaveCount(0);
	await expect(page.locator("#buffer-header h1")).toHaveText("FakeNet");
});

test("shows errors for unknown commands", async ({ page, connect }) => {
	await connect(page);
	await page.keyboard.type("/frobnicate");
	await page.keyboard.press("Enter");
	await expect(page.getByRole("alert")).toContainText('Unknown command "frobnicate"');
	await page.getByRole("button", { name: "Dismiss" }).click();
	await expect(page.getByRole("alert")).toHaveCount(0);
});

test("logs in with SASL", async ({ page, connect }) => {
	await connect(page, "alice", { password: "secret" });
	await expect(page.locator("#buffer")).toContainText("You are now authenticated as alice");
});

test("rejects bad SASL credentials", async ({ page, ircd }) => {
	await page.goto(`/?server=ws://localhost:${ircd.port}`);
	await page.getByLabel("Nickname").fill("alice");
	await page.getByLabel("Password", { exact: true }).fill("wrong");
	await page.getByRole("button", { name: "Connect" }).click();
	await expect(page.getByRole("alert")).toContainText("SASL authentication failed");
});
