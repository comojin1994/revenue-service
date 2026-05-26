import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Revenue Service — YouTube Ingestion",
  description:
    "YouTube 영상을 가져와 다운로드하고 처리 job을 생성하는 리퍼포징 파이프라인 진입점.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-gray-50 antialiased">{children}</body>
    </html>
  );
}
