import { openrouter } from "@openrouter/ai-sdk-provider";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { SYSTEM_PROMPT, createTools, drillFrom, drillPrompt } from "@/lib/chat-tools";

export const maxDuration = 120;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const tools = createTools(messages);
  const drill = drillFrom(messages);

  const result = streamText({
    model: openrouter(process.env.OPENROUTER_MODEL ?? "anthropic/claude-haiku-4.5"),
    instructions: drill ? SYSTEM_PROMPT + drillPrompt(drill) : SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages, { tools }),
    tools,
    stopWhen: stepCountIs(6),
    // A drill-down must start with a query; don't leave that to the model's judgement.
    prepareStep: ({ stepNumber }) =>
      drill && stepNumber === 0 ? { toolChoice: { type: "tool", toolName: "querySnowflake" } } : undefined,
  });

  return result.toUIMessageStreamResponse({
    onError: (e) => (e instanceof Error ? e.message : "Something went wrong."),
  });
}
