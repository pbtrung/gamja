import { describe, expect, it, vi } from "vitest";
import { reloadIfOutdated } from "../../src/app/update";

function stub(deployed: string | null) {
	const fetch = vi.fn(async (url: string) =>
		url === "version.json"
			? deployed === null
				? new Response("", { status: 404 })
				: Response.json({ version: deployed })
			: new Response(""),
	);
	const reload = vi.fn();
	vi.stubGlobal("fetch", fetch);
	vi.stubGlobal("location", { ...window.location, pathname: "/chat/", reload });
	return { fetch, reload };
}

describe("reloadIfOutdated", () => {
	it("reloads once, refreshing the cached page, when another version is deployed", async () => {
		const { fetch, reload } = stub("v2");
		expect(await reloadIfOutdated("v1")).toBe(true);
		expect(fetch).toHaveBeenCalledWith("version.json", { cache: "no-store" });
		expect(fetch).toHaveBeenCalledWith("/chat/", { cache: "reload" });
		expect(reload).toHaveBeenCalledTimes(1);
		// Still stale after reloading: don't loop
		vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(await reloadIfOutdated("v1")).toBe(false);
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it("does nothing when up to date, unknown or in development", async () => {
		const { reload } = stub("v1");
		expect(await reloadIfOutdated("v1")).toBe(false);
		expect(await reloadIfOutdated(undefined)).toBe(false);
		stub(null);
		expect(await reloadIfOutdated("v1")).toBe(false);
		expect(reload).not.toHaveBeenCalled();
	});
});
