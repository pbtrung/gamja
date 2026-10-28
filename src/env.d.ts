interface ImportMetaEnv {
	/** Set at build time, see vite.config.ts */
	readonly GAMJA_VERSION?: string;
	readonly GAMJA_DEPENDENCIES?: { name: string; version: string }[];
}
