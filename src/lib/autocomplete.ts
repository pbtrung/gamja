export interface Autocomplete {
	text: string;
	caretPos: number;
	prefix: string;
	suffix: string;
	replacements: string[];
	replIndex: number;
}

/** Compute the next tab-completion state. Returns null if nothing matches. */
export function computeAutocomplete(
	text: string,
	caretPos: number,
	last: Autocomplete | null,
	backwards: boolean,
	autocomplete: (prefix: string) => string[],
): Autocomplete | null {
	let ac: Autocomplete;
	if (last && last.text === text && last.caretPos === caretPos) {
		ac = { ...last };
	} else {
		let wordStart;
		for (wordStart = caretPos - 1; wordStart >= 0; wordStart--) {
			if (text[wordStart] === " ") {
				break;
			}
		}
		wordStart++;

		let wordEnd;
		for (wordEnd = caretPos; wordEnd < text.length; wordEnd++) {
			if (text[wordEnd] === " ") {
				break;
			}
		}

		const word = text.slice(wordStart, wordEnd);
		if (!word) {
			return null;
		}

		const replacements = autocomplete(word);
		if (replacements.length === 0) {
			return null;
		}

		ac = {
			text,
			caretPos,
			prefix: text.slice(0, wordStart),
			suffix: text.slice(wordEnd),
			replacements,
			replIndex: -1,
		};
	}

	const n = ac.replacements.length;
	ac.replIndex = (ac.replIndex + (backwards ? -1 : 1) + n) % n;

	let repl = ac.replacements[ac.replIndex];
	if (!ac.prefix && !ac.suffix) {
		repl += repl.startsWith("/") ? " " : ": ";
	}

	ac.text = ac.prefix + repl + ac.suffix;
	ac.caretPos = ac.prefix.length + repl.length;
	return ac;
}
