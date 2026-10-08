import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type AppController from "./controller";
import type { AppState } from "./store";

export const ControllerContext = createContext<AppController | null>(null);

export function useController(): AppController {
	const controller = useContext(ControllerContext);
	if (!controller) {
		throw new Error("useController() called outside of a ControllerContext");
	}
	return controller;
}

/** Subscribe to a slice of the application state. */
export function useAppState<T>(selector: (state: AppState) => T): T {
	return useStore(useController().store, selector);
}
