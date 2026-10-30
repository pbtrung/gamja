/** Registration: capability negotiation, SASL, away status and accounts. */

import * as irc from "../irc";
import type { Message } from "../irc";
import { ClientConnection } from "./connection";
import { IRCError, TimeoutError, WEBSOCKET_CLOSE_CODES } from "./errors";
import { MULTIPLEX_CAP } from "./multiplex";
import { initialResponse, parseOAuthBearerError, type SASLOAuthBearer, type SASLPlain } from "./sasl";
import { ClientStatus } from "./types";

// Static list of capabilities that are always requested when supported by the
// server
const permanentCaps = [
	"account-notify",
	"account-tag",
	"away-notify",
	"batch",
	"cap-notify",
	"chghost",
	"echo-message",
	"extended-join",
	"extended-monitor",
	"invite-notify",
	"labeled-response",
	"message-tags",
	"multi-prefix",
	"sasl",
	"server-time",
	"setname",
	"userhost-in-names",

	"draft/account-registration",
	"draft/channel-rename",
	"draft/chathistory",
	"draft/extended-monitor",
	"draft/message-redaction",
	"draft/metadata-2",
	"draft/multiline",
	"draft/no-implicit-names",
	"draft/pre-away",
	"draft/read-marker",

	"soju.im/bouncer-networks",
	"soju.im/no-implicit-names",
	"soju.im/search",
	"soju.im/unread",
	"soju.im/webpush",
];

export abstract class RegistrationClient extends ClientConnection {
	authenticateFromParams(): Promise<void> {
		if (!this.caps.available.has("sasl")) {
			return Promise.reject(new Error("Server doesn't support SASL"));
		}
		if (this.params.saslPlain) {
			return this.authenticate("PLAIN", this.params.saslPlain);
		} else if (this.params.saslExternal) {
			return this.authenticate("EXTERNAL");
		}
		return this.authenticate("OAUTHBEARER", this.params.saslOauthBearer!);
	}

	async authenticate(mechanism: string, params?: SASLPlain | SASLOAuthBearer): Promise<void> {
		if (!this.supportsSASL(mechanism)) {
			throw new Error(`${mechanism} authentication not supported by the server`);
		}
		console.log(`Starting SASL ${mechanism} authentication`);

		const initialResp = initialResponse(mechanism, params);

		const startMsg = { command: "AUTHENTICATE", params: [mechanism] };
		let oauthError: Error | null = null;
		const promise = this.roundtrip(startMsg, (msg) => {
			switch (msg.command) {
				case "AUTHENTICATE": {
					// PLAIN, EXTERNAL and OAUTHBEARER expect an empty challenge
					const challenge = msg.params[0];
					if (challenge === "+") {
						break;
					}
					if (mechanism !== "OAUTHBEARER") {
						this.send({ command: "AUTHENTICATE", params: ["*"] });
						throw new Error("Expected an empty challenge, got: " + challenge);
					}
					// An OAUTHBEARER error: the client must acknowledge it with
					// a dummy response, the server then fails, see RFC 7628
					// section 3.2.3
					oauthError = parseOAuthBearerError(challenge);
					this.send({ command: "AUTHENTICATE", params: ["AQ=="] });
					break;
				}
				case irc.RPL_SASLSUCCESS:
					return true;
				case irc.ERR_SASLFAIL:
					if (oauthError) {
						// Reported once, with the details of the challenge
						msg.internal = true;
						const err = new IRCError(msg);
						err.message = oauthError.message;
						throw err;
					}
					throw new IRCError(msg);
				case irc.ERR_NICKLOCKED:
				case irc.ERR_SASLTOOLONG:
				case irc.ERR_SASLABORTED:
				case irc.ERR_SASLALREADY:
					throw new IRCError(msg);
			}
		});
		for (const msg of irc.generateAuthenticateMessages(initialResp)) {
			this.send(msg);
		}
		await promise;
	}

	supportsSASL(mech: string): boolean {
		const saslCap = this.caps.available.get("sasl");
		if (saslCap === undefined) {
			return false;
		}
		if (saslCap === "") {
			return true; // The mechanism list is optional, try anyway
		}
		return saslCap.split(",").includes(mech);
	}

	wantsSASL(): boolean {
		return Boolean(this.params.saslPlain || this.params.saslExternal || this.params.saslOauthBearer);
	}

	checkAccountRegistrationCap(k: string): boolean {
		const v = this.caps.available.get("draft/account-registration");
		if (v === undefined) {
			return false;
		}
		return v.split(",").includes(k);
	}

	/** Request the caps we want, among `only` if given. */
	requestCaps(only?: string[]): void {
		let wantCaps = [...permanentCaps];
		if (!this.params.bouncerNetwork) {
			wantCaps.push("soju.im/bouncer-networks-notify", MULTIPLEX_CAP);
		}
		if (this.params.eventPlayback) {
			wantCaps.push("draft/event-playback");
		}
		if (only) {
			wantCaps = wantCaps.filter((cap) => only.includes(cap));
		}

		for (const msg of this.caps.requestAvailable(wantCaps)) {
			this.send(msg);
		}
	}

