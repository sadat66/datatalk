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
    <>
      <Button type="button" variant="secondary" size="sm" className="w-full" onClick={onStartNewChat}>
        New chat
      </Button>
      <Separator />
      <ScrollArea
        className={embedded ? "h-[120px] pr-2" : cn("min-h-0 overflow-hidden pr-2", scrollAreaClassName)}
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
                  "flex items-stretch gap-0.5 rounded-md border border-transparent",
                  activeConversationId === c.id && "border-border bg-muted/60",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelectConversation(c.id)}
                  className="min-w-0 flex-1 px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/80"
                >
                  <span className="line-clamp-2 font-medium">{c.title || "Untitled"}</span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground tabular-nums">
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
    </>
  );
}
