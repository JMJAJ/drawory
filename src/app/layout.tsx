import type { Metadata, Viewport } from "next";
import { Caveat, Geist, Geist_Mono, Permanent_Marker, Playfair_Display } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Text fonts on the board (see FONTS in lib/client/elements.ts). Only downloaded when used.
const elegant = Playfair_Display({ variable: "--font-elegant", subsets: ["latin"], preload: false });
const hand = Caveat({ variable: "--font-hand", subsets: ["latin"], preload: false });
const marker = Permanent_Marker({ variable: "--font-marker", subsets: ["latin"], weight: "400", preload: false });

export const metadata: Metadata = {
  title: "drawory",
  description: "An endless canvas you draw on together. Make a room, share the code.",
  appleWebApp: { capable: true, title: "drawory", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // Draw edge to edge on phones with a notch; the bars keep clear using safe-area insets.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F5F7" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0B0E" },
  ],
};

// Applies the saved day/night choice before first paint, so there's no flash.
const themeScript = `try{var t=localStorage.getItem("drawory:theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${elegant.variable} ${hand.variable} ${marker.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
