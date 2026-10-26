import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "lifeOS — личный ритм",
  description: "Личный планировщик жизни, учёбы и восстановления",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
