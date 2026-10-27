"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, Loader2 } from "lucide-react";
import { useBrowserClient } from "@/lib/supabase/client";
import { setDogPhoto } from "@/server/actions/dogs";
import { DogAvatar } from "@/components/domain/request-bits";

const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_SIDE = 1024;

/** Resizes on device before upload: smaller files, no EXIF metadata kept. */
async function resize(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const toBlob = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  const webp = await toBlob("image/webp");
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await toBlob("image/jpeg");
  if (!jpeg) throw new Error("encode");
  return jpeg;
}

export function PhotoUploader({
  dogId,
  name,
  photoUrl,
  variant = "row",
}: {
  dogId: string;
  name: string;
  photoUrl: string | null;
  /** "badge": large photo with a small camera button on its corner (passport header). */
  variant?: "row" | "badge";
}) {
  const router = useRouter();
  const supabase = useBrowserClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const onFile = async (file: File) => {
    if (!file.type.startsWith("image/")) return toast.error("Choisissez une image.");
    if (file.size > MAX_INPUT_BYTES) return toast.error("Image trop lourde (15 Mo maximum).");
    if (!supabase) return toast.error("Envoi de photo indisponible pour le moment.");
    setBusy(true);
    try {
      const blob = await resize(file);
      const ext = blob.type === "image/webp" ? "webp" : "jpg";
      const path = `${dogId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("dog-photos").upload(path, blob, { contentType: blob.type, upsert: false });
      if (error) throw error;
      const r = await setDogPhoto(dogId, path);
      if (!r.ok) {
        await supabase.storage.from("dog-photos").remove([path]); // no orphan file
        toast.error(r.error);
      } else {
        toast.success("Photo mise à jour");
        startTransition(() => router.refresh());
      }
    } catch {
      toast.error("Impossible d'envoyer la photo. Réessayez.");
    } finally {
      setBusy(false);
    }
  };

  const fileInput = (
    <input
      ref={input}
      type="file"
      accept="image/*"
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) void onFile(f);
      }}
    />
  );

  if (variant === "badge") {
    return (
      <div className="relative shrink-0">
        <DogAvatar name={name} photoUrl={photoUrl} size={104} className="ring-4" />
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
            <Loader2 className="size-6 animate-spin text-white" aria-label="Envoi en cours" />
          </span>
        )}
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          aria-label={photoUrl ? "Changer la photo" : "Ajouter une photo"}
          className="absolute -right-1 -bottom-1 inline-flex size-11 items-center justify-center rounded-full bg-ink text-surface shadow-md ring-4 ring-surface transition-transform active:scale-95"
        >
          <Camera className="size-4" aria-hidden />
        </button>
        {fileInput}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <DogAvatar name={name} photoUrl={photoUrl} size={88} />
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
            <Loader2 className="size-6 animate-spin text-white" aria-label="Envoi en cours" />
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-surface px-4 text-[15px] font-medium text-ink"
      >
        <Camera className="size-4" aria-hidden /> {photoUrl ? "Changer la photo" : "Ajouter une photo"}
      </button>
      {fileInput}
    </div>
  );
}
