import { NextResponse } from "next/server";
import { z } from "zod";
import { createWorkspace, listWorkspaces } from "@/lib/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const workspaces = await listWorkspaces();
  return NextResponse.json({ workspaces: workspaces.map((workspace) => ({ ...workspace, createdAt: workspace.createdAt.toISOString(), updatedAt: workspace.updatedAt.toISOString() })) });
}

const body = z.object({ name: z.string().trim().min(1).max(80) });

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Give the workspace a name." }, { status: 400 });
  const workspace = await createWorkspace(parsed.data.name);
  return NextResponse.json({ workspace: { ...workspace, createdAt: workspace.createdAt.toISOString(), updatedAt: workspace.updatedAt.toISOString() } }, { status: 201 });
}
