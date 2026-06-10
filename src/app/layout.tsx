import type { Metadata, Viewport } from "next";
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
        <SessionBridge />
        {children}
      </body>
    </html>
  );
}
