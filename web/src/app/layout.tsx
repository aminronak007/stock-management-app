import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nifty 50 Options Advisory Terminal",
  description: "Indian Share Market Personal Algorithmic Advisory Terminal optimized for Nifty 50 Options.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
