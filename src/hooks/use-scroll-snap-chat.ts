"use client";

import { useEffect, useRef } from "react";

interface ScrollSnapOptions {
  // List of conversation IDs in order (newest first)
  conversationIds: string[];
  currentId: string | null;
  // Called when user scrolls past the boundary
  onNavigate: (conversationId: string) => void;
  // The scroll container ref
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Scroll-snap chat navigation:
 * - When user scrolls UP and is already at the top, accumulate the scroll
 *   delta. Once enough cumulative delta is reached, navigate to the
 *   PREVIOUS (newer) conversation.
 * - When user scrolls DOWN and is already at the bottom, accumulate the
 *   scroll delta. Once enough cumulative delta is reached, navigate to
 *   the NEXT (older) conversation.
 *
 * Uses cumulative delta instead of event counting because trackpads fire
 * many small wheel events (momentum scrolling), which made the old
 * "2 consecutive events" threshold far too easy to trigger accidentally.
 * A mouse wheel fires fewer, larger events. Cumulative delta treats both
 * consistently — the user has to scroll ~200px worth of wheel delta at
 * the boundary to trigger navigation.
 */
export function useScrollSnapChat({
  conversationIds,
  currentId,
  onNavigate,
  scrollRef,
}: ScrollSnapOptions) {
  // Cumulative delta at each boundary (resets after inactivity)
  const topDeltaAccum = useRef(0);
  const bottomDeltaAccum = useRef(0);
  const lastWheelTime = useRef(0);
  const isNavigating = useRef(false);

  // Thresholds — tuned for a deliberate gesture without being too hard
  const NAV_THRESHOLD = 200; // px of cumulative wheel delta needed to navigate
  const RESET_MS = 800; // reset accumulator after this much inactivity
  const NAV_COOLDOWN_MS = 1500; // block re-navigation for this long after navigating
  const MIN_EVENT_DELTA = 4; // ignore tiny trackpad jitter (sub-pixel noise)

  // Reset accumulators when conversation changes
  useEffect(() => {
    topDeltaAccum.current = 0;
    bottomDeltaAccum.current = 0;
    isNavigating.current = false;
  }, [currentId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      // Block during navigation cooldown
      if (isNavigating.current) return;

      // Ignore tiny jitter events (trackpad sub-pixel noise)
      if (Math.abs(e.deltaY) < MIN_EVENT_DELTA) return;

      const scrollTop = el.scrollTop;
      const scrollHeight = el.scrollHeight;
      const clientHeight = el.clientHeight;
      const hasScrollableContent = scrollHeight > clientHeight + 4;
      const isAtTop = scrollTop <= 2;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 2;
      const now = Date.now();

      // Reset accumulators if there was a gap in scrolling (user paused)
      if (now - lastWheelTime.current > RESET_MS) {
        topDeltaAccum.current = 0;
        bottomDeltaAccum.current = 0;
      }
      lastWheelTime.current = now;

      // Only accumulate when at boundaries or when no scrollable content
      if (e.deltaY < 0 && (isAtTop || !hasScrollableContent)) {
        // Wheel up at top — accumulate upward delta
        topDeltaAccum.current += Math.abs(e.deltaY);
        bottomDeltaAccum.current = 0; // reset opposite direction

        if (topDeltaAccum.current >= NAV_THRESHOLD) {
          const currentIdx = conversationIds.indexOf(currentId || "");
          if (currentIdx > 0) {
            isNavigating.current = true;
            topDeltaAccum.current = 0;
            onNavigate(conversationIds[currentIdx - 1]);
            // Cooldown to prevent accidental double-navigation from
            // trackpad momentum continuing after the switch
            setTimeout(() => {
              isNavigating.current = false;
            }, NAV_COOLDOWN_MS);
          } else {
            // No previous conversation — clamp the accumulator so it
            // doesn't keep growing (prevents a delayed trigger later)
            topDeltaAccum.current = 0;
          }
        }
      } else if (e.deltaY > 0 && (isAtBottom || !hasScrollableContent)) {
        // Wheel down at bottom — accumulate downward delta
        bottomDeltaAccum.current += Math.abs(e.deltaY);
        topDeltaAccum.current = 0; // reset opposite direction

        if (bottomDeltaAccum.current >= NAV_THRESHOLD) {
          const currentIdx = conversationIds.indexOf(currentId || "");
          if (currentIdx >= 0 && currentIdx < conversationIds.length - 1) {
            isNavigating.current = true;
            bottomDeltaAccum.current = 0;
            onNavigate(conversationIds[currentIdx + 1]);
            setTimeout(() => {
              isNavigating.current = false;
            }, NAV_COOLDOWN_MS);
          } else {
            // No next conversation
            bottomDeltaAccum.current = 0;
          }
        }
      } else {
        // User is scrolling within the content (not at boundary) — reset
        // both accumulators so they have to re-accumulate at the boundary
        topDeltaAccum.current = 0;
        bottomDeltaAccum.current = 0;
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: true });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [conversationIds, currentId, onNavigate, scrollRef]);
}
