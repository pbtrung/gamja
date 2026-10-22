/** Dialogs: account, settings and help. */

import type Client from "../lib/client";
import * as S from "../state";
import type { Settings } from "../state";
import * as store from "../store";
import { applyTextSize, applyTheme } from "../themes";
import type { Dialog } from "./store";
import type AppController from "./controller";

export const dialogsMethods = {
	openHelp(this: AppController): void {
		this.openDialog({ kind: "help" });
	},

	openDialog(this: AppController, dialog: Dialog): void {
		this.update({ dialog });
	},

	dismissDialog(this: AppController): void {
		this.update({ dialog: null });
	},

	setDialogLoading(this: AppController, promise: Promise<unknown>): void {
		const setLoading = (loading: boolean) => {
			this.update((state) => {
				const dialog = state.dialog;
				if (
					!dialog ||
					(dialog.kind !== "auth" && dialog.kind !== "register" && dialog.kind !== "verify")
				) {
					return;
				}
				return { dialog: { ...dialog, loading } };
			});
		};

		setLoading(true);
		promise.catch((err) => this.showError(err)).finally(() => setLoading(false));
	},

	handleAuthClick(this: AppController, serverID: number): void {
		const client = this.clients.get(serverID);
		this.openDialog({ kind: "auth", server: serverID, username: client?.nick ?? "" });
	},

	handleAuthSubmit(this: AppController, serverID: number, username: string, password: string): void {
		const client = this.clients.get(serverID)!;
		const promise = client.authenticate("PLAIN", { username, password }).then(() => {
			this.dismissDialog();
			this.saveCredentials(client, username, password);
		});
		this.setDialogLoading(promise);
	},

	/** Save SASL PLAIN credentials if the connection is remembered ("Remember me"). */
	saveCredentials(this: AppController, client: Client, username: string, password: string): void {
		const firstClient = this.clients.values().next().value;
		if (client !== firstClient) {
			return;
		}

		const autoconnect = store.autoconnect.load();
		if (!autoconnect) {
			return;
		}

		console.log("Saving SASL PLAIN credentials");
		store.autoconnect.put({ ...autoconnect, saslPlain: { username, password } });
	},

	handleRegisterClick(this: AppController, serverID: number): void {
		const client = this.clients.get(serverID)!;
		const emailRequired = client.checkAccountRegistrationCap("email-required");
		this.openDialog({ kind: "register", server: serverID, emailRequired });
	},

	handleRegisterSubmit(this: AppController, serverID: number, email: string, password: string): void {
		const client = this.clients.get(serverID)!;
		const promise = client.registerAccount(email, password).then((data) => {
			this.dismissDialog();

			if (data.verificationRequired) {
				this.handleVerifyClick(serverID, data.account, data.message);
			}
			this.saveCredentials(client, data.account, password);
		});
		this.setDialogLoading(promise);
	},

	handleVerifyClick(this: AppController, serverID: number, account: string, message: string): void {
		this.openDialog({ kind: "verify", server: serverID, account, message });
	},

	handleVerifySubmit(this: AppController, serverID: number, account: string, code: string): void {
		const client = this.clients.get(serverID)!;
		const promise = client.verifyAccount(account, code).then(() => {
			this.dismissDialog();
		});
		this.setDialogLoading(promise);
	},

	handleOpenSettingsClick(this: AppController): void {
		let showProtocolHandler = false;
		for (const client of this.clients.values()) {
			if (client.caps.enabled.has("soju.im/bouncer-networks")) {
				showProtocolHandler = true;
				break;
			}
		}

		this.openDialog({ kind: "settings", showProtocolHandler });
	},

	handleSettingsChange(this: AppController, settings: Partial<Settings>): void {
		const updated = { ...this.state.settings, ...settings };
		store.settings.put(updated as unknown as Record<string, unknown>);
		this.update({ settings: updated });
		if (settings.theme !== undefined) {
			applyTheme(updated.theme);
		}
		if (settings.textSize !== undefined) {
			applyTextSize(S.textSize(updated));
		}
		if (settings.autoAwayMinutes !== undefined && typeof document !== "undefined") {
			this.handleVisibilityChange();
		}
	},
};

export type DialogsMethods = typeof dialogsMethods;
