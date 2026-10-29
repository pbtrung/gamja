import { useEffect, useRef } from "react";

/**
 * Call onTextChange when the text changes, e.g. to send typing
 * notifications, but not when it's restored by switching buffers.
 */
export default function useTextChange(
	text: string,
	draftKey: unknown,
	onTextChange: ((text: string) => void) | undefined,
): void {
	const onTextChangeRef = useRef(onTextChange);
	useEffect(() => {
		onTextChangeRef.current = onTextChange;
	});
	const textDraftKey = useRef(draftKey);
	useEffect(() => {
		// Text restored when switching buffers isn't typing
		if (textDraftKey.current !== draftKey) {
			textDraftKey.current = draftKey;
			return;
		}
		onTextChangeRef.current?.(text);
	}, [text, draftKey]);
}
