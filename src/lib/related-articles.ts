// Related-article suggestions for the analysis result page.
//
// Strategy v1: deterministic per-species pool + light keyword matching
// against the analysis output (emotional_state, observed markers, refer-to-
// professional flag). Returns 3 articles ranked best-fit-first.
//
// Why hardcoded (for now): the marketing site (site-next) is a separate
// Vercel deployment and we don't yet expose an articles-index.json there.
// Coupling cost is low because article URLs are stable canonical slugs.
// When site-next ships articles-index.json we can swap to a fetch +
// fuzzy match without changing this module's signature.

const SITE = "https://pettranslator.ai";

/**
 * Hero image URL for a related-articles thumbnail. Card variant (600w,
 * ~25 KB WebP) is pre-generated on the marketing site at build time —
 * we just reference the public path here.
 *
 * The thumbnail and full hero share the same slug — the suffix `-card`
 * is the convention from site-next/scripts/generate_card_variants.mjs.
 */
export function heroThumbUrl(slug: string): string {
  return `${SITE}/blog/heroes/${slug}-card.webp`;
}

export interface ArticleSuggestion {
  slug: string;
  title: string;
  category: "dog-behavior" | "cat-behavior" | "training-science";
  readingTime: string;
  // Tags this article addresses — used to weight against the analysis.
  // Keep these lower-case keywords; we match them against the analysis
  // output's marker strings and emotional_state with a case-insensitive
  // substring check.
  signals: string[];
}

// Curated pool — 12 dog + 12 cat + 4 cross-species articles, all live
// on site-next as of launch.
const POOL: ArticleSuggestion[] = [
  // ── Dog pillar + body-language ──────────────────────────────────────
  { slug: "dog-body-language", title: "Dog Body Language: A Behaviorist's Field Guide", category: "dog-behavior", readingTime: "12 min", signals: ["dog", "body language", "ears", "tail", "posture"] },
  { slug: "dog-whale-eye", title: "Dog Whale Eye: The Most Misread Stress Signal", category: "dog-behavior", readingTime: "6 min", signals: ["dog", "stress", "fear", "whale eye", "anxious"] },
  { slug: "dog-lip-licking", title: "Dog Lip Licking: When It's Stress vs. Anticipation", category: "dog-behavior", readingTime: "5 min", signals: ["dog", "stress", "lip lick", "appeasement", "displacement"] },
  { slug: "dog-yawning-when-not-tired", title: "Dog Yawning When Not Tired: Displacement Decoded", category: "dog-behavior", readingTime: "5 min", signals: ["dog", "stress", "yawn", "displacement"] },
  { slug: "dog-tail-position-chart", title: "Dog Tail Positions: A Visual Reference", category: "dog-behavior", readingTime: "7 min", signals: ["dog", "tail", "body language"] },
  { slug: "dog-separation-anxiety", title: "Dog Separation Anxiety: Signs, Science, What Helps", category: "dog-behavior", readingTime: "9 min", signals: ["dog", "anxiety", "separation", "distress"] },
  { slug: "dog-resource-guarding", title: "Dog Resource Guarding: A Force-Free Approach", category: "dog-behavior", readingTime: "8 min", signals: ["dog", "guarding", "aggression", "tension"] },
  { slug: "signs-your-dog-is-stressed", title: "10 Signs Your Dog Is Stressed (and What to Do)", category: "dog-behavior", readingTime: "8 min", signals: ["dog", "stress", "anxious", "tense"] },
  { slug: "dog-pacing-at-night", title: "Why Is My Dog Pacing at Night?", category: "dog-behavior", readingTime: "6 min", signals: ["dog", "pacing", "restless", "senior"] },
  { slug: "why-does-my-dog-show-belly", title: "Why Does My Dog Show Their Belly?", category: "dog-behavior", readingTime: "5 min", signals: ["dog", "trust", "relaxed", "calm", "appeasement"] },
  { slug: "why-does-my-dog-tilt-head", title: "Why Does My Dog Tilt Their Head?", category: "dog-behavior", readingTime: "5 min", signals: ["dog", "alert", "attentive", "listening"] },
  { slug: "dog-zoomies-explained", title: "Dog Zoomies Explained: The Science of FRAPs", category: "dog-behavior", readingTime: "5 min", signals: ["dog", "excited", "arousal", "play"] },

  // ── Cat pillar + body-language ──────────────────────────────────────
  { slug: "cat-body-language", title: "Cat Body Language: A Behaviorist's Field Guide", category: "cat-behavior", readingTime: "13 min", signals: ["cat", "body language", "ears", "tail", "posture"] },
  { slug: "cat-airplane-ears", title: "Cat Airplane Ears: What That Sideways Rotation Means", category: "cat-behavior", readingTime: "5 min", signals: ["cat", "stress", "fear", "ears", "tense"] },
  { slug: "why-does-my-cat-slow-blink-at-me", title: "Cat Slow Blink: Decoding the Trust Signal", category: "cat-behavior", readingTime: "5 min", signals: ["cat", "trust", "relaxed", "calm", "bonding"] },
  { slug: "cat-tail-meanings", title: "Cat Tail Positions and What They Communicate", category: "cat-behavior", readingTime: "6 min", signals: ["cat", "tail", "body language"] },
  { slug: "cat-hiding-under-the-bed", title: "Why Is My Cat Hiding Under the Bed?", category: "cat-behavior", readingTime: "6 min", signals: ["cat", "fear", "anxious", "hiding", "stressed"] },
  { slug: "cat-meowing-at-night", title: "Cat Meowing at Night: Behavioral or Medical?", category: "cat-behavior", readingTime: "7 min", signals: ["cat", "meow", "vocal", "senior", "discomfort"] },
  { slug: "cat-headbutting-bunting", title: "Cat Bunting: The Headbutt Decoded", category: "cat-behavior", readingTime: "5 min", signals: ["cat", "trust", "bonding", "scent"] },
  { slug: "cat-kneading-meaning", title: "Cat Kneading: Comfort Behavior Explained", category: "cat-behavior", readingTime: "5 min", signals: ["cat", "comfort", "relaxed", "kitten"] },
  { slug: "cat-love-bites", title: "Cat Love Bites and Overstimulation Signals", category: "cat-behavior", readingTime: "6 min", signals: ["cat", "bite", "overstimulation", "tension"] },
  { slug: "cat-scratching-furniture", title: "Cat Scratching: Why & How to Redirect", category: "cat-behavior", readingTime: "6 min", signals: ["cat", "scratch", "marking"] },
  { slug: "why-cat-peeing-outside-litter-box", title: "Why Is My Cat Peeing Outside the Litter Box?", category: "cat-behavior", readingTime: "8 min", signals: ["cat", "litter", "stress", "medical"] },
  { slug: "cat-spraying-vs-urinating", title: "Cat Spraying vs Urinating: How to Tell the Difference", category: "cat-behavior", readingTime: "6 min", signals: ["cat", "spray", "marking", "stress"] },

  // ── Cross-species / training-science ────────────────────────────────
  { slug: "why-dominance-theory-is-wrong", title: "Why Dominance Theory Is Wrong", category: "training-science", readingTime: "9 min", signals: ["training", "dominance", "alpha"] },
  { slug: "how-to-find-credentialed-behaviorist", title: "How to Find a Credentialed Behaviorist", category: "training-science", readingTime: "7 min", signals: ["professional", "referral", "behaviorist", "credentialed"] },
  { slug: "positive-reinforcement-vs-balanced-training", title: "Positive Reinforcement vs Balanced Training", category: "training-science", readingTime: "8 min", signals: ["training", "reinforcement", "balanced"] },
  { slug: "do-pet-translator-apps-work", title: "Do Pet Translator Apps Actually Work?", category: "training-science", readingTime: "12 min", signals: ["app", "translator", "ai"] },
];

