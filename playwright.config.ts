import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Use the system Chromium when Playwright's own browsers aren't installed
const systemChromium = ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].find(
	(p) => existsSync(p),
);
const executablePath = process.env.CHROMIUM_PATH || systemChromium;

const PORT = 4174;

export default defineConfig({
	testDir: "e2e",
	testMatch: "*.spec.ts",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"], launchOptions: executablePath ? { executablePath } : {} },
			testIgnore: "mobile.spec.ts",
		},
		{
			name: "mobile",
			use: {
				...devices["Pixel 7"],
				launchOptions: executablePath ? { executablePath } : {},
			},
			testMatch: "mobile.spec.ts",
		},
	],
	webServer: {
		// Test the production build, with its Content-Security-Policy
		command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
		url: `http://localhost:${PORT}`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
