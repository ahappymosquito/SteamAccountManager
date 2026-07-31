/** Pointer-based list reordering that works consistently in desktop WebViews. */
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export function usePointerReorder(
  onReorder: (sourceId: string, targetId: string) => void,
) {
  const [draggingId, setDraggingId] = useState<string>();
  const [targetId, setTargetId] = useState<string>();
  const draggingRef = useRef<string | undefined>(undefined);
  const targetRef = useRef<string | undefined>(undefined);
  const callbackRef = useRef(onReorder);
  const suppressClickRef = useRef(false);
  callbackRef.current = onReorder;

  const reset = () => {
    draggingRef.current = undefined;
    targetRef.current = undefined;
    setDraggingId(undefined);
    setTargetId(undefined);
  };

  useEffect(() => {
    const finish = () => {
      const source = draggingRef.current;
      const target = targetRef.current;
      if (source && target && source !== target) {
        suppressClickRef.current = true;
        callbackRef.current(source, target);
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
      reset();
    };
    const cancel = () => reset();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const start = (id: string, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    draggingRef.current = id;
    targetRef.current = id;
    setDraggingId(id);
    setTargetId(id);
  };

  const enter = (id: string, event: ReactPointerEvent<HTMLElement>) => {
    if (!draggingRef.current || event.buttons === 0) return;
    targetRef.current = id;
    setTargetId(id);
  };

  const consumeClick = () => {
    const shouldSuppress = suppressClickRef.current;
    suppressClickRef.current = false;
    return shouldSuppress;
  };

  return { draggingId, targetId, start, enter, consumeClick };
}
