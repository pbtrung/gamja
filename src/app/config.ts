export interface Config {
	server: {
		url?: string;
		autojoin?: string | string[];
		auth?: "mandatory" | "optional" | "disabled" | "external" | "oauth2" | null;
		nick?: string;
		autoconnect?: boolean;
		ping?: number;
	};
	oauth2?: {
		url: string;
		client_id: string;
		client_secret?: string;
		scope?: string;
	};
}

export async function fetchConfig(url = "./config.json"): Promise<Config> {
	let config: Partial<Config> = {};
	try {
		const resp = await fetch(url);
		if (resp.ok) {
			config = await resp.json();
		} else if (resp.status !== 404) {
			console.error("Failed to fetch config: HTTP error:", resp.status, resp.statusText);
		}
	} catch (err) {
		console.error("Failed to fetch config:", err);
	}
	return { ...config, server: { ...config.server } };
}

export function parseQueryString(search: string): Record<string, string> {
	const params: Record<string, string> = {};
	for (const [k, v] of new URLSearchParams(search)) {
		params[k] = v;
	}
	return params;
}

export function splitHostPort(str: string): { host: string; port: number | null } {
	let host = str;
	let port: number | null = null;

	// Literal IPv6 addresses contain colons and are enclosed in square brackets
	const i = str.lastIndexOf(":");
	if (i > 0 && !str.endsWith("]")) {
		host = str.slice(0, i);
		port = parseInt(str.slice(i + 1), 10);
	}

	if (host.startsWith("[") && host.endsWith("]")) {
		host = host.slice(1, host.length - 1);
	}

	return { host, port };
}

/** Resolve the WebSocket URL relative to the page location. */
export function resolveServerURL(
	url: string | null,
	loc: Pick<Location, "host" | "protocol" | "pathname">,
): string {
	const host = loc.host || "localhost:8080";
	const proto = loc.protocol !== "https:" ? "ws:" : "wss:";
	let path = loc.pathname || "/";
	if (!loc.host) {
		path = "/";
	}
	if (!path.endsWith("/")) {
		path = path.slice(0, path.lastIndexOf("/") + 1);
	}

	if (!url) {
		return proto + "//" + host + path + "socket";
	}
	if (url.startsWith("/")) {
		return proto + "//" + host + url;
	}
	if (url.indexOf("://") < 0) {
		return proto + "//" + url;
	}
	return url;
}

/**
 * Parse a window hash route. Syntax is one of:
 *
 *   #/                  server buffer without hostname
 *   #/<entity>          buffer without hostname
 *   #//<host>           server buffer with hostname
 *   #//[host]/<entity>  buffer with hostname
 */
export function parseWindowHash(loc: string): { host?: string; entity: string } {
	if (loc.startsWith("#")) {
		loc = loc.substring(1);
	}

	let host: string | undefined;
	if (loc.startsWith("//")) {
		loc = loc.substring(2);
		let i = loc.indexOf("/");
		if (i < 0) {
			i = loc.length;
		}
		host = loc.substring(0, i);
		loc = loc.substring(i);
	}
	if (loc.startsWith("/")) {
		loc = loc.substring(1);
	}

	let entity = loc;
	try {
		entity = decodeURIComponent(loc);
	} catch (_err) {
		// Keep the raw value
	}
	return { host, entity };
}

export function formatWindowHash(host: string | null | undefined, entity: string | null): string {
	let loc = "#";
	if (host) {
		loc += "//" + host;
	}
	if (entity === null) {
		if (loc === "#") {
			loc += "/";
		}
		return loc;
	}
	if (!host && entity.startsWith("/")) {
		loc += "//"; // for disambiguation
	}
	return loc + "/" + entity;
}

export function randomNick(template: string): string {
	const placeholder = Math.random().toString(36).slice(2, 9);
	return template.replace("*", placeholder);
}
