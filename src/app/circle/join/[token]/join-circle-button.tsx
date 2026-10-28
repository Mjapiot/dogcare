"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { acceptCircleInvitation } from "@/server/actions/circle";
import { PillButton } from "@/components/ui/kit";

export function JoinCircleButton({ token }: { token: string }) {
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
            const result = await acceptCircleInvitation(token);
            if (!result.ok) return setError(result.error);
            toast.success("Vous faites partie du cercle");
            router.replace(`/circle/${result.data.dogId}`);
          })
        }
      >
        Accepter l&apos;invitation
      </PillButton>
      {error && (
        <p className="text-[14px] font-medium text-[#9b1c14]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
