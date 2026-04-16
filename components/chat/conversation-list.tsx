"use client";

import { Loader2Icon, Trash2Icon } from "lucide-react";

import type { Conversation } from "@/components/chat/types";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { cn } from "@/lib/utils";

type ConversationListProps = {
  embedded: boolean;
  scrollAreaClassName: string;
  loadingList: boolean;
  conversations: Conversation[];
  activeConversationId: string | null;
  deletingConversationId: string | null;
  onStartNewChat: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
};

export function ConversationList({
  embedded,
  scrollAreaClassName,
  loadingList,
  conversations,
  activeConversationId,
  deletingConversationId,
  onStartNewChat,
  onSelectConversation,
  onDeleteConversation,
}: ConversationListProps) {
  return (
    <div className="w-full min-w-0 space-y-2">
      <Button type="button" variant="secondary" size="sm" className="w-full" onClick={onStartNewChat}>
        New chat
      </Button>
      <Separator />
      <ScrollArea
        className={cn(
          "min-h-0 overflow-hidden",
          embedded ? "h-[min(240px,34dvh)] w-full pr-0" : "h-full pr-2",
          scrollAreaClassName,
        )}
      >
        {loadingList ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2Icon className="size-3.5 animate-spin" />
            Loading...
          </div>
        ) : (
          <div className="space-y-1">
            {conversations.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "flex w-full items-stretch gap-0.5 rounded-md border border-transparent",
                  activeConversationId === c.id && "border-border bg-muted/60",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelectConversation(c.id)}
                  className={cn(
                    "min-w-0 flex-1 text-left transition-colors hover:bg-muted/80",
                    embedded ? "px-2 py-1.5 text-xs" : "px-2.5 py-2 text-sm",
                  )}
                >
                  <span className="line-clamp-2 font-medium">{c.title || "Untitled"}</span>
                  <span className={cn("mt-0.5 block text-muted-foreground tabular-nums", embedded ? "text-[10px]" : "text-xs")}>
                    {formatRelativeTime(c.created_at)}
                  </span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="mt-0.5 mb-0.5 shrink-0 text-muted-foreground hover:text-destructive"
                  disabled={deletingConversationId === c.id}
                  aria-label={`Delete conversation ${c.title || "Untitled"}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteConversation(c.id);
                  }}
                >
                  {deletingConversationId === c.id ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2Icon className="size-3.5" />
                  )}
                </Button>
              </div>
            ))}
            {!conversations.length ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                No chats yet - start a message below.
              </p>
            ) : null}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
