"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, PillButton, TextArea } from "@/components/ui/kit";

/** Confirmation step for sensitive actions (cancel, remove, delete…). */
export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Retour",
  destructive,
  withReason,
  reasonLabel = "Motif (facultatif)",
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  withReason?: boolean;
  reasonLabel?: string;
  pending?: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setReason("");
        onOpenChange(o);
      }}
    >
      <DialogContent className="rounded-[28px] bg-surface p-6" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold tracking-tight">{title}</DialogTitle>
          {description && <DialogDescription className="text-[15px] text-ink-2">{description}</DialogDescription>}
        </DialogHeader>
        {withReason && (
          <Field label={reasonLabel} htmlFor="confirm-reason">
            <TextArea id="confirm-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        <div className="flex flex-col gap-2">
          <PillButton variant={destructive ? "danger" : "primary"} loading={pending} onClick={() => onConfirm(reason)}>
            {confirmLabel}
          </PillButton>
          <PillButton variant="ghost" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </PillButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
