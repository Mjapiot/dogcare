import "server-only";

type MaybePgError = { code?: string; message?: string } | null | undefined;

/**
 * Turns a database error into a message safe to show. Business errors raised
 * by our SQL (SQLSTATE P0001) are already written in French for users; other
 * errors are logged server-side and replaced by a neutral message.
 */
export function toUserMessage(error: MaybePgError, fallback = "Une erreur est survenue. Réessayez."): string {
  if (!error) return fallback;
  if (error.code === "P0001" && error.message) return error.message;
  if (error.code === "42501") return "Vous n'avez pas les droits pour cette action.";
  if (error.code === "23505") return "Cet élément existe déjà.";
  if (error.code === "23503") return "Cet élément n'est plus disponible.";
  if (error.code === "23514") return "Certaines valeurs ne sont pas valides.";
  console.error("[dogcare] database error", error.code, error.message);
  return fallback;
}
