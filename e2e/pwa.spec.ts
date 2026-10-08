import { test, expect } from "./fixtures.ts";

test("serves the service worker and web app manifest", async ({ request }) => {
	const sw = await request.get("/sw.js");
	expect(sw.ok()).toBe(true);
	expect(sw.headers()["content-type"]).toMatch(/javascript/);
	expect(await sw.text()).toContain("showNotification");

	const manifest = await request.get("/manifest.json");
	expect((await manifest.json()).short_name).toBe("gamja");
});

test("offers push notifications when the server supports them", async ({ page, connect, context }) => {
	await context.grantPermissions(["notifications"]);
	await connect(page);
	await page.getByRole("button", { name: "Settings" }).click();
	await expect(page.getByRole("checkbox", { name: /Push notifications/ })).toBeVisible();
});
