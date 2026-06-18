// ONDC BAP `on_issue_status` callback — IGM v1.0.0 resolution callback.
//
// IGM v1.0.0 delivers the final resolution via a separate `on_issue_status`
// action, while v2.0.0 reuses `on_issue` for every state transition. The
// payload shape (issue.id + issue_actions.respondent_actions[] + resolution)
// is the same one our `on_issue` handler already reads, so this route just
// delegates to that POST handler.
//
// Required because next.config.ts rewrites `/ondc/:path*` → `/api/ondc/:path*`,
// which bypasses the `/ondc/[action]` fan-out. Without this file, the workbench
// POST to `/ondc/on_issue_status` falls through to Next's default not-found page
// (HTML 200), which the workbench treats as a NACK and step 15 of the IGM v1.0
// Delivery Flow stays red.
export { POST } from "@/app/api/ondc/on_issue/route";
export const runtime = "nodejs";
