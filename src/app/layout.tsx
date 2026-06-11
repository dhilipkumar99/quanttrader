import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "QuantTrader — Smart Stock Analysis for Everyone",
    template: "%s · QuantTrader",
  },
  description: "Get clear buy/sell signals for any stock, powered by institutional-grade AI. Understand what the market is doing — no finance degree required.",
  keywords: ["stock analysis", "trading signals", "AI trading", "quant trading", "stock market", "paper trading"],
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "QuantTrader — Smart Stock Analysis for Everyone",
    description: "Get clear buy/sell signals for any stock, powered by institutional-grade AI. No finance degree required.",
    type: "website",
    locale: "en_US",
    siteName: "QuantTrader",
  },
  twitter: {
    card: "summary_large_image",
    title: "QuantTrader — Smart Stock Analysis for Everyone",
    description: "Get clear buy/sell signals for any stock, powered by institutional-grade AI.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
