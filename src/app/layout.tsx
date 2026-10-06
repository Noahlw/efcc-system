import type { Metadata } from "next";

import { QueryProvider } from "@/components/query-provider";

import "./globals.css";

export const metadata: Metadata = {
  description: "中國基督教播道會顯恩堂內部系統",
  title: "顯恩堂系統",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant-HK">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
