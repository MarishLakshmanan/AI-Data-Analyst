import { feedbackPython } from "@/lib/python-api";

export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  if (!b || typeof b.question !== "string" || typeof b.sql !== "string" || !["up", "down"].includes(b.rating))
    return Response.json({ error: "question, sql and rating (up|down) are required" }, { status: 400 });
  try {
    return Response.json(
      await feedbackPython({
        question: b.question,
        sql: b.sql,
        assumptions: Array.isArray(b.assumptions) ? b.assumptions.filter((a: unknown) => typeof a === "string") : [],
        rating: b.rating,
        comment: typeof b.comment === "string" && b.comment.trim() ? b.comment : undefined,
      }),
    );
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not save feedback" }, { status: 502 });
  }
}
