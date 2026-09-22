import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "@/lib/env";

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set -- required for catalog classification/listing generation");
  }
  cachedClient ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return cachedClient;
}

/** Thrown when Claude's tool-call input doesn't match the schema it was asked to follow -- an expected failure mode for a model call, not a bug, so callers can catch it specifically (e.g. route to a review queue) rather than crashing a batch job. */
export class LlmValidationError extends Error {
  readonly issues: z.core.$ZodIssue[];

  constructor(message: string, issues: z.core.$ZodIssue[]) {
    super(message);
    this.name = "LlmValidationError";
    this.issues = issues;
  }
}

export interface StructuredCallOptions<Schema extends z.ZodType> {
  system: string;
  prompt: string;
  schema: Schema;
  /** Name the model calls the tool by -- also shows up in Claude's own reasoning, so make it descriptive (e.g. "classify_product", not "output"). */
  toolName: string;
  toolDescription: string;
  maxTokens?: number;
}

/**
 * Calls Claude and forces a single structured response via Anthropic's
 * tool-use mechanism (there's no separate "JSON mode" API) -- `schema` is
 * converted to a JSON Schema with zod 4's native `z.toJSONSchema` and
 * handed to Claude as the one tool it's allowed to call, with
 * `tool_choice` pinned to that tool so it can't respond with plain text
 * instead.
 *
 * The returned tool input is re-validated against `schema` on this side
 * rather than trusted as-is -- a model can still return a value that's
 * JSON-schema-shaped but fails a Zod refinement (or just drift over a
 * model swap), and this project's convention throughout (see
 * lib/aliexpress/client.ts) is to treat every external API response as
 * unverified until parsed.
 */
export async function callStructured<Schema extends z.ZodType>(
  options: StructuredCallOptions<Schema>
): Promise<z.infer<Schema>> {
  const client = getClient();
  const message = await client.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: options.maxTokens ?? 4096,
    system: options.system,
    messages: [{ role: "user", content: options.prompt }],
    tools: [
      {
        name: options.toolName,
        description: options.toolDescription,
        input_schema: z.toJSONSchema(options.schema) as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: options.toolName },
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse) {
    throw new Error(`Claude didn't call the "${options.toolName}" tool -- stop_reason was "${message.stop_reason}"`);
  }

  const parsed = options.schema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new LlmValidationError(
      `Claude's "${options.toolName}" response didn't match the expected schema`,
      parsed.error.issues
    );
  }
  return parsed.data;
}
