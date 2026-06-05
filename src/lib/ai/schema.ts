// Output JSON schema for Claude analysis responses.
// Mirrors `system_prompt_v1.md` §4 exactly. We pass this to Anthropic's
// `output_config.format` so the API guarantees the response shape.

export const ANALYSIS_OUTPUT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "PetTranslatorAnalysisOutput",
  oneOf: [
    {
      type: "object",
      required: [
        "result_type",
        "species",
        "observed_markers",
        "emotional_state",
        "confidence_score",
        "confidence_rationale",
        "translation",
        "owner_action_plan",
        "refer_to_professional",
      ],
      properties: {
        result_type: { const: "analysis" },
        species: { enum: ["dog", "cat"] },
        observed_markers: {
          type: "array",
          minItems: 4,
          maxItems: 10,
          items: { type: "string", minLength: 8, maxLength: 240 },
        },
        emotional_state: { type: "string", minLength: 4, maxLength: 80 },
        confidence_score: { type: "integer", minimum: 40, maximum: 95 },
        confidence_rationale: { type: "string", minLength: 20, maxLength: 280 },
        translation: { type: "string", minLength: 60, maxLength: 600 },
        owner_action_plan: { type: "string", minLength: 60, maxLength: 600 },
        refer_to_professional: { type: "boolean" },
        notes: { type: ["string", "null"], maxLength: 400 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["result_type", "refusal_code", "user_message", "recommended_next_step"],
      properties: {
        result_type: { const: "refusal" },
        refusal_code: {
          enum: [
            "veterinary_referral_required",
            "no_subject_detected",
            "unsupported_species",
            "out_of_scope",
            "insufficient_signal",
            "policy_violation",
          ],
        },
        user_message: { type: "string", minLength: 20, maxLength: 400 },
        recommended_next_step: { type: "string", minLength: 10, maxLength: 240 },
      },
      additionalProperties: false,
    },
  ],
} as const;

export type AnalysisResult =
  | {
      result_type: "analysis";
      species: "dog" | "cat";
      observed_markers: string[];
      /** 3–5 scannable plain-English observations. Added in prompt v1.1.
       *  Older (v1.0) analyses won't have this — render conditionally. */
      instant_observations?: string[];
      /** Occlusion awareness — body parts not visible. Added in prompt v1.1.
       *  Can be empty array. Older analyses won't have it. */
      not_observed?: string[];
      emotional_state: string;
      confidence_score: number;
      confidence_rationale: string;
      /** In v1.2+, this is THIRD-PERSON behavioral interpretation.
       *  In v1.0/v1.1, this was first-person pet voice. Backward compat:
       *  the result page renders this string verbatim either way. */
      translation: string;
      /** v1.2+ — 2-4 imperative "do" items. Older analyses won't have this. */
      action_plan_do?: string[];
      /** v1.2+ — 1-3 imperative "avoid" items. Older analyses won't have this. */
      action_plan_avoid?: string[];
      /** Prose "why this helps" reasoning. In v1.2+, renders as accordion. */
      owner_action_plan: string;
      refer_to_professional: boolean;
      notes?: string | null;
    }
  | {
      result_type: "refusal";
      refusal_code:
        | "veterinary_referral_required"
        | "no_subject_detected"
        | "unsupported_species"
        | "out_of_scope"
        | "insufficient_signal"
        | "policy_violation";
      user_message: string;
      recommended_next_step: string;
    };
