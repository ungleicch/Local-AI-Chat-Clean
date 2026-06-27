"use client";

import { useRef, useState } from "react";
import { Plus, Settings, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface ConversationItem {
  id: string;
  title: string;
  pinned: boolean;
  updatedAt: string;
}

interface CircularSidebarProps {
  conversations: ConversationItem[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
}

/**
 * Hover-reveal circular sidebar.
 * Conversations shown as vertical line segments.
 * Current chat centered; older below, newer above.
 * Hover shows title + delete button; click to open.
 */
export function CircularSidebar({
  conversations,
  currentId,
  onSelect,
  onNew,
  onDelete,
  onOpenSettings,
}: CircularSidebarProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [mouseInZone, setMouseInZone] = useState(false);
  const hideTimer = useRef<NodeJS.Timeout | null>(null);

  const sorted = [...conversations].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  const currentIndex = sorted.findIndex((c) => c.id === currentId);
  const centerIndex = currentIndex >= 0 ? currentIndex : Math.floor(sorted.length / 2);
  const reordered = [
    ...sorted.slice(0, centerIndex).reverse(),
    sorted[centerIndex],
    ...sorted.slice(centerIndex + 1),
  ].filter(Boolean);

  const handleMouseEnter = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setMouseInZone(true);
  };
  const handleMouseLeave = () => {
    hideTimer.current = setTimeout(() => setMouseInZone(false), 150);
  };

  return (
    <div
      className="fixed left-0 top-0 z-30 h-full w-8"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <AnimatePresence>
        {mouseInZone && (
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="absolute inset-y-0 left-0 flex w-64 flex-col bg-card border-r border-border"
          >
            <div className="flex items-center justify-end p-3">
              <div className="flex gap-1">
                <button
                  onClick={onNew}
                  className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent transition-colors"
                  title="New chat"
                >
                  <Plus className="h-4 w-4" />
                </button>
                <button
                  onClick={onOpenSettings}
                  className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent transition-colors"
                  title="Settings"
                >
                  <Settings className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 flex flex-col justify-center px-3 py-2 overflow-y-auto">
              {reordered.length === 0 && (
                <p className="text-center text-xs text-muted-foreground py-8">
                  No conversations yet.
                  <br />
                  Click + to start.
                </p>
              )}
              <div className="space-y-0.5">
                {reordered.map((conv) => {
                  const isCurrent = conv.id === currentId;
                  const isHovered = conv.id === hovered;
                  return (
                    <ConvLine
                      key={conv.id}
                      conv={conv}
                      isCurrent={isCurrent}
                      isHovered={isHovered}
                      onHover={(id) => setHovered(id)}
                      onSelect={onSelect}
                      onDelete={onDelete}
                    />
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ConvLine({
  conv,
  isCurrent,
  isHovered,
  onHover,
  onSelect,
  onDelete,
}: {
  conv: ConversationItem;
  isCurrent: boolean;
  isHovered: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div
      className="relative group"
      onMouseEnter={() => onHover(conv.id)}
      onMouseLeave={() => {
        onHover(null);
        setConfirmDelete(false);
      }}
    >
      <button
        onClick={() => onSelect(conv.id)}
        className={cn(
          "w-full h-7 flex items-center transition-all duration-200 rounded-md",
          isCurrent && !isHovered && "bg-foreground/5",
          isHovered && "bg-accent"
        )}
      >
        <div
          className={cn(
            "h-0.5 rounded-full transition-all duration-300 mx-3",
            isCurrent ? "w-8 bg-foreground" : "w-3 bg-muted-foreground/40",
            isHovered && "w-12 bg-foreground"
          )}
        />
        <AnimatePresence>
          {isHovered && (
            <motion.div
              initial={{ opacity: 0, x: -5 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -5 }}
              transition={{ duration: 0.15 }}
              className="flex-1 text-left text-xs truncate pr-8"
            >
              {conv.title}
            </motion.div>
          )}
        </AnimatePresence>
      </button>

      {/* Delete button — appears on hover */}
      {isHovered && (
        <motion.button
          initial={{ opacity: 0, x: 5 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 5 }}
          transition={{ duration: 0.15 }}
          onClick={(e) => {
            e.stopPropagation();
            if (confirmDelete) {
              onDelete(conv.id);
            } else {
              setConfirmDelete(true);
              setTimeout(() => setConfirmDelete(false), 2500);
            }
          }}
          className={cn(
            "absolute right-1 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded transition-colors z-10",
            confirmDelete
              ? "bg-destructive text-destructive-foreground"
              : "text-muted-foreground hover:text-destructive hover:bg-destructive/10 bg-background/80"
          )}
          title={confirmDelete ? "Click again to confirm" : "Delete chat"}
        >
          <Trash2 className="h-3 w-3" />
        </motion.button>
      )}

      {/* Preview tooltip when hovered but not selected */}
      {isHovered && !isCurrent && (
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          transition={{ duration: 0.15, delay: 0.2 }}
          className="absolute left-full ml-3 top-1/2 -translate-y-1/2 z-50 pointer-events-none"
        >
          <div className="rounded-lg border border-border bg-popover shadow-lg px-3 py-1.5 text-xs max-w-[200px]">
            <div className="font-medium truncate">{conv.title}</div>
            <div className="text-[0.65rem] text-muted-foreground mt-0.5">
              {new Date(conv.updatedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
              {conv.pinned && " · pinned"}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
