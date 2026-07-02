import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "QuantTrader — AI Stock Signals for Everyone", template: "%s · QuantTrader" },
  description: "Find your next trade in seconds. QuantTrader scans the market and shows you exactly what to buy, how much to invest, and when to exit — powered by AI.",
  keywords: ["stock trading", "AI stock picks", "trading signals", "stock scanner", "best stocks to buy", "stock analysis"],
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "QuantTrader — AI Stock Signals for Everyone",
    description: "Find your next trade in seconds. AI-powered signals with plain-English explanations.",
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
