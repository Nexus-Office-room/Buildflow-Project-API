import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const baseUrl = typeof body?.base_url === "string" ? body.base_url.trim() : "";
  const apiKey = typeof body?.api_key === "string" ? body.api_key.trim() : "";
  if (!baseUrl || !apiKey) {
    return NextResponse.json({ ok: false, message: "Enter a base URL and API key first." }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(`${baseUrl.replace(/\/$/, "")}/models`);
  } catch {
    return NextResponse.json({ ok: false, message: "Enter a valid base URL." }, { status: 400 });
  }
  const hostname = target.hostname.toLowerCase();
  if (target.protocol !== "https:" || target.username || target.password || BLOCKED_HOSTS.has(hostname) || isPrivateIpv4(hostname) || hostname.endsWith(".local")) {
    return NextResponse.json({ ok: false, message: "Use a public HTTPS API base URL." }, { status: 400 });
  }

  // Verify the unsaved credential directly against the model catalog endpoint.
  // The key is never persisted, logged, or returned by this route.
  try {
    const response = await fetch(target, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (response.ok) return NextResponse.json({ ok: true, message: "Key verified. Model catalog is reachable." });
    const message = response.status === 401 || response.status === 403
      ? "The provider rejected this API key. Check the key and try again."
      : `The provider returned HTTP ${response.status}. Check the base URL and key.`;
    return NextResponse.json({ ok: false, message }, { status: 400 });
  } catch {
    return NextResponse.json({ ok: false, message: "Could not reach the provider. Check the URL and try again." }, { status: 400 });
  }
}
