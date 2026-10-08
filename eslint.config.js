import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import css from "@eslint/css";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier/flat";

export default defineConfig([
	globalIgnores(["dist/", "coverage/", "playwright-report/", "test-results/"]),
	{
		files: ["**/*.{js,ts,tsx}"],
		languageOptions: {
			globals: globals.browser,
		},
		extends: [js.configs.recommended, tseslint.configs.recommended],
		rules: {
			"no-case-declarations": "off",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					args: "none",
					caughtErrorsIgnorePattern: "^_",
					destructuredArrayIgnorePattern: "^_",
					varsIgnorePattern: "^_",
				},
			],
			"no-var": "error",
			"no-eval": "error",
			"no-implied-eval": "error",
			eqeqeq: "error",
			"no-extend-native": "error",
			"prefer-arrow-callback": ["error", { allowNamedFunctions: true }],
			"no-throw-literal": "error",
			"object-shorthand": "warn",
			curly: "warn",
		},
	},
	{
		files: ["src/**/*.tsx", "src/**/*.ts"],
		extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
	},
	{
		files: [
			"vite.config.ts",
			"vitest.config.ts",
			"playwright.config.ts",
			"tools/**",
			"test/**",
			"e2e/**",
		],
		languageOptions: {
			globals: { ...globals.node, ...globals.browser },
		},
	},
	{
		files: ["**/*.css"],
		language: "css/css",
		plugins: { css },
		extends: ["css/recommended"],
		rules: {
			"css/use-baseline": "off",
			"css/font-family-fallbacks": "off",
			"css/no-important": "off",
			"css/no-invalid-properties": ["error", { allowUnknownVariables: true }],
		},
	},
	{
		files: ["**/*.{js,ts,tsx}"],
		extends: [prettier],
	},
]);
