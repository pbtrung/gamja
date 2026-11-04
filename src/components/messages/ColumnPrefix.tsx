import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Keep the truncation marker in the gap before the column divider. */
export default function ColumnPrefix({ kind, children }: { kind: string; children: ReactNode }) {
	const ref = useRef<HTMLSpanElement>(null);

	useLayoutEffect(() => {
		const prefix = ref.current!;
		const text = prefix.querySelector<HTMLElement>(".logline-prefix-text")!;
		const content = text.firstElementChild!;
		const update = () => {
			prefix.toggleAttribute("data-truncated", text.scrollWidth > text.clientWidth);
		};
		update();
		if (typeof ResizeObserver === "undefined") {
			return;
		}
		const observer = new ResizeObserver(update);
		observer.observe(text);
		// Font changes can change the content width without resizing the column.
		observer.observe(content);
		return () => observer.disconnect();
	}, [children]);

	return (
		<span ref={ref} className={`logline-prefix ${kind}`}>
			<span className="logline-prefix-text">
				<span className="logline-prefix-content">{children}</span>
			</span>
			<span className="logline-prefix-overflow" aria-hidden="true" />
		</span>
	);
}
