import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	root: fileURLToPath(new URL(".", import.meta.url)),
	test: {
		globals: true,
		environment: "jsdom",
		include: ["test/**/*.test.{ts,tsx}"],
		setupFiles: ["test/setup.ts"],
		coverage: {
			provider: "v8",
			include: ["src/**/*.{ts,tsx}"],
			exclude: ["src/main.tsx"],
			reporter: ["text-summary", "html"],
			// Keep coverage from regressing
			thresholds: {
				statements: 80,
				branches: 72,
				functions: 78,
				lines: 80,
			},
		},
	},
});
