import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import css from "@eslint/css";
import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";

export default defineConfig([
	globalIgnores(["dist/"]),
	{
		files: ["**/*.js"],
		languageOptions: {
			globals: {
				...globals.browser,
				"process": "readonly",
			},
		},
		plugins: { js, "@stylistic": stylistic },
		extends: ["js/recommended"],
		rules: {
			"no-case-declarations": "off",
			"no-unused-vars": ["error", {
				args: "none",
				caughtErrorsIgnorePattern: "^_",
				destructuredArrayIgnorePattern: "^_",
			}],
			"no-var": "error",
			"no-eval": "error",
			"no-implied-eval": "error",
			"eqeqeq": "error",
			"no-invalid-this": "error",
			"no-extend-native": "error",
			"prefer-arrow-callback": "error",
			"no-implicit-globals": "error",
			"no-throw-literal": "error",
			"no-implicit-coercion": "warn",
			"object-shorthand": "warn",
			"curly": "warn",
			"camelcase": "warn",
			"@stylistic/indent": ["warn", "tab", { SwitchCase: 0 }],
			"@stylistic/quotes": ["warn", "double"],
			"@stylistic/semi": "warn",
			"@stylistic/brace-style": ["warn", "1tbs"],
			"@stylistic/comma-dangle": ["warn", "always-multiline"],
			"@stylistic/comma-spacing": "warn",
			"@stylistic/arrow-parens": "warn",
			"@stylistic/arrow-spacing": "warn",
			"@stylistic/block-spacing": "warn",
			"@stylistic/object-curly-spacing": ["warn", "always"],
			"@stylistic/object-curly-newline": ["warn", {
				multiline: true,
				consistent: true,
			}],
			"@stylistic/array-bracket-spacing": ["warn", "never"],
			"@stylistic/array-bracket-newline": ["warn", "consistent"],
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
			// Bootstrap's custom properties are defined in its own stylesheet
			"css/no-invalid-properties": ["error", { allowUnknownVariables: true }],
		},
	},
]);
