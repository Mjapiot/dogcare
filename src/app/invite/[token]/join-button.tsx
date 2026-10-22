"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { acceptInvitation } from "@/server/actions/groups";
import { PillButton } from "@/components/ui/kit";

export function JoinButton({ token, next }: { token: string; next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <PillButton
        size="lg"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await acceptInvitation(token);
            if (!result.ok) return setError(result.error);
            toast.success("Bienvenue dans le groupe !");
            router.replace(next);
          })
        }
      >
        Rejoindre le groupe
      </PillButton>
      {error && (
        <p className="text-[14px] font-medium text-[#9b1c14]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
