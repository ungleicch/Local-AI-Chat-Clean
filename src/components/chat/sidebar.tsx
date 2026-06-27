"use client";

import { Plus, MessageSquare, Trash2, Pin, PinOff, Settings, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface ConversationItem {
  id: string;
  title: string;
  pinned: boolean;
  updatedAt: string;
}

interface SidebarProps {
  conversations: ConversationItem[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onOpenSettings: () => void;
  isOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({
  conversations,
  currentId,
  onSelect,
  onNew,
  onDelete,
  onTogglePin,
  onOpenSettings,
  isOpen,
  onClose,
}: SidebarProps) {
  const sorted = [...conversations].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={cn(
          "fixed md:relative inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-border bg-sidebar transition-transform md:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="font-semibold text-sm">LocalAI Studio</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 md:hidden"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* New chat button */}
        <div className="p-2">
          <Button
            onClick={onNew}
            variant="outline"
            className="w-full justify-start gap-2"
          >
            <Plus className="h-4 w-4" /> New chat
          </Button>
        </div>

        {/* Conversation list */}
        <ScrollArea className="flex-1 px-2">
          <div className="space-y-0.5 pb-2">
            {sorted.length === 0 && (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                No conversations yet.
                <br />
                Click "New chat" to begin.
              </p>
            )}
            {sorted.map((c) => (
              <ConversationRow
                key={c.id}
                conv={c}
                active={c.id === currentId}
                onSelect={() => onSelect(c.id)}
                onDelete={() => onDelete(c.id)}
                onTogglePin={() => onTogglePin(c.id)}
              />
            ))}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="border-t border-sidebar-border p-2">
          <Button
            variant="ghost"
            onClick={onOpenSettings}
            className="w-full justify-start gap-2 text-sm"
          >
            <Settings className="h-4 w-4" /> Settings
          </Button>
        </div>
      </aside>
    </>
  );
}

function ConversationRow({
  conv,
  active,
  onSelect,
  onDelete,
  onTogglePin,
}: {
  conv: ConversationItem;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm cursor-pointer transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "hover:bg-sidebar-accent/50 text-sidebar-foreground/80"
      )}
      onClick={onSelect}
    >
      <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 opacity-60" />
      <span className="flex-1 truncate text-[0.8rem]">{conv.title}</span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
          title={conv.pinned ? "Unpin" : "Pin"}
        >
          {conv.pinned ? (
            <PinOff className="h-3 w-3" />
          ) : (
            <Pin className="h-3 w-3" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            if (confirmDelete) {
              onDelete();
            } else {
              setConfirmDelete(true);
              setTimeout(() => setConfirmDelete(false), 2500);
            }
          }}
          title={confirmDelete ? "Click again to confirm" : "Delete"}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      {conv.pinned && (
        <Pin className="h-3 w-3 flex-shrink-0 opacity-60 group-hover:opacity-0" />
      )}
    </div>
  );
}
