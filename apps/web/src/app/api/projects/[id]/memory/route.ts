import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: memory, error } = await supabase
    .from("project_memory")
    .select("*")
    .eq("project_id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ memory });
}

// User-editable Memory Board: lets the user correct/append tech stack,
// decisions, and open issues directly.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const allowed = ["tech_stack", "decisions", "open_issues", "summary"] as const;
  const patch: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) patch[key] = body[key];
  }
  patch.updated_at = new Date().toISOString();

  // A Design Studio brief can be the first memory saved for a new project,
  // before the first pipeline run has lazily created its memory row.
  const { data: existing, error: lookupError } = await supabase
    .from("project_memory")
    .select("project_id")
    .eq("project_id", id)
    .maybeSingle();

  if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 500 });

  const result = existing
    ? await supabase
        .from("project_memory")
        .update(patch)
        .eq("project_id", id)
        .select()
        .single()
    : await supabase
        .from("project_memory")
        .insert({
          project_id: id,
          tech_stack: [],
          decisions: [],
          open_issues: [],
          summary: "",
          ...patch,
        })
        .select()
        .single();

  const { data: memory, error } = result;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit(supabase, {
    projectId: id,
    userId: user.id,
    actor: "user",
    action: "memory.update",
    target: null,
    metadata: { fields: Object.keys(patch).filter((k) => k !== "updated_at") },
  });

  return NextResponse.json({ memory });
}
