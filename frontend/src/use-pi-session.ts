/**
 * usePiSession — the single source of truth for the desktop UI.
 *
 * Bridges the Wails-bound Go backend with React state:
 *  - starts/stops the pi subprocess
 *  - subscribes to `pi:event` / `pi:exit` / `pi:stderr` events
 *  - folds the Pi RPC event stream into UI messages (streaming
 *    deltas, tool cards, thinking blocks)
 *  - exposes imperative commands (prompt, abort, model switch, ...)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { EventsOn, EventsOff } from "../wailsjs/runtime/runtime";
import {
	StartPi,
	StopPi,
	SendPrompt,
	Abort,
	NewSession,
	SetModel,
	SetThinking,
	GetSnapshot,
	GetWorkspace,
	ListSessions,
	ResumeSession,
	ListWorkspaces,
	AddWorkspaceDialog,
	SwitchWorkspace,
	SendDialogResponse,
} from "../wailsjs/go/main/App";
import type {
	PiEvent,
	PiMessage,
	PiModel,
	PiSessionState,
	PiExtensionUiRequest,
	ContentBlock,
} from "./pi-types";

export interface UiMessage {
	id: string;
	role: "user" | "assistant" | "toolResult" | "custom" | "system" | "bash";
	content: ContentBlock[];
	/** toolResult extras */
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
	timestamp?: number;
	streaming?: boolean;
}

export interface ToolCardState {
	id: string;
	name: string;
	args: Record<string, unknown>;
	status: "running" | "success" | "error";
	result: string;
}

export interface DialogState {
	id: string;
	method: "select" | "confirm" | "input" | "editor";
	title?: string;
	message?: string;
	options?: string[];
	placeholder?: string;
	prefill?: string;
}

export interface SessionInfo {
	id: string;
	name: string;
	path: string;
	workspace: string;
	updatedAt: number;
	messageCount: number;
}

export interface WorkspaceRecord {
	id: string;
	path: string;
	name: string;
	pinned: boolean;
	lastOpenedAt?: string;
}

let seq = 0;
function nextId(): string {
	return `m${++seq}-${Date.now().toString(36)}`;
}

function toBlocks(content: unknown): ContentBlock[] {
	if (content == null) return [];
	if (typeof content === "string") return [{ type: "text", text: content }];
	if (Array.isArray(content)) return content as ContentBlock[];
	return [];
}

function blocksToText(blocks: ContentBlock[]): string {
	return blocks
		.filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
		.map((b) => b.text)
		.join("");
}

