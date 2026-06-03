// Post-output safety checks per system_prompt_v1.md §5.
// Even with native JSON schema enforcement, certain failure modes need
// regex-level filtering: cartoon vocabulary slipping in, dominance-theory
// language in action plans, confidence-vs-marker-count sanity check.

import type { AnalysisResult } from "./schema";

const BANNED_TRANSLATION_WORDS = [
  "woof",
  "meow",
  "purrr",
  "ruff ruff",
  "hooman",
  "fur baby",
  "doggo",
  "pupper",
  "kitto",
  "meowmy",
];

const BANNED_ACTION_PLAN_WORDS = [
  "alpha roll",
  "alpha-roll",
  "dominant",
  "dominance",
  "pack leader",
  "show him who",
  "show her who",
  "shock collar",
  "prong collar",
  "choke chain",
];

export type GuardrailVerdict =
  | { ok: true; output: AnalysisResult }
  | { ok: false; reason: string; output: AnalysisResult };

export function runGuardrails(output: AnalysisResult): GuardrailVerdict {
  if (output.result_type !== "analysis") {
    return { ok: true, output }; // refusals pass through
  }

  // 1) Confidence calibration sanity: 90%+ requires 5+ markers
  if (output.confidence_score > 89 && output.observed_markers.length < 5) {
    return {
      ok: false,
      reason: "calibration_violation",
      output: { ...output, confidence_score: 85 },
    };
  }

  // 2) Cartoon vocabulary in translation field
  const t = output.translation.toLowerCase();
  for (const word of BANNED_TRANSLATION_WORDS) {
    if (t.includes(word)) {
      return { ok: false, reason: `banned_translation_word:${word}`, output };
    }
  }

  // 3) Dominance / aversive language in action plan
  const a = output.owner_action_plan.toLowerCase();
  for (const word of BANNED_ACTION_PLAN_WORDS) {
    if (a.includes(word)) {
      return { ok: false, reason: `banned_action_plan_word:${word}`, output };
    }
  }

  return { ok: true, output };
}
