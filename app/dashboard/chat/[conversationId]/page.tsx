import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { ChatPanel } from "@/components/chat-panel";
import { buttonVariants } from "@/components/ui/button";
import { getConversationsPanelData } from "@/lib/conversations/panel-data";
import { cn } from "@/lib/utils";

export default async function DashboardChatPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;

  let initialPanelData;
  try {
    initialPanelData = await getConversationsPanelData(conversationId);
  } catch (e) {
    if (e instanceof Error && e.message === "Conversation not found") {
      notFound();
    }
    throw e;
  }

  if (!initialPanelData) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:gap-3 sm:px-6 sm:py-4 sm:pb-6">
      <div className="shrink-0">
        <Link
          href="/dashboard/chat"
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "inline-flex gap-1.5 text-muted-foreground",
          )}
        >
          <ArrowLeftIcon className="size-4" />
          All chats
        </Link>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <ChatPanel
          variant="page"
          initialConversationId={conversationId}
          initialPanelData={initialPanelData}
        />
      </div>
    </div>
  );
}
