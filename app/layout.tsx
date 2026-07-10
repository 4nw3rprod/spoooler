import type { Metadata } from 'next';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'Spoooler — Reels, made by your agent',
  description:
    'A local-first Mac app that turns a link, a video, or a topic into a finished 1080×1920 Instagram Reel. Your AI agent runs the whole pipeline over MCP.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ backgroundColor: '#f5f5f7' }} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
