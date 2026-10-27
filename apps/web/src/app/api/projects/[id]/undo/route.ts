import { NextResponse } from "next/server";
import {
  getRequestIdentity,
  requireScopeForRequest,
  apiTokenErrorResponse,
  auditAttribution,
  scopedClient,
  assertProjectOwnership,
} from "@/lib/requestIdentity";
import { undoSnapshot } from "@/lib/pipeline/isolation";
import { logAudit } from "@/lib/audit";

// Addendum 17: "Undo last run" — reverts the most recently applied run's
// snapshot back to its pre-run state (base_files). Safe by construction:
// the run's changes lived on their own branch until merge, so undo just
// restores/deletes the exact paths that run touched.
//
// POST body: { runId? } — omit runId to undo the latest applied run.
// Dual auth: browser session or Nexus API token (pipeline:run scope).

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await getRequestIdentity(req);
  if ("response" in auth) return auth.response;
  try {
    requireScopeForRequest(auth.identity, "pipeline:run");
  } catch (err) {
    const safe = apiTokenErrorResponse(err);
    if (safe) return safe;
    throw err;
  }
  const supabase = await scopedClient(auth.identity);
  const ownershipError = await assertProjectOwnership(supabase, auth.identity, id);
  if (ownershipError) return ownershipError;
  const user = { id: auth.identity.userId };

  const body = await req.json().catch(() => ({}));

  let runId = typeof body?.runId === "string" ? body.runId : "";
  if (!runId) {
    // Latest applied run for this project.
    const { data: latest } = await supabase
      .from("run_snapshots")
      .select("run_id")
      .eq("project_id", id)
      .eq("status", "applied")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latest) {
      return NextResponse.json(
        { undone: false, message: "No applied runs to undo for this project." },
        { status: 404 }
      );
    }
    runId = latest.run_id;
  }

  const result = await undoSnapshot(supabase, id, runId);

  await logAudit(supabase, {
    projectId: id,
    userId: user.id,
    actor: "user",
    action: result.undone ? "run.undone" : "run.undo_failed",
    target: runId,
    metadata: { message: result.message, via: auditAttribution(auth.identity) },
  });

  return NextResponse.json(result, { status: result.undone ? 200 : 400 });
}
