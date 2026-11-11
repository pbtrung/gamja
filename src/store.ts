/** Browser preferences and the public persistence API. */

import { sanitizeSettings } from "./state";
import { Item, StringListItem } from "./store/item";
export { Item } from "./store/item";
export { BufferStore } from "./store/buffers";
export type { StoredServer, ServerRef, Receipts, StoredBuffer, BufferUpdate } from "./store/model";

/** Connection parameters stored by "Remember me". */
interface StoredConnectParams {
	url?: string | null;
	pass?: string | null;
	username?: string | null;
	realname?: string | null;
	nick?: string | null;
	saslPlain?: { username: string; password: string } | null;
	saslExternal?: boolean;
	saslOauthBearer?: { token: string; username?: string | null; expiresAt?: number | null } | null;
	autoconnect?: boolean;
	autojoin?: string[];
	ping?: number;
}

export const autoconnect = new Item<StoredConnectParams>("autoconnect");
export const naggedProtocolHandler = new Item<boolean>("naggedProtocolHandler");
/** Settings changed from their defaults. Loading drops invalid ones, see
 * sanitizeSettings(). */
class SettingsItem extends Item<Record<string, unknown>> {
	override load(): Record<string, unknown> | null {
		const stored = super.load();
		return stored === null ? null : sanitizeSettings(stored);
	}
}

export const settings = new SettingsItem("settings");
/** Keys of the networks collapsed in the buffer list, see getServerKey() */
export const collapsedNetworks = new StringListItem("collapsedNetworks");
/** Whether the buffer list is hidden on large screens */
export const bufferListHidden = new Item<boolean>("bufferListHidden");
/** Whether the buffer list only shows the unread buffers */
export const bufferListUnreadOnly = new Item<boolean>("bufferListUnreadOnly");
/** Widths of the side panes on large screens, in pixels, see PaneResizer */
export const bufferListWidth = new Item<number>("bufferListWidth");
export const memberListWidth = new Item<number>("memberListWidth");
/** Reactions picked last, most recent first */
export const recentReactions = new StringListItem("recentReactions");
