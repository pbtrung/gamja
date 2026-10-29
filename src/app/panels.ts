/** Panels: the buffer list and the member list. */

import * as S from "../state";
import * as store from "../store";
import type AppController from "./controller";

export const panelsMethods = {
	/** Collapse or expand a network's buffers in the buffer list, or all networks. */
	toggleCollapsed(this: AppController, serverID: number, all = false): void {
		const server = this.state.servers.get(serverID);
		if (!server) {
			return;
		}
		const key = S.getServerKey(server);
		const collapse = !this.state.collapsedNetworks.has(key);
		const keys = all ? [...this.state.servers.values()].map(S.getServerKey) : [key];
		const collapsedNetworks = new Set(this.state.collapsedNetworks);
		for (const k of keys) {
			if (collapse) {
				collapsedNetworks.add(k);
			} else {
				collapsedNetworks.delete(k);
			}
		}
		store.collapsedNetworks.put([...collapsedNetworks]);
		this.update({ collapsedNetworks });
	},

	setOpenPanel(this: AppController, panel: "bufferList" | "memberList", open: boolean | "toggle"): void {
		this.update((state) => ({
			openPanels: {
				...state.openPanels,
				[panel]: open === "toggle" ? !state.openPanels[panel] : open,
			},
		}));
	},

	/** Show or hide the buffer list: a drawer on small screens. */
	toggleBufferList(this: AppController, smallScreen: boolean): void {
		if (smallScreen) {
			this.setOpenPanel("memberList", false);
			this.setOpenPanel("bufferList", "toggle");
		} else {
			this.setBufferListHidden(!this.state.bufferListHidden);
		}
	},

	/** Show or hide the member list: a drawer on small screens, the
	 * showMemberList setting on large ones. */
	toggleMemberList(this: AppController, smallScreen: boolean): void {
		if (smallScreen) {
			this.setOpenPanel("bufferList", false);
			this.setOpenPanel("memberList", "toggle");
		} else {
			const { settings, openPanels } = this.state;
			this.setOpenPanel("memberList", false);
			this.handleSettingsChange({
				showMemberList: !(settings.showMemberList || openPanels.memberList),
			});
		}
	},

	/** Only show the unread buffers in the buffer list, or all of them. */
	setBufferListUnreadOnly(this: AppController, unreadOnly: boolean): void {
		store.bufferListUnreadOnly.put(unreadOnly);
		this.update({ bufferListUnreadOnly: unreadOnly });
	},

	/** Hide or show the buffer list on large screens. */
	setBufferListHidden(this: AppController, hidden: boolean): void {
		store.bufferListHidden.put(hidden);
		this.update({ bufferListHidden: hidden });
	},
};

export type PanelsMethods = typeof panelsMethods;
