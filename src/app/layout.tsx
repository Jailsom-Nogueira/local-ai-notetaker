import type { Metadata } from 'next';
import { Source_Code_Pro, Source_Sans_3 } from 'next/font/google';
import './globals.css';

const sourceSans = Source_Sans_3({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-source-sans-3',
  display: 'swap',
});

const sourceCode = Source_Code_Pro({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-source-code-pro',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Notetaker — Local AI Meeting Notes',
  description: 'Local microphone and system-audio note-taker with private transcription and optional AI review.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sourceSans.variable} ${sourceCode.variable}`}>{children}</body>
    </html>
  );
}
