import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/env", () => ({
  env: {
    ANTHROPIC_API_KEY: "sk-ant-test-123", // gitleaks:allow -- fake, test-only, not a real secret
    ANTHROPIC_MODEL: "claude-sonnet-5",
  },
}));

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mocks.create };
  },
}));

const { callStructured, LlmValidationError } = await import("@/lib/llm/client");

beforeEach(() => {
  mocks.create.mockReset();
});

const schema = z.object({ material: z.enum(["bamboo", "wood", "plastic"]), confidence: z.number() });

describe("callStructured", () => {
  it("forces the named tool and returns its validated input", async () => {
    mocks.create.mockResolvedValue({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "t1", name: "classify", input: { material: "bamboo", confidence: 0.92 } }],
    });

    const result = await callStructured({
      system: "You are a classifier.",
      prompt: "Classify this product.",
      schema,
      toolName: "classify",
      toolDescription: "Classifies a product.",
    });

    expect(result).toEqual({ material: "bamboo", confidence: 0.92 });
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-5",
        tool_choice: { type: "tool", name: "classify" },
        tools: [expect.objectContaining({ name: "classify", input_schema: expect.objectContaining({ type: "object" }) })],
      })
    );
  });

  it("throws when Claude responds without calling the tool", async () => {
    mocks.create.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: "I refuse." }] });

    await expect(
      callStructured({ system: "s", prompt: "p", schema, toolName: "classify", toolDescription: "d" })
    ).rejects.toThrow(/didn't call the "classify" tool/);
  });

  it("throws LlmValidationError when the tool input fails schema validation", async () => {
    mocks.create.mockResolvedValue({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "t1", name: "classify", input: { material: "titanium", confidence: "high" } }],
    });

    await expect(
      callStructured({ system: "s", prompt: "p", schema, toolName: "classify", toolDescription: "d" })
    ).rejects.toThrow(LlmValidationError);
  });
});
