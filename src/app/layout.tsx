import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AI-Algo Bot",
  description: "BESS 2MW/8MWh 東京エリア — JEPX / EPRX / OCCTO 自動運用",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <div className="wrap">
          <header className="top">
            <h1>AI-Algo Bot</h1>
            <nav>
              <Link href="/">Trade Results</Link>
            </nav>
            <span className="muted">東京エリア · 2 MW / 8 MWh</span>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
