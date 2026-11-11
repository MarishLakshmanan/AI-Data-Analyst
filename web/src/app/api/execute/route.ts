import { executePython } from "@/lib/python-api";

export async function POST(req: Request) {
  const { sql } = await req.json();
  if (typeof sql !== "string" || !sql.trim())
    return Response.json({ error: "sql is required" }, { status: 400 });
  try {
    // FastAPI re-validates the SQL with the guardrail before running it.
    return Response.json(await executePython(sql));
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Execution failed" },
      { status: 502 },
    );
  }
}
