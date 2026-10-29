import { useCallback, useEffect } from "react";
import { BufferType } from "../../state";
import type AppController from "../../app/controller";
import type { AppState } from "../../app/store";
import useSwipe from "../useSwipe";

/**
 * The side panel drawers of small screens: Escape closes them, and
 * swipes open and close them. Returns a function closing them.
 */
export default function useSidePanels(
	app: AppController,
	smallScreen: boolean,
	openPanels: AppState["openPanels"],
): () => void {
	const closePanels = useCallback(() => {
		const toggle = app.state.openPanels.memberList ? ".member-list-toggle" : ".buffer-list-toggle";
		app.setOpenPanel("bufferList", false);
		app.setOpenPanel("memberList", false);
		document.querySelector<HTMLButtonElement>(toggle)?.focus();
	}, [app]);
	useEffect(() => {
		if (!smallScreen || (!openPanels.bufferList && !openPanels.memberList)) {
			return;
		}
		const onEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !document.querySelector('[role="menu"], [aria-modal="true"]')) {
				closePanels();
			}
		};
		window.addEventListener("keydown", onEscape);
		return () => window.removeEventListener("keydown", onEscape);
	}, [smallScreen, openPanels.bufferList, openPanels.memberList, closePanels]);

	// Swipe right to show the buffer list (or hide the member list), left
	// to show the member list (or hide the buffer list)
	useSwipe(smallScreen, (direction) => {
		const { openPanels, activeBuffer } = app.state;
		const open = direction === "right" ? openPanels.bufferList : openPanels.memberList;
		const other = direction === "right" ? openPanels.memberList : openPanels.bufferList;
		if (other) {
			app.setOpenPanel(direction === "right" ? "memberList" : "bufferList", false);
		} else if (!open) {
			if (direction === "right") {
				app.setOpenPanel("bufferList", true);
			} else if (
				activeBuffer !== null &&
				app.state.buffers.get(activeBuffer)?.type === BufferType.CHANNEL
			) {
				app.setOpenPanel("memberList", true);
			}
		}
	});

	return closePanels;
}
