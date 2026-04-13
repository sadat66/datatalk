import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { ChatPanel } from "@/components/chat-panel";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function DashboardChatPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4 sm:px-6">
      <div className="shrink-0">
        <Link
          href="/dashboard"
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "inline-flex gap-1.5 text-muted-foreground",
          )}
        >
          <ArrowLeftIcon className="size-4" />
          Back to dashboard
        </Link>
      </div>
      <div className="min-h-0 flex-1">
        <ChatPanel variant="page" initialConversationId={conversationId} />
      </div>
    </div>
  );
}
