import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Farsight",
  description: "AI Research for Founders — 一个人完成分析师团队的深度调研",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh">
      <body className="antialiased">{children}</body>
    </html>
  );
}
