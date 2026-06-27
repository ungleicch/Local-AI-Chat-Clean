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
 * - When user scrolls UP and is already at the top, on the second consecutive
 *   scroll-up-at-top event, navigate to the PREVIOUS (newer) conversation.
 * - When user scrolls DOWN and is already at the bottom, on the second consecutive
 *   scroll-down-at-bottom event, navigate to the NEXT (older) conversation.
 *
 * This implements the "scroll twice at boundary to switch chats" behavior.
 */
export function useScrollSnapChat({
  conversationIds,
  currentId,
  onNavigate,
  scrollRef,
}: ScrollSnapOptions) {
  // Track consecutive boundary hits
  const topHitCount = useRef(0);
  const bottomHitCount = useRef(0);
  const lastTopHitTime = useRef(0);
  const lastBottomHitTime = useRef(0);
  const isNavigating = useRef(false);

  // Reset counts when conversation changes
  useEffect(() => {
    topHitCount.current = 0;
    bottomHitCount.current = 0;
    isNavigating.current = false;
  }, [currentId]);

  // Listen for wheel events directly — these fire even when there's no
  // scrollable content (empty chat), which is exactly when we need them most.
  // Also handles scroll position changes via the wheel event.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (isNavigating.current) return;
      const scrollTop = el.scrollTop;
      const scrollHeight = el.scrollHeight;
      const clientHeight = el.clientHeight;
      const hasScrollableContent = scrollHeight > clientHeight + 4;
      const isAtTop = scrollTop <= 2;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 2;
      const now = Date.now();
      const RESET_MS = 600;

      // Only handle wheel when at boundaries or when no scrollable content
      if (e.deltaY < 0 && (isAtTop || !hasScrollableContent)) {
        // Wheel up at top
        if (now - lastTopHitTime.current > RESET_MS) {
          topHitCount.current = 1;
        } else {
          topHitCount.current += 1;
        }
        lastTopHitTime.current = now;

        if (topHitCount.current >= 2) {
          const currentIdx = conversationIds.indexOf(currentId || "");
          if (currentIdx > 0) {
            isNavigating.current = true;
            onNavigate(conversationIds[currentIdx - 1]);
            topHitCount.current = 0;
            setTimeout(() => {
              isNavigating.current = false;
            }, 500);
          }
        }
      } else if (e.deltaY > 0 && (isAtBottom || !hasScrollableContent)) {
        // Wheel down at bottom
        if (now - lastBottomHitTime.current > RESET_MS) {
          bottomHitCount.current = 1;
        } else {
          bottomHitCount.current += 1;
        }
        lastBottomHitTime.current = now;

        if (bottomHitCount.current >= 2) {
          const currentIdx = conversationIds.indexOf(currentId || "");
          if (currentIdx >= 0 && currentIdx < conversationIds.length - 1) {
            isNavigating.current = true;
            onNavigate(conversationIds[currentIdx + 1]);
            bottomHitCount.current = 0;
            setTimeout(() => {
              isNavigating.current = false;
            }, 500);
          }
        }
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: true });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [conversationIds, currentId, onNavigate, scrollRef]);
}
