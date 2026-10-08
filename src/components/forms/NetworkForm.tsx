import { useState, type FormEvent } from "react";
import { ChevronRight, Trash } from "lucide-react";
import type { BouncerNetwork } from "../../state";

const defaultParams = {
	name: "",
	host: "",
	port: "6697",
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

	const field = (k: keyof Params, label: string, type = "text", extra: Record<string, unknown> = {}) => (
		<div className="field">
			<label htmlFor={"network-" + k}>{label}</label>
			<input
				type={type}
				id={"network-" + k}
				name={k}
				value={form[k]}
				onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
				{...extra}
			/>
		</div>
	);

	return (
		<form className="network-form" onSubmit={handleSubmit}>
			{field("host", "Hostname", "text", {
				required: true,
				autoFocus: true,
				placeholder: "irc.libera.chat",
			})}

			{autojoin && (
				<label className="check">
					<input
						type="checkbox"
						checked={doAutojoin}
						onChange={(e) => setDoAutojoin(e.target.checked)}
					/>
					<span>
						Auto-join channel <strong>{autojoin}</strong>
					</span>
				</label>
			)}

			<details className="advanced-options">
				<summary>
					<ChevronRight className="chevron" aria-hidden="true" /> Advanced options
				</summary>

				<div className="advanced-body">
					{field("port", "Port", "number", { min: 1, max: 65535 })}
					{field("name", "Network name")}
					{field("nickname", "Nickname")}
					{field("username", "Username")}
					{field("realname", "Real name")}
					{field("pass", "Server password", "password", { placeholder: "None" })}
				</div>
			</details>

			<div className="dialog-actions">
				{!isNew && (
					<button type="button" className="btn btn-danger-outline me-auto" onClick={onRemove}>
						<Trash aria-hidden="true" /> Remove network
					</button>
				)}
				<button type="submit" className="btn btn-primary">
					{isNew ? "Add network" : "Save network"}
				</button>
			</div>
		</form>
	);
}
