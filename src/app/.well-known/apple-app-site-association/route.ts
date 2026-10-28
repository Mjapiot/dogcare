/**
 * Universal links: lets iOS open these Dogcare URLs directly in the native
 * app (when installed) instead of Safari. Team ID is public information.
 */
const APP_ID = `${process.env.APPLE_TEAM_ID ?? "G2SC6845GS"}.app.dogcare.ios`;

export const dynamic = "force-static";

export function GET() {
  return Response.json(
    {
      applinks: {
        details: [
          {
            appIDs: [APP_ID],
            components: [
              { "/": "/invite/*", comment: "Group invitations" },
              { "/": "/requests/*", comment: "Care requests" },
              { "/": "/circle/join/*", comment: "Circle of trust invitations" },
              { "/": "/auth/confirm", comment: "Login links" },
            ],
          },
        ],
      },
    },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
