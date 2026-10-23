/**
 * Detect a stale build: browsers and proxies may cache index.html, which
 * keeps loading the scripts of an older gamja after a new one is deployed.
 */

const RELOADED_KEY = "gamja_reloaded_for";

/**
 * Reload the page once if the deployed version (version.json, written by
 * the build) differs from the running one. Returns true if reloading.
 */
export async function reloadIfOutdated(current = import.meta.env.GAMJA_VERSION): Promise<boolean> {
	if (!current) {
		return false; // Development server, or tests
	}
	let latest: unknown;
	try {
		const resp = await fetch("version.json", { cache: "no-store" });
		if (!resp.ok) {
			return false;
		}
		latest = (await resp.json())?.version;
	} catch (err) {
		console.warn("Failed to check the deployed gamja version:", err);
		return false;
	}
	if (typeof latest !== "string" || latest === current) {
		return false;
	}

	// Don't loop if the page stays stale, e.g. a cache ignoring reloads
	try {
		if (sessionStorage.getItem(RELOADED_KEY) === latest) {
			console.warn(`Running gamja ${current}, but ${latest} is deployed: the page is cached`);
			return false;
		}
		sessionStorage.setItem(RELOADED_KEY, latest);
	} catch {
		return false; // Storage disabled: can't tell a loop apart
	}

	console.log(`Reloading to update gamja from ${current} to ${latest}`);
	try {
		// Replace the cached page, which reloading may serve again otherwise
		await fetch(window.location.pathname, { cache: "reload" });
	} catch {
		// Reload anyway
	}
	window.location.reload();
	return true;
}
