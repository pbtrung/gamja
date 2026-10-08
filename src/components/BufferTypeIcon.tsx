import { MessagesSquare, Server, User, type LucideProps } from "lucide-react";
import { BufferType } from "../state";

/** Icon standing for a buffer type, wherever buffers are listed or shown. */
export default function BufferTypeIcon({ type, ...props }: { type: BufferType } & LucideProps) {
	switch (type) {
		case BufferType.SERVER:
			return <Server {...props} />;
		case BufferType.NICK:
			return <User {...props} />;
		default:
			return <MessagesSquare {...props} />;
	}
}
