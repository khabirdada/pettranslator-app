// Vet-ready PDF export — single-page A4, monochrome with one terracotta accent.
//
// Design intent:
//   - Looks like a clinical referral letter, not a screenshot.
//   - Readable on paper after the owner prints it out to bring to a vet.
//   - Contains everything the vet/behaviorist needs: observed markers,
//     emotional-state interpretation, confidence + rationale, and the
//     full Do/Avoid plan.
//   - Footer carries the model version, prompt version, generation
//     timestamp, and analysis ID — auditable.
//
// Why @react-pdf/renderer (not Puppeteer/headless Chrome):
//   - Vercel serverless can't ship Chromium without bumping function
//     size past the 50 MB limit.
//   - @react-pdf is pure-JS, ships in ~2 MB, renders identically every
//     time (no font-loading races, no race-conditions with image loads).
//   - Has full layout primitives (View, Flex) plus its own typography
//     system. Trade-off: cannot consume our Tailwind classes — every
//     style is inline. We mirror the brand palette by hand below.
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  Font,
} from "@react-pdf/renderer";

// Brand colors mirrored from globals.css. Hex values match the live site
// so a printed PDF doesn't feel like a different product.
const COLORS = {
  ink: "#1F1B16",
  slate: "#5C5648",
  slateSoft: "#8B8475",
  terra: "#B85A3E",
  paperLight: "#FBF9F1",
  rule: "#E8E3D3",
};

// Register Newsreader (serif) + Plus Jakarta Sans (sans) from Google Fonts
// CDN at module load. @react-pdf bundles fonts at render time so the PDF
// is self-contained — no fallback issues on the receiving device.
//
// Note: the URLs below are stable Google Fonts static endpoints. If
// Google were to break these, fall back to system Times/Helvetica
// (already covered by @react-pdf's defaults).
Font.register({
  family: "Newsreader",
  fonts: [
    {
      src: "https://fonts.gstatic.com/s/newsreader/v23/cY9jfjOCX1hbuyalUrK49dLac06G1ZGsZBtoBCzBDXXD9JVF.ttf",
      fontWeight: 400,
    },
    {
      src: "https://fonts.gstatic.com/s/newsreader/v23/cY9jfjOCX1hbuyalUrK49dLac06G1ZGsZBtoBC_CDXXD9JVF.ttf",
      fontWeight: 500,
    },
    {
      src: "https://fonts.gstatic.com/s/newsreader/v23/cY9jfjOCX1hbuyalUrK49dLac06G1ZGsZBtoBCnEDXXD9JVF.ttf",
      fontWeight: 600,
    },
  ],
});

Font.register({
  family: "PlusJakartaSans",
  fonts: [
    {
      src: "https://fonts.gstatic.com/s/plusjakartasans/v8/LDIbaomQNQcsA88c7O9yZ4KMCoOg4IA6-91aHEjcWuA_qU79TJWVPbgxv4ZAVdQDhg.ttf",
      fontWeight: 400,
    },
    {
      src: "https://fonts.gstatic.com/s/plusjakartasans/v8/LDIbaomQNQcsA88c7O9yZ4KMCoOg4IA6-91aHEjcWuA_qU79TJ-WPbgxv4ZAVdQDhg.ttf",
      fontWeight: 500,
    },
    {
      src: "https://fonts.gstatic.com/s/plusjakartasans/v8/LDIbaomQNQcsA88c7O9yZ4KMCoOg4IA6-91aHEjcWuA_qU79TIWaPbgxv4ZAVdQDhg.ttf",
      fontWeight: 600,
    },
  ],
});

