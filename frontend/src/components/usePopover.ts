import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shared popover behavior: open state, outside-click close, Escape close.
 * `onOpen` runs when the popover transitions from closed to open (e.g. to
 * refresh a model list).
 */
export function usePopover(onOpen?: () => void) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const onOpenRef = useRef(onOpen);
	onOpenRef.current = onOpen;

	useEffect(() => {
		if (!open) return;
		function handleMouseDown(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setOpen(false);
			}
		}
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") setOpen(false);
		}
		document.addEventListener("mousedown", handleMouseDown);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("mousedown", handleMouseDown);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [open]);

	const toggle = useCallback(() => {
		setOpen((prev) => {
			if (!prev) onOpenRef.current?.();
			return !prev;
		});
	}, []);

	const close = useCallback(() => setOpen(false), []);

	return { open, toggle, close, ref };
}
