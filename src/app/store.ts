import { createStore, type StoreApi } from "zustand/vanilla";
import { createState, type BouncerNetwork, type State } from "../state";
import type { SASLOAuthBearer, SASLPlain } from "../lib/client";

export interface ConnectParams {
	url: string | null;
	pass: string | null;
	username: string | null;
	realname: string | null;
	nick: string | null;
	saslPlain: SASLPlain | null;
	saslExternal: boolean;
	saslOauthBearer: SASLOAuthBearer | null;
	autoconnect: boolean;
	autojoin: string[];
	ping: number;
	bouncerNetwork?: string | null;
}

export const defaultConnectParams: ConnectParams = {
	url: null,
	pass: null,
	username: null,
	realname: null,
	nick: null,
	saslPlain: null,
	saslExternal: false,
	saslOauthBearer: null,
	autoconnect: false,
	autojoin: [],
	ping: 0,
};

export type Dialog =
	| { kind: "network"; id?: string; params?: BouncerNetwork; autojoin?: string }
	| { kind: "help" }
	| { kind: "join"; server: number; channel?: string }
	| { kind: "confirm-open-buffer"; server: number; name: string }
	| { kind: "auth"; server: number; username: string; loading?: boolean }
	| { kind: "register"; server: number; emailRequired: boolean; loading?: boolean }
	| { kind: "verify"; server: number; account: string; message: string; loading?: boolean }
	| { kind: "settings"; showProtocolHandler: boolean }
	| { kind: "switch" };

export interface AppState extends State {
	connectParams: ConnectParams;
	/** Show the connection form instead of the chat UI */
	connectForm: boolean;
	/** Waiting for config.json */
	loading: boolean;
	dialog: Dialog | null;
	error: string | null;
	openPanels: {
		bufferList: boolean;
		memberList: boolean;
	};
}

export type AppStore = StoreApi<AppState>;

export function createAppStore(): AppStore {
	return createStore<AppState>()(() => ({
		...createState(),
		connectParams: { ...defaultConnectParams },
		connectForm: true,
		loading: true,
		dialog: null,
		error: null,
		openPanels: {
			bufferList: false,
			memberList: false,
		},
	}));
}
