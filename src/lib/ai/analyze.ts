// Single entry point for AI analysis. Wraps the Anthropic call, applies
// the schema-enforced output, runs post-output guardrails, returns a
// strongly-typed result + cost telemetry.

import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT_V1, PROMPT_VERSION } from "./prompt";
import { type AnalysisResult } from "./schema";
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

  // Two tools, one per output shape. Anthropic enforces each tool's
  // input_schema — no oneOf needed. tool_choice='any' forces the model
  // to call exactly one of them.
  const tools = [
    {
      name: "submit_analysis",
      description:
        "Submit the behavioral analysis report. Call this when you can confidently document observable markers in a dog or cat image.",
      input_schema: {
        type: "object" as const,
        properties: {
          species: { type: "string", enum: ["dog", "cat"] },
          observed_markers: {
            type: "array",
            minItems: 4,
            maxItems: 10,
            items: { type: "string", minLength: 8, maxLength: 240 },
            description:
              "4–10 clinical observations of physical markers visible in the image (tail carriage, ear position, jaw tension, etc.). Each item is one sentence.",
          },
          instant_observations: {
            type: "array",
            minItems: 3,
            maxItems: 5,
            items: { type: "string", minLength: 4, maxLength: 32 },
            description:
              "3–5 scannable consumer-readable observations, each 2–4 words, plain English, NO clinical jargon. These render at the TOP of the report and must read in 2 seconds. Examples: 'Relaxed posture', 'Curious attention', 'Soft eye contact', 'No visible distress'. Per system prompt Stage 4.5.",
          },
          not_observed: {
            type: "array",
            maxItems: 6,
            items: { type: "string", minLength: 4, maxLength: 60 },
            description:
              "Body parts or behavioral signals NOT visible due to framing/lighting/crop. 2–6 words each. Return [] if nothing meaningful is occluded. Per system prompt Stage 4.6.",
          },
          emotional_state: {
            type: "string",
            description:
              "One primary emotional/behavioral state from the candidate list in the system prompt (e.g. 'relaxed/affiliative', 'threshold anxiety', 'play solicitation').",
          },
          confidence_score: {
            type: "integer",
            minimum: 40,
            maximum: 95,
            description:
              "Honest confidence per the Stage 3 calibration rubric. Never exceed 95.",
          },
          confidence_rationale: {
            type: "string",
            minLength: 20,
            maxLength: 280,
            description: "One sentence justifying the confidence score.",
          },
          translation: {
            type: "string",
            minLength: 60,
            maxLength: 600,
            description:
              "2–4 sentence THIRD-PERSON behaviorist reading of what the pet's body language indicates. Voice: 'This dog appears…', 'The cat's posture suggests…'. NEVER first-person ('I'm…', 'I want…'). Ground every claim in observed markers. Per system prompt Stage 4.",
          },
          action_plan_do: {
            type: "array",
            minItems: 2,
            maxItems: 4,
            items: { type: "string", minLength: 3, maxLength: 50 },
            description:
              "2–4 imperative items the owner SHOULD do, each 3–8 words. Examples: 'Calm praise during settled moments', 'Reward low-stimulation reorientation'. Per system prompt Stage 5.",
          },
          action_plan_avoid: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: { type: "string", minLength: 3, maxLength: 50 },
            description:
              "1–3 imperative items the owner should NOT do, each 3–8 words. Examples: 'Overstimulating during rest', 'Loud verbal corrections'. Per system prompt Stage 5.",
          },
          owner_action_plan: {
            type: "string",
            minLength: 60,
            maxLength: 600,
            description:
              "2–4 sentences explaining WHY the Do/Avoid items match the observed markers. Renders as 'Why this helps' accordion below the lists. Force-free only. Per system prompt Stage 5.",
          },
          refer_to_professional: {
            type: "boolean",
            description:
              "True if the analysis touches on aggression, severe SA, or stereotypic behavior that benefits from a credentialed positive-reinforcement professional.",
          },
          notes: {
            type: "string",
            maxLength: 400,
            description: "Optional edge-case notes.",
          },
        },
        required: [
          "species",
          "observed_markers",
          "instant_observations",
          "not_observed",
          "emotional_state",
          "confidence_score",
          "confidence_rationale",
          "translation",
          "action_plan_do",
          "action_plan_avoid",
          "owner_action_plan",
          "refer_to_professional",
        ],
      },
    },
    {
      name: "submit_refusal",
      description:
        "Submit a refusal when you cannot perform the analysis (no animal visible, wrong species, vet referral needed, etc.).",
      input_schema: {
        type: "object" as const,
        properties: {
          refusal_code: {
            type: "string",
            enum: [
              "veterinary_referral_required",
              "no_subject_detected",
              "unsupported_species",
              "out_of_scope",
              "insufficient_signal",
              "policy_violation",
            ],
          },
          user_message: {
            type: "string",
            minLength: 20,
            maxLength: 400,
            description:
              "1–2 warm but clear sentences for the owner. Use the refusal templates from the system prompt.",
          },
          recommended_next_step: {
            type: "string",
            minLength: 10,
            maxLength: 240,
            description: "One sentence telling the owner what to do.",
          },
        },
        required: ["refusal_code", "user_message", "recommended_next_step"],
      },
    },
  ];

  try {
    const response = await client.messages.create({
      model: ACTIVE_MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT_V1,
      tools,
      tool_choice: { type: "any" },
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

    // With tool_choice=any, the model MUST call exactly one tool.
    // Extract the tool_use block.
    const toolUse = response.content.find((c) => c.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      console.error(
        "no_tool_use_block",
        JSON.stringify(response.content).slice(0, 400),
      );
      return { ok: false, error: "no_tool_use_block_in_response", durationMs };
    }

    const toolName = toolUse.name;
    const toolInput = toolUse.input as Record<string, unknown>;

    let parsed: AnalysisResult;
    if (toolName === "submit_analysis") {
      parsed = { result_type: "analysis", ...toolInput } as AnalysisResult;
    } else if (toolName === "submit_refusal") {
      parsed = { result_type: "refusal", ...toolInput } as AnalysisResult;
    } else {
      console.error("unexpected_tool_name", toolName);
      return { ok: false, error: `unexpected_tool: ${toolName}`, durationMs };
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
