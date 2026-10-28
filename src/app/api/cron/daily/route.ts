import { isAuthorizedCron } from "@/lib/cron";
import { runDailyJob } from "@/server/push";

/**
 * Daily job (Vercel Cron, around 18:00 Paris time): tomorrow's reminders,
 * guests whose access ends tomorrow, then push delivery.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await runDailyJob();
  return Response.json(result, { status: result.ok ? 200 : 500 });
}
