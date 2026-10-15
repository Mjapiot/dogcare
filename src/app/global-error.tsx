"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="fr">
      <body style={{ fontFamily: "system-ui", background: "#ebe8e2", color: "#1c1b19", padding: 32 }}>
        <h1>Une erreur est survenue</h1>
        <p>Réessayez dans un instant.</p>
        <button type="button" onClick={reset} style={{ minHeight: 44, padding: "0 20px", borderRadius: 999 }}>
          Réessayer
        </button>
      </body>
    </html>
  );
}
