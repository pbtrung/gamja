/** IRC case-mappings, and a Map with case-insensitive keys. */

export type CaseMapFn = (s: string) => string;

function caseMapWith(table: Record<string, string>): CaseMapFn {
	// Most strings are already lowercase: return them as is
	const affected = new RegExp(
		"[A-Z" +
			Object.keys(table)
				.map((ch) => "\\" + ch)
				.join("") +
			"]",
	);
	return (str: string) => {
		if (!affected.test(str)) {
			return str;
		}
		let out = "";
		for (const ch of str) {
			if ("A" <= ch && ch <= "Z") {
				out += ch.toLowerCase();
			} else {
				out += table[ch] ?? ch;
			}
		}
		return out;
	};
}

export const CaseMapping = {
	ASCII: caseMapWith({}),
	RFC1459: caseMapWith({ "{": "[", "}": "]", "\\": "|", "~": "^" }),
	RFC1459Strict: caseMapWith({ "{": "[", "}": "]", "\\": "|" }),

	byName(name: string): CaseMapFn | null {
		switch (name) {
			case "ascii":
				return CaseMapping.ASCII;
			case "rfc1459":
				return CaseMapping.RFC1459;
			case "rfc1459-strict":
				return CaseMapping.RFC1459Strict;
		}
		return null;
	},
};

/** A Map with case-insensitive keys, according to an IRC case-mapping. */
export class CaseMapMap<V> implements Iterable<[string, V]> {
	caseMap: CaseMapFn;
	map: Map<string, { key: string; value: V }>;

	constructor(iterable: Iterable<[string, V]> | CaseMapMap<V> | null, cm?: CaseMapFn | null) {
		if (iterable instanceof CaseMapMap && (iterable.caseMap === cm || !cm)) {
			// Fast-path if we're just cloning another CaseMapMap
			this.caseMap = iterable.caseMap;
			this.map = new Map(iterable.map);
		} else {
			if (!cm) {
				throw new Error("Missing case-mapping when creating CaseMapMap");
			}

			this.caseMap = cm;
			this.map = new Map();

			if (iterable) {
				for (const [key, value] of iterable) {
					this.set(key, value);
				}
			}
		}
	}

	get size(): number {
		return this.map.size;
	}

	has(key: string): boolean {
		return this.map.has(this.caseMap(key));
	}

	get(key: string): V | undefined {
		return this.map.get(this.caseMap(key))?.value;
	}

	set(key: string, value: V): this {
		this.map.set(this.caseMap(key), { key, value });
		return this;
	}

	delete(key: string): boolean {
		return this.map.delete(this.caseMap(key));
	}

	*entries(): IterableIterator<[string, V]> {
		for (const kv of this.map.values()) {
			yield [kv.key, kv.value];
		}
	}

	*keys(): IterableIterator<string> {
		for (const kv of this.map.values()) {
			yield kv.key;
		}
	}

	*values(): IterableIterator<V> {
		for (const kv of this.map.values()) {
			yield kv.value;
		}
	}

	[Symbol.iterator](): IterableIterator<[string, V]> {
		return this.entries();
	}
}
