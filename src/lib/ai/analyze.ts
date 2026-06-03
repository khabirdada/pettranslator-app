// Single entry point for AI analysis. Wraps the Anthropic call, applies
// the schema-enforced output, runs post-output guardrails, returns a
// strongly-typed result + cost telemetry.

import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT_V1, PROMPT_VERSION } from "./prompt";
import { ANALYSIS_OUTPUT_SCHEMA, type AnalysisResult } from "./schema";
import { runGuardrails } from "./guardrails";

export const ACTIVE_MODEL = "claude-sonnet-4-6";

// Claude Sonnet 4.6 pricing as of mid-2026: $3/MTok in, $15/MTok out
const PRICE_PER_INPUT_MTOK = 3.0;
const PRICE_PER_OUTPUT_MTOK = 15.0;

export type AnalyzeOpts = {
  /** Publicly fetchable URL of the image (signed Supabase Storage URL). */
  imageUrl: string;
  /** One-sentence user-provided context (optional). */
  userContext?: string;
  /** Pet profile fields (species/age/breed) if known. */
  petProfile?: { species?: string; approximate_age?: string; breed?: string } | null;
};

export type AnalyzeResponse =
  | {
      ok: true;
      output: AnalysisResult;
      model: string;
      prompt_version: string;
      cost_usd: number;
      duration_ms: number;
      input_tokens: number;
      output_tokens: number;
    }
  | { ok: false; error: string; durationMs: number };

export async function analyzeImage(opts: AnalyzeOpts): Promise<AnalyzeResponse> {
  const t0 = Date.now();
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const contextLine =
    opts.userContext?.trim() || "(no context provided by owner)";
  const profileLine = opts.petProfile
    ? `pet_profile: ${JSON.stringify(opts.petProfile)}`
    : "pet_profile: (not provided)";

  try {
    const response = await client.messages.create({
      model: ACTIVE_MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT_V1,
      output_config: {
        format: {
          type: "json_schema",
          schema: ANALYSIS_OUTPUT_SCHEMA as unknown as { [key: string]: unknown },
        },
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `user_context: ${contextLine}\n${profileLine}`,
            },
            {
              type: "image",
              source: { type: "url", url: opts.imageUrl },
            },
          ],
        },
      ],
    });

    const durationMs = Date.now() - t0;

    // Extract the JSON text from the response
    const textBlock = response.content.find((c) => c.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { ok: false, error: "no_text_block_in_response", durationMs };
    }

    let parsed: AnalysisResult;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      return { ok: false, error: "model_returned_non_json", durationMs };
    }

    // Run post-output guardrails (regex checks per system_prompt_v1.md §5)
    const verdict = runGuardrails(parsed);
    if (!verdict.ok) {
      console.error("guardrail_failure", verdict.reason);
      // Still return the (possibly corrected) output so the user sees something
    }

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const cost =
      (inputTokens / 1_000_000) * PRICE_PER_INPUT_MTOK +
      (outputTokens / 1_000_000) * PRICE_PER_OUTPUT_MTOK;

    return {
      ok: true,
      output: verdict.output,
      model: ACTIVE_MODEL,
      prompt_version: PROMPT_VERSION,
      cost_usd: Number(cost.toFixed(6)),
      duration_ms: durationMs,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    };
  } catch (err) {
    const durationMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    console.error("anthropic_call_failed", msg);
    return { ok: false, error: msg, durationMs };
  }
}
