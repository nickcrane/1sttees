import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { env } from "@/lib/env";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_DESCRIPTION = "Sustainable bamboo golf tees, shipped to the UK and EU.";

export const metadata: Metadata = {
  metadataBase: new URL(env.STORE_BASE_URL),
  title: { default: "1st Tees", template: "%s | 1st Tees" },
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "1st Tees",
    title: "1st Tees",
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: "1st Tees",
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
