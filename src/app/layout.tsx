import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "QuantTrader Pro", template: "%s · QuantTrader" },
  description: "Institutional-grade systematic trading platform. Full S&P 500 market data, ML signals, auto-trading via Alpaca.",
  keywords: ["stock trading", "quant trading", "S&P 500", "trading platform", "algorithmic trading"],
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "QuantTrader Pro — Institutional Trading Platform",
    description: "Full S&P 500 market data, ML signals, and auto-trading.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="h-full flex flex-col overflow-hidden">{children}</body>
    </html>
  );
}