interface ScoreInput {
  species?: "dog" | "cat";
  emotionalState?: string;
  markers?: string[];
  referToProfessional?: boolean;
}

/**
 * Pick 3 best-fit articles. Scoring:
 *   +5 species match (or 0 for cross-species — they qualify both)
 *   +3 emotional_state contains any signal keyword
 *   +1 per observed marker that contains a signal keyword (max +3)
 *   +5 if refer_to_professional and slug is the behaviorist directory
 * Highest 3 scores returned. If species mismatch knocks scores to 0,
 * fall back to species-specific pillar articles.
 */
export function pickRelatedArticles(input: ScoreInput, n = 3): ArticleSuggestion[] {
  const haystack = [
    input.emotionalState ?? "",
    ...(input.markers ?? []),
  ]
    .join(" ")
    .toLowerCase();

  const scored = POOL.map((a) => {
    let score = 0;
    const isDog = a.category === "dog-behavior";
    const isCat = a.category === "cat-behavior";
    const isCross = a.category === "training-science";

    if (input.species === "dog" && (isDog || isCross)) score += 5;
    if (input.species === "cat" && (isCat || isCross)) score += 5;
    // Wrong-species articles are still allowed but bottom-ranked.
    if (input.species && ((input.species === "dog" && isCat) || (input.species === "cat" && isDog))) {
      score -= 10;
    }

    let markerHits = 0;
    for (const sig of a.signals) {
      if (sig === "dog" || sig === "cat") continue; // species handled above
      if (haystack.includes(sig)) markerHits++;
    }
    if (markerHits > 0) score += 3 + Math.min(markerHits - 1, 2);

    if (input.referToProfessional && a.slug === "how-to-find-credentialed-behaviorist") {
      score += 5;
    }

    return { article: a, score };
  });

  // Stable, then sort by score desc; tiebreak on category alphabetically
  // so the result is deterministic across renders.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.article.slug.localeCompare(b.article.slug);
  });

  return scored.slice(0, n).map((s) => s.article);
}

export function articleUrl(slug: string): string {
  return `${SITE}/blog/${slug}`;
}