const styles = StyleSheet.create({
  page: {
    paddingTop: 56,
    paddingBottom: 64,
    paddingHorizontal: 56,
    fontFamily: "PlusJakartaSans",
    fontSize: 10.5,
    lineHeight: 1.5,
    color: COLORS.ink,
    backgroundColor: COLORS.paperLight,
  },
  // Top masthead — mirrors the marketing site's editorial header
  masthead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.rule,
    paddingBottom: 14,
    marginBottom: 24,
  },
  brandWord: {
    fontFamily: "Newsreader",
    fontSize: 18,
    fontWeight: 500,
    letterSpacing: 0.2,
  },
  brandSub: {
    fontFamily: "PlusJakartaSans",
    fontSize: 8.5,
    color: COLORS.slateSoft,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  label: {
    fontSize: 8.5,
    color: COLORS.slateSoft,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    fontWeight: 500,
  },
  h1: {
    fontFamily: "Newsreader",
    fontSize: 22,
    fontWeight: 500,
    color: COLORS.ink,
    marginTop: 8,
    marginBottom: 4,
    lineHeight: 1.25,
  },
  h2: {
    fontFamily: "Newsreader",
    fontSize: 13,
    fontWeight: 500,
    color: COLORS.ink,
    marginBottom: 6,
  },
  section: {
    marginTop: 18,
  },
  divider: {
    borderTopWidth: 1,
    borderTopColor: COLORS.rule,
    marginTop: 18,
    marginBottom: 0,
  },
  // Confidence pill — terracotta border, paper background
  confidenceBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 6,
    marginBottom: 4,
  },
  confidenceTier: {
    fontFamily: "Newsreader",
    fontSize: 14,
    fontWeight: 500,
    color: COLORS.terra,
  },
  confidencePct: {
    fontSize: 9,
    color: COLORS.slateSoft,
    fontFamily: "PlusJakartaSans",
  },
  body: {
    fontSize: 10.5,
    color: COLORS.slate,
    lineHeight: 1.55,
  },
  bullet: {
    flexDirection: "row",
    marginBottom: 3,
    paddingLeft: 2,
  },
  bulletDot: {
    width: 10,
    fontSize: 10.5,
    color: COLORS.terra,
  },
  bulletText: {
    flex: 1,
    fontSize: 10.5,
    color: COLORS.slate,
  },
  // Two-column action plan grid (Do | Avoid)
  actionGrid: {
    flexDirection: "row",
    gap: 16,
    marginTop: 6,
  },
  actionCol: {
    flex: 1,
  },
  doHeading: {
    fontSize: 9,
    color: COLORS.terra,
    fontWeight: 600,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  avoidHeading: {
    fontSize: 9,
    color: COLORS.slateSoft,
    fontWeight: 600,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  // Footer — small monospace audit trail
  footer: {
    position: "absolute",
    bottom: 30,
    left: 56,
    right: 56,
    fontSize: 7.5,
    color: COLORS.slateSoft,
    borderTopWidth: 1,
    borderTopColor: COLORS.rule,
    paddingTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  // Vet referral callout — terracotta box at end of report if flagged
  vetCallout: {
    marginTop: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.terra,
    borderRadius: 4,
    backgroundColor: "#FFFFFF",
  },
  vetCalloutTitle: {
    fontFamily: "Newsreader",
    fontSize: 11,
    fontWeight: 600,
    color: COLORS.terra,
    marginBottom: 4,
  },
});

export type AnalysisOutput = {
  result_type: "analysis";
  species: "dog" | "cat";
  observed_markers: string[];
  instant_observations?: string[];
  not_observed?: string[];
  emotional_state: string;
  confidence_score: number;
  confidence_rationale: string;
  translation: string;
  action_plan_do?: string[];
  action_plan_avoid?: string[];
  owner_action_plan: string;
  refer_to_professional: boolean;
  notes?: string | null;
};

export type PetMeta = {
  name?: string | null;
  species?: string | null;
  approximate_age?: string | null;
  breed?: string | null;
};

export type PdfProps = {
  output: AnalysisOutput;
  analysisId: string;
  model: string;
  promptVersion: string;
  generatedAt: Date;
  pet?: PetMeta | null;
};

function confidenceTierFor(score: number): string {
  if (score >= 90) return "Very high";
  if (score >= 75) return "High";
  if (score >= 60) return "Moderate";
  return "Lower";
}

function speciesNoun(species: "dog" | "cat"): string {
  return species === "dog" ? "Dog" : "Cat";
}

export function AnalysisPdf({
  output,
  analysisId,
  model,
  promptVersion,
  generatedAt,
  pet,
}: PdfProps) {
  const confTier = confidenceTierFor(output.confidence_score);
  const dateStr = generatedAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = generatedAt.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  const petLine =
    pet?.name || pet?.species || pet?.breed || pet?.approximate_age
      ? [pet?.name, pet?.breed, pet?.approximate_age].filter(Boolean).join(" · ")
      : speciesNoun(output.species);

  return (
    <Document
      title={`Behavioral Analysis · ${petLine}`}
      author="PetTranslator.ai"
      subject="Vet-ready behavioral analysis report"
      creator="PetTranslator.ai"
    >
      <Page size="A4" style={styles.page}>
        {/* Masthead — brand mark, top right has date */}
        <View style={styles.masthead}>
          <View>
            <Text style={styles.brandWord}>PetTranslator.ai</Text>
            <Text style={[styles.brandSub, { marginTop: 2 }]}>
              § Behavioral analysis report
            </Text>
          </View>
          <View>
            <Text style={[styles.label, { textAlign: "right" }]}>{dateStr}</Text>
          </View>
        </View>

        {/* Pet identification line */}
        <Text style={styles.label}>{speciesNoun(output.species)} · subject</Text>
        <Text style={styles.h1}>{petLine}</Text>

        {/* Emotional-state primary finding */}
        <View style={styles.section}>
          <Text style={styles.label}>§ Emotional state</Text>
          <View style={styles.confidenceBlock}>
            <Text style={styles.confidenceTier}>{output.emotional_state}</Text>
            <Text style={styles.confidencePct}>
              · {confTier} confidence ({output.confidence_score}%)
            </Text>
          </View>
          <Text style={styles.body}>{output.confidence_rationale}</Text>
        </View>

        <View style={styles.divider} />

        {/* Behavioral interpretation */}
        <View style={styles.section}>
          <Text style={styles.label}>§ Behavioral interpretation</Text>
          <Text style={[styles.body, { marginTop: 4 }]}>{output.translation}</Text>
        </View>

        {/* Observed markers */}
        {output.observed_markers?.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.label}>§ Observed body-language markers</Text>
            <View style={{ marginTop: 6 }}>
              {output.observed_markers.map((m, i) => (
                <View key={i} style={styles.bullet}>
                  <Text style={styles.bulletDot}>•</Text>
                  <Text style={styles.bulletText}>{m}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Not-observed (signals that could not be assessed) */}
        {output.not_observed && output.not_observed.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.label}>§ Not visible in this submission</Text>
            <View style={{ marginTop: 6 }}>
              {output.not_observed.map((m, i) => (
                <View key={i} style={styles.bullet}>
                  <Text style={[styles.bulletDot, { color: COLORS.slateSoft }]}>·</Text>
                  <Text style={styles.bulletText}>{m}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Do / Avoid action plan */}
        {(output.action_plan_do?.length || output.action_plan_avoid?.length) ? (
          <View style={styles.section}>
            <Text style={styles.label}>§ Owner action plan</Text>
            <View style={styles.actionGrid}>
              <View style={styles.actionCol}>
                <Text style={styles.doHeading}>Do</Text>
                {(output.action_plan_do ?? []).map((d, i) => (
                  <View key={i} style={styles.bullet}>
                    <Text style={styles.bulletDot}>+</Text>
                    <Text style={styles.bulletText}>{d}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.actionCol}>
                <Text style={styles.avoidHeading}>Avoid</Text>
                {(output.action_plan_avoid ?? []).map((a, i) => (
                  <View key={i} style={styles.bullet}>
                    <Text style={[styles.bulletDot, { color: COLORS.slateSoft }]}>×</Text>
                    <Text style={styles.bulletText}>{a}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        ) : (
          // Legacy v1.0/v1.1 analyses only have owner_action_plan as prose
          <View style={styles.section}>
            <Text style={styles.label}>§ Owner action plan</Text>
            <Text style={[styles.body, { marginTop: 4 }]}>{output.owner_action_plan}</Text>
          </View>
        )}

        {/* Vet referral callout — only if model flagged */}
        {output.refer_to_professional && (
          <View style={styles.vetCallout}>
            <Text style={styles.vetCalloutTitle}>
              Recommendation: consult a veterinary behaviorist
            </Text>
            <Text style={styles.body}>
              This analysis flagged signals that warrant professional review by
              a licensed veterinarian or veterinary behaviorist. AI behavioral
              analysis is not a substitute for in-person clinical evaluation.
            </Text>
          </View>
        )}

        {/* Footer — audit trail, never overlaps content thanks to position:absolute */}
        <View style={styles.footer} fixed>
          <Text>
            Analysis ID {analysisId.slice(0, 8)} · {model} · prompt {promptVersion}
          </Text>
          <Text>
            Generated {timeStr} · pettranslator.ai/analysis/{analysisId.slice(0, 8)}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
