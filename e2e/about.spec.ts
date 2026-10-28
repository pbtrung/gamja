import { readFileSync } from "node:fs";
import { test, expect } from "./fixtures.ts";

test.use({ serverOptions: { bouncer: true, serverVersion: "soju-rs/0.99.31" } });

for (const width of [1280, 412]) {
	test(`shows versions in Settings About with no sidebar footer (${width}px)`, async ({
		page,
		connect,
	}) => {
		await page.setViewportSize({ width, height: 800 });
		await connect(page, "alice", { password: "secret" });
		await expect(page.locator(".sidebar-footer")).toHaveCount(0);
		await expect(page.getByTitle("gamja version")).toHaveCount(0);
		if (width < 968) {
			await page.getByRole("button", { name: "More actions" }).click();
			await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
			await page.getByRole("button", { name: "Settings sections" }).click();
			await page.getByRole("menuitemradio", { name: "About", exact: true }).click();
		} else {
			await page.getByRole("button", { name: "Settings", exact: true }).click();
			await page.getByRole("tab", { name: "About", exact: true }).click();
		}
		const response = await page.request.get("/version.json");
		const { version } = await response.json();
		await expect(page.getByTitle("gamja version")).toHaveText(version);
		await expect(page.getByText("soju-rs/0.99.31", { exact: true }).first()).toBeVisible();
		for (const name of [
			"react",
			"react-dom",
			"zustand",
			"lucide-react",
			"linkifyjs",
			"@fontsource-variable/inter",
			"vite",
		]) {
			const installed = JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8"));
			const row = page.locator(".settings-row").filter({ has: page.getByText(name, { exact: true }) });
			await expect(row.locator("dd")).toHaveText(installed.version);
		}
		await expect(page.getByRole("link", { name: "Source code" })).toBeVisible();
		const pane = page.locator(".settings-pane");
		expect(await pane.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
		await page.getByRole("button", { name: "Done", exact: true }).click();
		await expect(page.getByRole("dialog")).toHaveCount(0);
	});
}

test.describe("bouncer without a reported version", () => {
	test.use({ serverOptions: { bouncer: true, serverVersion: "soju" } });
	test("shows Not reported for a software name alone", async ({ page, connect }) => {
		await connect(page, "alice", { password: "secret" });
		await page.getByRole("button", { name: "Settings", exact: true }).click();
		await page.getByRole("tab", { name: "About", exact: true }).click();
		await expect(page.getByText("Not reported", { exact: true }).first()).toBeVisible();
	});
});

test.describe("plain IRC connection", () => {
	test.use({ serverOptions: { bouncer: false } });
	test("shows that no bouncer is connected", async ({ page, connect }) => {
		await connect(page);
		await page.getByRole("button", { name: "Settings", exact: true }).click();
		await page.getByRole("tab", { name: "About", exact: true }).click();
		await expect(page.getByText("No bouncer connected.", { exact: true })).toBeVisible();
	});
});
