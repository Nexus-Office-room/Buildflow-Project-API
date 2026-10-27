import { NextResponse } from "next/server";
import {
  getRequestIdentity,
  requireScopeForRequest,
  apiTokenErrorResponse,
  scopedClient,
} from "@/lib/requestIdentity";
import { DEFAULT_PROVIDER_CONFIG } from "@/lib/providers";
import { ROLES } from "@/types/db";

export async function GET(req: Request) {
  // Dual auth: browser session or Nexus API token (projects:read).
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
  const userId = auth.identity.userId;

  // Token requests use the service-role client (RLS bypassed), so the owner
  // filter is mandatory here; session requests get it too (RLS would enforce
  // the same, but the explicit filter keeps one code path).
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ projects: data });
}

export async function POST(req: Request) {
  const auth = await getRequestIdentity(req);
  if ("response" in auth) return auth.response;
  try {
    requireScopeForRequest(auth.identity, "projects:read");
  } catch (err) {
    const safe = apiTokenErrorResponse(err);
    if (safe) return safe;
    throw err;
  }
  const userId = auth.identity.userId;
  const supabase = await scopedClient(auth.identity);

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const { data: project, error } = await supabase
    .from("projects")
    .insert({ name, user_id: userId })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Seed the persistent memory row immediately so the Memory Board has
  // something to show even before the first pipeline run.
  await supabase.from("project_memory").insert({ project_id: project.id });

  // Seed explicit role_models rows using the default provider so the
  // Settings UI shows what will actually run (and this stays correct if
  // DEFAULT_PROVIDER_CONFIG ever changes after other projects already
  // have their own saved rows).
  await supabase.from("role_models").insert(
    ROLES.map((role) => ({
      project_id: project.id,
      role,
      provider: DEFAULT_PROVIDER_CONFIG.provider,
      model: DEFAULT_PROVIDER_CONFIG.model,
    }))
  );

  return NextResponse.json({ project }, { status: 201 });
}