export function usePiSession() {
	const [running, setRunning] = useState(false);
	const [starting, setStarting] = useState(false);
	const [messages, setMessages] = useState<UiMessage[]>([]);
	const [tools, setTools] = useState<ToolCardState[]>([]);
	const [state, setState] = useState<PiSessionState | null>(null);
	const [models, setModels] = useState<PiModel[]>([]);
	const [workspace, setWorkspace] = useState("");
	const [workspacePath, setWorkspacePath] = useState("");
	const [lastError, setLastError] = useState("");
	const [dialog, setDialog] = useState<DialogState | null>(null);
	const [agentBusy, setAgentBusy] = useState(false);
	const [sessions, setSessions] = useState<SessionInfo[]>([]);
	const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
	const [currentWorkspace, setCurrentWorkspace] = useState("");
	// True while a workspace switch / session resume is in flight:
	// the chat area shows a centered spinner (message list cleared).
	const [switching, setSwitching] = useState(false);

	// Streaming accumulation buffers, keyed by contentIndex.
	const streamRef = useRef<{ messageId: string; blocks: ContentBlock[] } | null>(null);
	const agentBusyRef = useRef(false);
	// Mirrors `switching`: while true, a pi:exit is EXPECTED (workspace
	// switch kills the old process) and must NOT flip running to false.
	const switchingRef = useRef(false);

	const setBusy = useCallback((b: boolean) => {
		agentBusyRef.current = b;
		setAgentBusy(b);
	}, []);

	/** Fold the live streaming assistant message into state. */
	const flushStream = useCallback(() => {
		const cur = streamRef.current;
		if (!cur) return;
		setMessages((prev) =>
			prev.map((m) =>
				m.id === cur.messageId ? { ...m, content: [...cur.blocks] } : m,
			),
		);
	}, []);

	const applyDelta = useCallback(
		(ev: PiEvent & { assistantMessageEvent?: any }) => {
			const d = ev.assistantMessageEvent;
			if (!d) return;
			// thinking_start alone creates an empty block that would flash
			// as an empty "思考过程" box. Skip it; thinking_delta creates
			// the block lazily so it only appears once there is content.
			if (d.type === "thinking_start") return;
			if (!streamRef.current) {
				// Fresh message: create the streaming slot lazily on the
				// first meaningful delta (text_delta / thinking_delta /
				// toolcall_*). Avoids a blank assistant bubble flashing
				// before content arrives.
				const id = nextId();
				streamRef.current = { messageId: id, blocks: [] };
				setMessages((prev) => [
					...prev,
					{ id, role: "assistant", content: [], streaming: true },
				]);
			}
			const cur = streamRef.current!;
			switch (d.type) {
				case "text_start": {
					cur.blocks[d.contentIndex] = { type: "text", text: "" };
					break;
				}
				case "text_delta": {
					const b = cur.blocks[d.contentIndex];
					if (b && b.type === "text") b.text += d.delta;
					else cur.blocks[d.contentIndex] = { type: "text", text: d.delta };
					break;
				}
				case "text_end": {
					cur.blocks[d.contentIndex] = { type: "text", text: d.content };
					break;
				}
				case "thinking_delta": {
					const b = cur.blocks[d.contentIndex];
					if (b && b.type === "thinking") b.thinking += d.delta;
					else cur.blocks[d.contentIndex] = { type: "thinking", thinking: d.delta };
					break;
				}
				case "thinking_end": {
					cur.blocks[d.contentIndex] = { type: "thinking", thinking: d.content };
					break;
				}
				case "toolcall_start": {
					cur.blocks[d.contentIndex] = {
						type: "toolCall",
						id: d.id,
						name: d.toolName,
						arguments: {},
					};
					break;
				}
				case "toolcall_delta": {
					const b = cur.blocks[d.contentIndex];
					if (b && b.type === "toolCall") {
						// Accumulate raw args in a hidden field.
						const raw = (b as any).__argsRaw ?? "";
						(b as any).__argsRaw = raw + d.delta;
						try {
							b.arguments = JSON.parse((b as any).__argsRaw);
						} catch {
							/* incomplete JSON */
						}
					}
					break;
				}
				case "toolcall_end": {
					cur.blocks[d.contentIndex] = d.toolCall;
					break;
				}
			}
			flushStream();
		},
		[flushStream],
	);

	const consumeMessage = useCallback((msg: PiMessage) => {
		if (msg.role === "assistant") {
			// End of streaming — replace the live streaming slot (or append
			// if none, e.g. restoring a historical session) with the
			// authoritative message content.
			setMessages((prev) => {
				const idx = prev.findIndex((m) => m.streaming);
				if (idx === -1) {
					// No streaming placeholder: append a finished assistant
					// message (restore/history path).
					return [
						...prev,
						{
							id: nextId(),
							role: "assistant",
							content: toBlocks(msg.content),
							streaming: false,
						},
					];
				}
				const copy = [...prev];
				copy[idx] = {
					id: copy[idx].id,
					role: "assistant",
					content: toBlocks(msg.content),
					streaming: false,
				};
				return copy;
			});
			streamRef.current = null;
			return;
		}
		if (msg.role === "toolResult") {
			setMessages((prev) => [
				...prev,
				{
					id: nextId(),
					role: "toolResult",
					content: [],
					toolCallId: msg.toolCallId,
					toolName: msg.toolName ?? "tool",
					isError: msg.isError,
				},
			]);
			return;
		}
		if (msg.role === "user") {
			// Dedupe: pi echoes the user turn as message_start AND
			// message_end. We already added it optimistically in send().
			// Only compare against the LAST user message so repeated
			// identical prompts (e.g. "继续") still get added.
			const text = blocksToText(toBlocks(msg.content));
			setMessages((prev) => {
				// find last user message
				let lastUserIdx = -1;
				for (let i = prev.length - 1; i >= 0; i--) {
					if (prev[i].role === "user") {
						lastUserIdx = i;
						break;
					}
				}
				if (
					lastUserIdx !== -1 &&
					blocksToText(prev[lastUserIdx].content) === text &&
					!prev[lastUserIdx].streaming
				) {
					return prev;
				}
				return [
					...prev,
					{
						id: nextId(),
						role: "user",
						content: toBlocks(msg.content),
						timestamp: msg.timestamp,
					},
				];
			});
			return;
		}
		// bashExecution / custom / anything else → system-ish row
		setMessages((prev) => [
			...prev,
			{
				id: nextId(),
				role: msg.role === "bashExecution" ? "bash" : "custom",
				content: toBlocks(
					msg.role === "bashExecution" ? `$ ${msg.command ?? ""}\n${msg.output ?? ""}` : msg.content,
				),
			},
		]);
	}, []);

	const loadSessions = useCallback(async () => {
		try {
			const list = await ListSessions();
			setSessions(Array.isArray(list) ? list : []);
		} catch (e: any) {
			setLastError(String(e?.message ?? e));
		}
	}, []);

	const loadWorkspaces = useCallback(async () => {
		try {
			const res = await ListWorkspaces();
			setWorkspaces(Array.isArray(res.workspaces) ? res.workspaces : []);
			setCurrentWorkspace(res.current ?? "");
		} catch (e: any) {
			setLastError(String(e?.message ?? e));
		}
	}, []);

	const resume = useCallback(
		async (session: SessionInfo) => {
			// Loading UX: clear the message list and show a centered
			// spinner while the backend switches processes/sessions.
			setSwitching(true);
			switchingRef.current = true;
			setMessages([]);
			setTools([]);
			streamRef.current = null;
			try {
				const snap = await ResumeSession(session.path);
				if (Array.isArray(snap.messages)) {
					setMessages(snap.messages.map((m: PiMessage) => fromPiMessage(m)));
				} else {
					setMessages([]);
				}
				if (snap.state) setState(snap.state);
				setRunning(true);
				setLastError("");
				// Refresh workspace list (resume may have moved cwd).
				void loadWorkspaces();
				void loadSessions();
			} catch (e: any) {
				setLastError(String(e?.message ?? e));
			} finally {
				switchingRef.current = false;
				setSwitching(false);
			}
		},
		[loadWorkspaces, loadSessions],
	);

	const switchWorkspace = useCallback(
		async (path: string) => {
			if (path === currentWorkspace) return;
			setSwitching(true);
			switchingRef.current = true;
			setMessages([]);
			setTools([]);
			streamRef.current = null;
			try {
				const snap = await SwitchWorkspace(path);
				if (Array.isArray(snap.messages)) {
					setMessages(snap.messages.map((m: PiMessage) => fromPiMessage(m)));
				} else {
					setMessages([]);
				}
				if (snap.state) setState(snap.state);
				setCurrentWorkspace(path);
				setRunning(true);
				setLastError("");
				void loadWorkspaces();
				void loadSessions();
			} catch (e: any) {
				setLastError(String(e?.message ?? e));
			} finally {
				switchingRef.current = false;
				setSwitching(false);
			}
		},
		[currentWorkspace, loadWorkspaces, loadSessions],
	);

	const addWorkspace = useCallback(async () => {
		try {
			const res = await AddWorkspaceDialog();
			setWorkspaces(Array.isArray(res.workspaces) ? res.workspaces : []);
			setCurrentWorkspace(res.current ?? "");
			void loadSessions();
		} catch (e: any) {
			setLastError(String(e?.message ?? e));
		}
	}, [loadSessions]);

	const handleEvent = useCallback(
		(raw: string | any) => {
			// Wails delivers event data as a JS value (object) when the Go
			// side emits a decoded JSON value. Accept both shapes: an object
			// arrives directly, a JSON string is parsed.
			let ev: PiEvent;
			if (typeof raw === "string") {
				try {
					ev = JSON.parse(raw);
				} catch {
					return;
				}
			} else {
				ev = raw as PiEvent;
			}
			switch (ev.type) {
				case "message_update": {
					applyDelta(ev as any);
					setState((s: PiSessionState | null) => ({ ...(s ?? ({} as PiSessionState)), isStreaming: true }));
					break;
				}
				case "message_start": {
					const e = ev as any;
					const m = e.message as PiMessage | undefined;
					// Assistant messages are built incrementally by
					// message_update deltas — do NOT create a message here
					// (would flash an empty placeholder and then a second
					// streaming slot). Only user messages land immediately.
					if (m?.role === "user") consumeMessage(m);
					break;
				}
				case "message_end": {
					const e = ev as any;
					const m = e.message as PiMessage | undefined;
					if (m?.role === "user") {
						// Echo of the same user turn: consumed only if we
						// don't already have it (dedupe inside consume).
						consumeMessage(m);
					} else if (m?.role === "assistant") {
						// Authoritative assistant content replaces the
						// streaming slot.
						consumeMessage(m);
					}
					setState((s: PiSessionState | null) => ({ ...(s ?? ({} as PiSessionState)), isStreaming: false }));
					break;
				}
				case "tool_execution_start": {
					const e = ev as any;
					setTools((prev) => [
						...prev,
						{
							id: e.toolCallId,
							name: e.toolName,
							args: e.args ?? {},
							status: "running",
							result: "",
						},
					]);
					break;
				}
				case "tool_execution_update": {
					const e = ev as any;
					setTools((prev) =>
						prev.map((t) => {
							if (t.id !== e.toolCallId || !e.partialResult) return t;
							const text = (e.partialResult?.content ?? [])
								.filter((c: any) => c?.type === "text")
								.map((c: any) => c.text)
								.join("");
							return { ...t, result: text };
						}),
					);
					break;
				}
				case "tool_execution_end": {
					const e = ev as any;
					setTools((prev) =>
						prev.map((t) => {
							if (t.id !== e.toolCallId) return t;
							const text = (e.result?.content ?? [])
								.filter((c: any) => c?.type === "text")
								.map((c: any) => c.text)
								.join("");
							return { ...t, status: e.isError ? "error" : "success", result: text };
						}),
					);
					break;
				}
				case "agent_start": {
					setBusy(true);
					break;
				}
				case "agent_settled": {
					setBusy(false);
					break;
				}
				case "turn_end": {
					const e = ev as any;
					const m = e.message as PiMessage | undefined;
					// assistant content already handled by message_end;
					// only let non-assistant extras (e.g. tool results)
					// through here.
					if (m && m.role !== "assistant" && m.role !== "user") {
						consumeMessage(m);
					}
					break;
				}
				case "agent_end": {
					const e = ev as any;
					// agent_end carries an authoritative snapshot of ALL
					// messages. Do NOT rebuild the whole list from it —
					// that would nuke mid-stream thinking/tool slots and
					// re-shuffle the display. Instead, only reconcile the
					// tail (messages after our last known point) so the
					// authoritative final content wins exactly once.
					if (Array.isArray(e.messages) && e.messages.length > 0) {
						// Convert to UI messages, then merge by position:
						// keep what we already rendered, replace any
						// trailing streaming/duplicated assistant entries
						// with the authoritative final message.
						const authoritative = (e.messages as PiMessage[]).map((m: PiMessage) => fromPiMessage(m));
						setMessages((prev) => {
							// Find the last assistant message index in both.
							const lastAssistantIdx = (list: UiMessage[]) => {
								for (let i = list.length - 1; i >= 0; i--) {
									if (list[i].role === "assistant") return i;
								}
								return -1;
							};
							const prevAsst = lastAssistantIdx(prev);
							const authAsst = lastAssistantIdx(authoritative);
							if (prevAsst === -1 || authAsst === -1 || prev.length < 1) {
								// Nothing to merge against — safety fallback.
								return authoritative;
							}
							const merged = [...prev];
							// Replace the final assistant entry with the
							// authoritative one (its final content echoes
							// what streamed; tool results after it stay).
							merged[prevAsst] = authoritative[authAsst];
							return merged;
						});
						streamRef.current = null;
					}
					break;
				}
				case "queue_update": {
					break;
				}
				case "extension_ui_request": {
					const e = ev as PiExtensionUiRequest;
					if (["select", "confirm", "input", "editor"].includes(e.method)) {
						setDialog({
							id: e.id,
							method: e.method as DialogState["method"],
							title: e.title,
							message: e.message,
							options: e.options,
							placeholder: e.placeholder,
							prefill: e.prefill,
						});
					}
					break;
				}
				default:
					break;
			}
		},
		[applyDelta, consumeMessage, setBusy],
	);

	/** Subscribe to Pi events once on mount. */
	useEffect(() => {
		const offEvent = EventsOn("pi:event", (payload: string) => handleEvent(payload));
		const offExit = EventsOn("pi:exit", () => {
			// Expected exit during a workspace/session switch: the backend
			// is restarting pi — don't tear the UI down.
			if (switchingRef.current) return;
			setRunning(false);
			setBusy(false);
			streamRef.current = null;
		});
		const offStderr = EventsOn("pi:stderr", () => {
			/* debug: ignore */
		});
		// Initial workspace label (cwd or previously chosen).
		GetWorkspace().then((ws: any) => {
			if (ws?.name) setWorkspace(ws.name);
			if (ws?.path) setWorkspacePath(ws.path);
		}).catch(() => {});
		// Initial session history.
		void loadSessions();
		// Initial workspace list.
		void loadWorkspaces();
		// Auto-start the Pi agent on launch (no manual click). Show a
		// loading state while the subprocess spins up.
		let cancelled = false;
		(async () => {
			if (cancelled) return;
			setStarting(true);
			setLastError("");
			try {
				await StartPi();
				if (cancelled) return;
				setRunning(true);
				// Pull snapshot with retry polling for async model registry
				for (let i = 0; i < 3; i++) {
					await new Promise((r) => setTimeout(r, i === 0 ? 800 : 1500));
					if (cancelled) return;
					const snap = await GetSnapshot();
					if (snap.running) {
						if (Array.isArray(snap.messages)) {
							setMessages(snap.messages.map((m: PiMessage) => fromPiMessage(m)));
						}
						if (Array.isArray(snap.models) && snap.models.length > 0) {
							setModels(snap.models);
						}
						if (snap.state) setState(snap.state);
						if (snap.state?.isStreaming) setBusy(true);
						if (Array.isArray(snap.models) && snap.models.length > 0) {
							break;
						}
					}
				}
			} catch (e: any) {
				if (!cancelled) setLastError(String(e?.message ?? e));
			} finally {
				if (!cancelled) setStarting(false);
			}
		})();
		return () => {
			cancelled = true;
			offEvent();
			offExit();
			offStderr();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [handleEvent, setBusy, loadSessions]);

	const start = useCallback(async () => {
		setStarting(true);
		setLastError("");
		try {
			await StartPi();
			setRunning(true);
			// Let startup settle, then fetch the snapshot.
			await new Promise((r) => setTimeout(r, 1200));
			refresh();
		} catch (e: any) {
			setLastError(String(e?.message ?? e));
		} finally {
			setStarting(false);
		}
	}, []);

	const stop = useCallback(async () => {
		await StopPi();
		setRunning(false);
		setBusy(false);
	}, [setBusy]);

	const refresh = useCallback(async () => {
		try {
			const snap = await GetSnapshot();
			if (snap.running) {
				setRunning(true);
				if (Array.isArray(snap.messages)) {
					setMessages(snap.messages.map((m: PiMessage) => fromPiMessage(m)));
				}
				if (Array.isArray(snap.models)) setModels(snap.models);
				if (snap.state) setState(snap.state);
				if (snap.state?.isStreaming) setBusy(true);
			} else {
				setRunning(false);
				setLastError(snap.lastError ?? "");
			}
			setWorkspace(snap.workspace ?? "");
		} catch (e: any) {
			setLastError(String(e?.message ?? e));
		}
	}, [setBusy]);

	const send = useCallback(
		async (text: string) => {
			if (!text.trim()) return;
			setBusy(true);
			setMessages((prev) => [
				...prev,
				{ id: nextId(), role: "user", content: [{ type: "text", text }] },
			]);
			try {
				await SendPrompt(text);
			} catch (e: any) {
				setLastError(String(e?.message ?? e));
				setBusy(false);
			}
		},
		[setBusy],
	);

	const abort = useCallback(async () => {
		await Abort();
	}, []);

	const newSession = useCallback(async () => {
		await NewSession();
		streamRef.current = null;
		setMessages([]);
		setTools([]);
	}, []);

	const switchModel = useCallback(
		async (modelId: string) => {
			const model = models.find((m) => m.id === modelId);
			if (!model) return;
			try {
				await SetModel(model.provider, model.id);
				setState((s: PiSessionState | null) => ({ ...(s ?? ({} as PiSessionState)), model }));
				refresh();
			} catch (e: any) {
				setLastError(String(e?.message ?? e));
			}
		},
		[models, refresh],
	);

	const changeThinking = useCallback(
		async (level: string) => {
			try {
				await SetThinking(level);
				setState((s: PiSessionState | null) => ({ ...(s ?? ({} as PiSessionState)), thinkingLevel: level }));
			} catch (e: any) {
				setLastError(String(e?.message ?? e));
			}
		},
		[],
	);

	const answerDialog = useCallback(
		async (value: string | null, confirmed?: boolean) => {
			if (!dialog) return;
			try {
				await SendDialogResponse(dialog.id, value ?? "", confirmed ?? null, value == null && confirmed == null);
			} catch {
				/* ignore */
			}
			setDialog(null);
		},
		[dialog],
	);

	return {
		running,
		starting,
		messages,
		tools,
		state,
		models,
		workspace,
		workspacePath,
		lastError,
		dialog,
		agentBusy,
		sessions,
		workspaces,
		currentWorkspace,
		switching,
		start,
		stop,
		refresh,
		send,
		abort,
		newSession,
		loadSessions,
		loadWorkspaces,
		resume,
		switchWorkspace,
		addWorkspace,
		switchModel,
		changeThinking,
		answerDialog,
	};
}

/** Convert a Pi message into our UI message shape. */
function fromPiMessage(m: PiMessage): UiMessage {
	switch (m.role) {
		case "assistant":
			return {
				id: nextId(),
				role: "assistant",
				content: toBlocks(m.content),
				streaming: false,
			};
		case "user":
			return { id: nextId(), role: "user", content: toBlocks(m.content), timestamp: m.timestamp };
		case "toolResult":
			return {
				id: nextId(),
				role: "toolResult",
				content: [],
				toolCallId: m.toolCallId,
				toolName: m.toolName,
				isError: (m as any).isError,
			};
		case "bashExecution":
			return {
				id: nextId(),
				role: "bash",
				content: toBlocks(`$ ${(m as any).command ?? ""}\n${(m as any).output ?? ""}`),
			};
		default:
			return { id: nextId(), role: "custom", content: toBlocks((m as any).content) };
	}
}
