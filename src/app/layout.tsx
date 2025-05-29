import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const inter = Inter({
  subsets: ["latin", "arabic"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "مساعدك الطبي الذكي",
  description: "مساعد طبي مدعوم بالذكاء الاصطناعي لتحليل استفساراتك الصحية.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className={`${inter.variable} antialiased`}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