	handleCap(msg: Message): void {
		this.caps.parse(msg);

		const subCmd = msg.params[1];
		const args = msg.params.slice(2);
		switch (subCmd) {
			case "LS":
				this.supportsCap = true;
				if (args[0] === "*") {
					break;
				}

				console.log("Available server caps:", this.caps.available);

				this.requestCaps();

				if (this.status !== ClientStatus.REGISTERED) {
					// soju.im/account-required: the server would refuse to
					// register us, say why up front
					if (!this.wantsSASL() && this.caps.available.has("soju.im/account-required")) {
						this.dispatchError(
							new Error("This server requires an account: log in with a password"),
						);
						this.disconnect();
						break;
					}
					if (!this.wantsSASL()) {
						this.endRegistration();
						break;
					}

					// Only end registration once SASL is done: servers abort
					// authentication still in progress on CAP END, and soju
					// requires it before BOUNCER BIND
					// Ignore the outcome if the connection changed meanwhile: a
					// dropped socket must keep reconnecting, and a newer one
					// mustn't be closed
					const ws = this.ws;
					this.authenticateFromParams().then(
						() => {
							if (this.ws === ws) {
								this.endRegistration();
							}
						},
						(err) => {
							if (this.ws !== ws) {
								return;
							}
							this.dispatchError(err);
							// Retry if the server was only slow or busy
							if (
								err instanceof TimeoutError ||
								(err instanceof IRCError && err.msg.command === irc.RPL_TRYAGAIN)
							) {
								this.dropConnection(ws!, WEBSOCKET_CLOSE_CODES.NORMAL_CLOSURE);
							} else {
								this.disconnect();
							}
						},
					);
				}
				break;
			case "NEW": {
				const list = args[0] ?? "";
				console.log("Server added available caps:", list);
				// Only the new caps: the server rejected some of the others
				const newCaps = list.split(" ").map((item) => item.split("=")[0].toLowerCase());
				this.requestCaps(newCaps);
				break;
			}
			case "DEL":
				console.log("Server removed available caps:", args[0]);
				break;
			case "ACK":
				console.log("Server ack'ed caps:", args[0]);
				break;
			case "NAK":
				console.log("Server nak'ed caps:", args[0]);
				// An AWAY sent before CAP END without it was rejected
				if ((args[0] ?? "").toLowerCase().split(" ").includes("draft/pre-away")) {
					this.sentAway = null;
				}
				break;
		}
	}

	/** Bind to the bouncer network, if any, and end CAP negotiation. */
	endRegistration(): void {
		if (this.caps.available.has("soju.im/bouncer-networks") && this.params.bouncerNetwork) {
			this.send({ command: "BOUNCER", params: ["BIND", this.params.bouncerNetwork] });
		}
		// draft/pre-away: don't appear present while reconnecting in the
		// background. The REQ has been sent, the server handles it first
		const away = this.caps.requested.has("draft/pre-away") ? this.wantedAway(true) : null;
		if (away) {
			this.send({ command: "AWAY", params: [away] });
			this.sentAway = away;
		}
		this.send({ command: "CAP", params: ["END"] });
	}

	/**
	 * The away message the server should have. Being absent only makes us
	 * away with draft/pre-away, which lets bouncers tell it apart from an
	 * away message typed by the user.
	 */
	wantedAway(preAway = this.caps.enabled.has("draft/pre-away")): string | null {
		if (this.awayMessage) {
			return this.awayMessage;
		}
		return !this.present && preAway ? "*" : null;
	}

	/** Set or clear (with null or "") the user's away message. */
	setAway(message: string | null): void {
		this.awayMessage = message || null;
		// The user may expect AWAY to be sent even when nothing changed
		this.sentAway = undefined;
		this.syncAway();
	}

	/** Update whether the user is at the client, see draft/pre-away. */
	setPresent(present: boolean): void {
		this.present = present;
		this.syncAway();
	}

	syncAway(): void {
		if (this.status !== ClientStatus.REGISTERED) {
			return;
		}
		const away = this.wantedAway();
		if (away === this.sentAway) {
			return;
		}
		this.sentAway = away;
		this.send({ command: "AWAY", params: away ? [away] : [] });
	}

	registerAccount(
		email: string | null,
		password: string,
	): Promise<{ verificationRequired: boolean; account: string; message: string }> {
		const msg = {
			command: "REGISTER",
			params: ["*", email || "*", password],
		};
		return this.roundtrip(msg, (msg) => {
			if (msg.command !== "REGISTER") {
				return;
			}
			const result = msg.params[0];
			return {
				verificationRequired: result === "VERIFICATION_REQUIRED",
				account: msg.params[1],
				message: msg.params[2],
			};
		});
	}

	verifyAccount(account: string, code: string): Promise<{ message: string }> {
		const msg = {
			command: "VERIFY",
			params: [account, code],
		};
		return this.roundtrip(msg, (msg) => {
			if (msg.command !== "VERIFY") {
				return;
			}
			return { message: msg.params[2] };
		});
	}
}
