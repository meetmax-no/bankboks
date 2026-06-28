import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

// Metadata er static — selve appen leser brand fra clients/default.json
// via useAppConfig (som blir vist i header/footer). Tittel-taggen forblir
// stabil selv ved re-branding.
export const metadata: Metadata = {
  title: "Ko | Do · Vault · Din digitale nøkkelring",
  description:
    "Personlig kryptert passord-vault. Master-passord forlater aldri din enhet.",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-96x96.png", type: "image/png", sizes: "96x96" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0e1a",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="no" className="dark">
      <body className={`${inter.className} antialiased`}>
        <Providers>{children}</Providers>
        <Toaster
          position="bottom-center"
          theme="dark"
          toastOptions={{
            style: {
              background: "rgba(15, 23, 42, 0.95)",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              color: "white",
              backdropFilter: "blur(12px)",
            },
          }}
        />
      </body>
    </html>
  );
}
