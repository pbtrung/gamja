/** Exponential backoff, for reconnections. */

/**
 * Implements a simple exponential backoff.
 */
export class Backoff {
	n = 0;
	base: number;
	max: number;

	constructor(base: number, max: number) {
		this.base = base;
		this.max = max;
	}

	reset(): void {
		this.n = 0;
	}

	next(): number {
		if (this.n === 0) {
			this.n = 1;
			return 0;
		}

		let dur = this.n * this.base;
		if (dur > this.max) {
			dur = this.max;
		} else {
			this.n *= 2;
		}

		return dur;
	}
}
