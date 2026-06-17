import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BLANWHI - Minimal Fashion",
  description: "Shop thời trang tối giản, cao cấp, mua nhanh."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
