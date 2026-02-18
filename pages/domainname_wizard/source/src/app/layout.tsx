import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Domainname Wizard",
  description: "Namelix-to-GoDaddy budget domain finder",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

