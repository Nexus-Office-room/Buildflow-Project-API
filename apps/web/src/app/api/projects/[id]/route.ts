import { NextResponse } from "next/server";
import {
  getRequestIdentity,
  requireScopeForRequest,
  apiTokenErrorResponse,
  scopedClient,
  assertProjectOwnership,
} from "@/lib/requestIdentity";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await getRequestIdentity(req);
  if ("response" in auth) return auth.response;
  try {
    requireScopeForRequest(auth.identity, "projects:read");
  } catch (err) {
    const safe = apiTokenErrorResponse(err);
    if (safe) return safe;
    throw err;
  }
  const supabase = await scopedClient(auth.identity);
  const ownershipError = await assertProjectOwnership(supabase, auth.identity, id);
  if (ownershipError) return ownershipError;

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  if (projectError || !project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: memory } = await supabase
    .from("project_memory")
    .select("*")
    .eq("project_id", id)
    .maybeSingle();

  return NextResponse.json({ project, memory });
}

// Body: { github_repo?: string, vercel_project_id?: string,
//          is_pro?: boolean, show_preview_watermark?: boolean,
//          watermark_deployed_site?: boolean }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await getRequestIdentity(req);
  if ("response" in auth) return auth.response;
  try {
    requireScopeForRequest(auth.identity, "projects:read");
  } catch (err) {
    const safe = apiTokenErrorResponse(err);
    if (safe) return safe;
    throw err;
  }
  const supabase = await scopedClient(auth.identity);
  const ownershipError = await assertProjectOwnership(supabase, auth.identity, id);
  if (ownershipError) return ownershipError;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof body.github_repo === "string") {
    patch.github_repo = body.github_repo.trim() || null;
    // Addendum 9: switching repos resets the 3-way sync base so the next
    // push doesn't fabricate conflicts against the OLD repo's HEAD, and
    // records the owner context from the owner/repo full name. Project
    // history (memory, runs, deploys) is intentionally untouched.
    patch.last_synced_commit_sha = null;
    const trimmed = body.github_repo.trim();
    if (trimmed.includes("/")) patch.github_owner = trimmed.split("/")[0];
  }
  if (typeof body.vercel_project_id === "string") {
    patch.vercel_project_id = body.vercel_project_id.trim() || null;
  }
  if (typeof body.is_pro === "boolean") patch.is_pro = body.is_pro;
  if (typeof body.show_preview_watermark === "boolean") {
    patch.show_preview_watermark = body.show_preview_watermark;
  }
  if (typeof body.watermark_deployed_site === "boolean") {
    patch.watermark_deployed_site = body.watermark_deployed_site;
  }
  patch.updated_at = new Date().toISOString();

  const { data: project, error } = await supabase
    .from("projects")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ project });
}
