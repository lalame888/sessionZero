import { useCallback, useEffect, useRef } from "react";

type RepeatPressOptions = {
  /** 長按後開始連發的延遲（ms） */
  delayMs?: number;
  /** 連發間隔（ms） */
  intervalMs?: number;
  disabled?: boolean;
};

/**
 * 短按觸發一次；長按後依間隔連續觸發（適合加減按鈕）。
 */
export function useRepeatPress(
  action: () => void,
  opts: RepeatPressOptions = {},
) {
  const { delayMs = 380, intervalMs = 70, disabled = false } = opts;
  const actionRef = useRef(action);
  const delayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pressedRef = useRef(false);

  useEffect(() => {
    actionRef.current = action;
  }, [action]);

  const clearTimers = useCallback(() => {
    if (delayRef.current) {
      clearTimeout(delayRef.current);
      delayRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    pressedRef.current = false;
    clearTimers();
  }, [clearTimers]);

  useEffect(() => {
    if (disabled) stop();
  }, [disabled, stop]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const start = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      if (e.button !== 0) return;
      e.preventDefault();
      pressedRef.current = true;
      actionRef.current();
      clearTimers();
      delayRef.current = setTimeout(() => {
        if (!pressedRef.current) return;
        intervalRef.current = setInterval(() => {
          if (!pressedRef.current) return;
          actionRef.current();
        }, intervalMs);
      }, delayMs);
    },
    [clearTimers, delayMs, disabled, intervalMs],
  );

  return {
    onPointerDown: start,
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
}
