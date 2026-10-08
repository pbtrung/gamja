/** Briefly highlight an element, restarting the animation if it's running. */
export function flash(el: HTMLElement): void {
	el.classList.remove("flash");
	void el.offsetWidth; // force a reflow so that the animation restarts
	el.classList.add("flash");
}
