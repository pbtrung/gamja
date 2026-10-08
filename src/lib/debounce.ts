export default function debounce<A extends unknown[]>(
	f: (...args: A) => void,
	delay: number,
): (...args: A) => void {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	return (...args: A) => {
		clearTimeout(timeout);
		timeout = setTimeout(() => {
			timeout = undefined;
			f(...args);
		}, delay);
	};
}
