import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Newsreader, Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SessionBridge } from "@/components/SessionBridge";

// Editorial-scientific typography — matches the marketing site exactly.
const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://app.pettranslator.ai"),
  title: {
    default: "PetTranslator.ai",
    template: "%s · PetTranslator.ai",
  },
  description:
    "Upload a ten-second clip. A multimodal AI documents body language, vocalization, and context the way a veterinary behaviorist would — then translates it into plain English.",
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.json",
  openGraph: {
    title: "PetTranslator.ai",
    description: "Know what your pet is actually trying to say.",
    type: "website",
    url: "https://app.pettranslator.ai",
    images: [{ url: "/icon-512.png" }],
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F5F3E9",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${plusJakartaSans.variable} ${jetBrainsMono.variable} antialiased`}
    >
      <head>
        {/* Cloudflare Web Analytics — same beacon token as the marketing
            site so app.pettranslator.ai's traffic shows up in the same
            Cloudflare dashboard. No cookies, no PII, GDPR-clean. */}
        <script
          defer
          src="https://static.cloudflareinsights.com/beacon.min.js"
          data-cf-beacon='{"token": "4d51d6d7b6cd4407a557472f367fd630"}'
        />
      </head>
      <body className="min-h-screen">
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-0C5Q1PW08V"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-0C5Q1PW08V');`}
        </Script>
        {/* Identity-graph JSON-LD — same WebApplication + founder Person
            entities as the marketing site (one canonical entity across
            both subdomains). The Wikidata anchor (Q140167480 for the
            app, Q140157373 for the founder) is what AI engines use to
            resolve "PetTranslator.ai" as a structured entity rather
            than ambiguous text. Single source of truth across pettranslator.ai
            and app.pettranslator.ai. */}
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "WebApplication",
                  "@id": "https://pettranslator.ai/#application",
                  name: "PetTranslator.ai",
                  url: "https://pettranslator.ai/",
                  description:
                    "AI behavioral analysis for dog and cat owners. Upload one photo — get observed markers, behavioral state, and an action plan. AVSAB-aligned.",
                  applicationCategory: "LifestyleApplication",
                  operatingSystem: "All",
                  foundingDate: "2026",
                  creator: { "@id": "https://journal.elelaf.com/about/#reviewer-person" },
                  // Mirrors site-next's AggregateOffer. Lives on every
                  // app-subdomain page so the identity graph carries the
                  // same pricing summary as the marketing site.
                  offers: {
                    "@type": "AggregateOffer",
                    priceCurrency: "USD",
                    lowPrice: "0",
                    highPrice: "9.99",
                    offerCount: "3",
                    availability: "https://schema.org/InStock",
                    url: "https://pettranslator.ai/pricing",
                  },
                  // sameAs mirrors the marketing site exactly so both
                  // subdomains contribute the same identity graph to
                  // Google Knowledge Graph / AI search engines.
                  sameAs: [
                    "https://www.wikidata.org/wiki/Q140167480",
                    "https://www.linkedin.com/company/pettranslator-ai",
                    "https://x.com/Petranslatorai",
                    "https://www.facebook.com/Pettranslatorai/",
                    "https://www.pinterest.com/pettranslatorai/",
                    "https://pettranslatorai.substack.com/",
                    "https://www.quora.com/profile/Pet-Translator-Ai",
                    "https://www.reddit.com/user/Vegetable-Sherbet-14/",
                  ],
                },
                {
                  "@type": "Person",
                  "@id": "https://journal.elelaf.com/about/#reviewer-person",
                  name: "Khabir Uddin",
                  url: "https://journal.elelaf.com/about/",
                  sameAs: ["https://www.wikidata.org/wiki/Q140157373"],
                },
              ],
            }),
          }}
        />
        <SessionBridge />
        {children}
      </body>
    </html>
  );
}
