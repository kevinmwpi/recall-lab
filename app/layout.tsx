import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Recall Lab â Flashcard Study Tool",
  description:
    "Import flashcard sets, run free or Pomodoro study sessions, and track familiarity for every card.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
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
