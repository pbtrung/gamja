import { useState, type ChangeEvent, type FormEvent } from "react";
import { Check, ChevronRight, Plus, Server, Trash } from "lucide-react";
import DialogActions from "./DialogActions";
import type { BouncerNetwork } from "../../state";
import Field from "./Field";
import { SwitchRow } from "./Switch";

const defaultParams = {
	name: "",
	host: "",
	port: "6697",
	tls: "1",
	nickname: "",
	username: "",
	realname: "",
	pass: "",
};

type Params = typeof defaultParams;

interface NetworkFormProps {
	isNew: boolean;
	params?: BouncerNetwork;
	autojoin?: string;
	onSubmit: (attrs: BouncerNetwork, autojoin: string | null) => void;
	onRemove: () => void;
}

export default function NetworkForm({ isNew, params, autojoin, onSubmit, onRemove }: NetworkFormProps) {
	const [prevParams] = useState<Params>(() => {
		const prev = { ...defaultParams };
		for (const k of Object.keys(defaultParams) as (keyof Params)[]) {
			const v = params?.[k];
			if (v !== undefined && v !== null) {
				prev[k] = String(v);
			}
		}
		return prev;
	});
	const [form, setForm] = useState<Params>(prevParams);
	const [doAutojoin, setDoAutojoin] = useState(true);

	function handleSubmit(event: FormEvent) {
		event.preventDefault();

		const attrs: BouncerNetwork = {};
		for (const k of Object.keys(defaultParams) as (keyof Params)[]) {
			if (!isNew && prevParams[k] === form[k]) {
				continue;
			}
			if (isNew && defaultParams[k] === form[k]) {
				continue;
			}
			attrs[k] = form[k];
		}

		onSubmit(attrs, doAutojoin && autojoin ? autojoin : null);
	}

	// Props of the field editing a parameter
	const param = (k: keyof Params) => ({
		name: k,
		value: form[k],
		onChange: (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value })),
	});

	return (
		<form onSubmit={handleSubmit}>
			<Field
				label="Hostname"
				icon={Server}
				{...param("host")}
				required
				autoFocus
				placeholder="irc.libera.chat"
			/>

			{autojoin && (
				<SwitchRow checked={doAutojoin} onChange={setDoAutojoin}>
					Auto-join channel <strong>{autojoin}</strong>
				</SwitchRow>
			)}

			<details className="advanced-options">
				<summary>
					<ChevronRight className="chevron" aria-hidden="true" /> Advanced options
				</summary>

				<div className="advanced-body">
					<Field label="Port" type="number" {...param("port")} min={1} max={65535} />
					<SwitchRow
						name="tls"
						checked={form.tls !== "0"}
						onChange={(checked) => setForm((f) => ({ ...f, tls: checked ? "1" : "0" }))}
					>
						Use TLS (encrypted connection)
					</SwitchRow>
					<Field label="Network name" {...param("name")} />
					<Field label="Nickname" {...param("nickname")} />
					<Field label="Username" {...param("username")} />
					<Field label="Real name" {...param("realname")} />
					<Field label="Server password" type="password" {...param("pass")} placeholder="None" />
				</div>
			</details>

			<DialogActions label={isNew ? "Add network" : "Save network"} icon={isNew ? Plus : Check}>
				{!isNew && (
					<button type="button" className="btn btn-danger-outline me-auto" onClick={onRemove}>
						<Trash aria-hidden="true" /> Remove network
					</button>
				)}
			</DialogActions>
		</form>
	);
}
