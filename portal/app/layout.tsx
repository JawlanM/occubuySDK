import type { Metadata } from "next";
import { Outfit, Sora } from "next/font/google";
import "./globals.css";
import Nav from "./components/Nav";

const outfit = Outfit({
  variable: "--font-display",
  subsets: ["latin"],
});

const sora = Sora({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Occubuy Developer Portal",
  description: "Documentation for partners integrating the Occubuy Score SDK",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${sora.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Nav />
        {children}
      </body>
    </html>
  );
}
