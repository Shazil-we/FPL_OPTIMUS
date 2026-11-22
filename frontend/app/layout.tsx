import "./globals.css";
import type { Metadata } from "next";
import {
  Barlow_Condensed,
  Cormorant_Garamond,
  Geist,
  Geist_Mono,
  IBM_Plex_Mono,
  Plus_Jakarta_Sans,
} from "next/font/google";

const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-barlow-condensed",
  display: "swap",
});

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

const cormorantGaramond = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
  display: "swap",
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jakarta",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "FPL-Optimus | ML & Local Search FPL Optimizer",
  description:
    "Automated Fantasy Premier League Squad Selector, Transfer Optimizer, and Live Tracking Dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`dark ${barlowCondensed.variable} ${geist.variable} ${geistMono.variable} ${cormorantGaramond.variable} ${plusJakartaSans.variable} ${ibmPlexMono.variable}`}
    >
      <body className="min-h-[100dvh] bg-ink-950 text-mist-50 font-sans antialiased selection:bg-crimson-500 selection:text-mist-50">
        {children}
      </body>
    </html>
  );
}
