/** JSON storage primitives with failure reporting and validated list values. */

const PREFIX = "gamja_";

export class Item<T> {
	k: string;

	constructor(k: string) {
		this.k = PREFIX + k;
	}

	load(): T | null {
		let v: string | null;
		try {
			v = localStorage.getItem(this.k);
		} catch (_err) {
			return null; // Storage disabled
		}
		if (!v) {
			return null;
		}
		try {
			return JSON.parse(v) as T;
		} catch (err) {
			console.error(`Failed to parse stored ${this.k}:`, err);
			return null;
		}
	}

	put(v: T | null | undefined): boolean {
		try {
			if (v !== null && v !== undefined) {
				localStorage.setItem(this.k, JSON.stringify(v));
			} else {
				localStorage.removeItem(this.k);
			}
			return true;
		} catch (err) {
			console.error(`Failed to store ${this.k}:`, err);
			return false;
		}
	}
}

export class StringListItem extends Item<string[]> {
	override load(): string[] | null {
		const value = super.load();
		return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
	}
}
