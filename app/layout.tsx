import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jbMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jbmono",
  display: "swap",
});

const instrument = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("http://localhost:3000"),
  title: {
    default: "Cortexa — Your AI Second Brain",
    template: "%s · Cortexa",
  },
  description:
    "Chat with your documents with verifiable citations, and dispatch an autonomous research agent that plans, uses tools and writes notes. Next.js · Supabase pgvector · RAG + Agentic AI on free tiers.",
  keywords: [
    "AI second brain",
    "RAG",
    "agentic AI",
    "knowledge base",
    "vector search",
    "pgvector",
    "document chat",
    "research agent",
  ],
  authors: [{ name: "OX Alpha" }],
  openGraph: {
    type: "website",
    siteName: "Cortexa",
    title: "Cortexa — Your AI Second Brain",
    description:
      "Grounded answers with citations from your own documents, plus an autonomous research agent. Free-tier stack, private by architecture.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Cortexa — Your AI Second Brain",
    description:
      "Chat with your knowledge with citations + autonomous research agent.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0b" },
    { media: "(prefers-color-scheme: light)", color: "#f7f7f5" },
  ],
  width: "device-width",
  initialScale: 1,
};

const themeInit = `(function(){try{var t=localStorage.getItem("cortexa-theme");if(t==="light")document.documentElement.classList.add("light");}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jbMono.variable} ${instrument.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body
        suppressHydrationWarning
        className="bg-canvas font-sans text-fg antialiased"
      >
        {children}
      </body>
    </html>
  );
}
