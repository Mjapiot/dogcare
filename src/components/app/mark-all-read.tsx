"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { markAllNotificationsRead } from "@/server/actions/notifications";
import { PillButton } from "@/components/ui/kit";

export function MarkAllRead() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <PillButton
      size="sm"
      variant="soft"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await markAllNotificationsRead();
          if (!r.ok) return void toast.error(r.error);
          router.refresh();
        })
      }
    >
      Tout marquer comme lu
    </PillButton>
  );
}
