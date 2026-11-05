import { RefreshCw, X } from "lucide-react";
import { useController } from "../../app/context";
import type { AppState } from "../../app/store";
import { getServerName, type Server } from "../../state";
import Alert from "../Alert";
import IconButton from "../IconButton";

/** All app notices share one top stack; connection errors join their retry status. */
export default function Banners({ state }: { state: AppState }) {
	const app = useController();
	const connections = new Map<object, { transport: Server; networks: Server[] }>();
	for (const server of state.servers.values()) {
		if (!server.reconnecting) {
			continue;
		}
		const client = app.getClient(server.id);
		const parent = client?.params.multiplexer?.parent;
		const key = parent ?? client ?? server;
		const group = connections.get(key);
		if (group) {
			group.networks.push(server);
		} else {
			const parentID = parent ? [...app.clients].find(([, c]) => c === parent)?.[0] : undefined;
			const transport = parentID === undefined ? server : (state.servers.get(parentID) ?? server);
			connections.set(key, { transport, networks: [server] });
		}
	}
	const groups = [...connections.values()];
	const errorGroup = groups.find(
		({ transport, networks }) =>
			transport.id === state.errorServer || networks.some((server) => server.id === state.errorServer),
	);
	if (groups.length === 0 && !state.error) {
		return null;
	}
	return (
		<div className="app-banners">
			{groups.map((group) => {
				const { transport, networks } = group;
				const server = transport.reconnecting || networks.length > 1 ? transport : networks[0];
				const network = server.bouncerNetID ? state.bouncerNetworks.get(server.bouncerNetID) : null;
				const name = getServerName(server, network);
				return (
					<div className="status-banner reconnect-banner" role="status" key={transport.id}>
						<RefreshCw className="reconnect-spinner" aria-hidden="true" />
						<div className="banner-text">
							<span>
								<strong>Connection to {name} lost.</strong> Reconnecting…
							</span>
							{group === errorGroup && state.error && (
								<span className="banner-detail">{state.error}</span>
							)}
						</div>
					</div>
				);
			})}
			{state.error && !errorGroup && (
				<Alert
					className="status-banner error-banner"
					action={<IconButton icon={X} label="Dismiss" onClick={() => app.dismissError()} />}
				>
					{state.error}
				</Alert>
			)}
		</div>
	);
}
