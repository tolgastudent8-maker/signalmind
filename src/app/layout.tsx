import type { Metadata } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Shell } from "@/components/shell";

const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter" });
const grotesk = Space_Grotesk({ subsets: ["latin", "latin-ext"], variable: "--font-grotesk" });
const jetbrains = JetBrains_Mono({ subsets: ["latin", "latin-ext"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: "SignalMind AI",
  description: "Kripto haberlerinin OKX TR tokenlarına etkisini çok ajanlı yapay zekâyla analiz eden ve kendi isabetini ölçen platform.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className={`${inter.variable} ${grotesk.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
