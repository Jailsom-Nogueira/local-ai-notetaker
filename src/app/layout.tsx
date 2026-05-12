import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Notetaker — Local AI Meeting Notes',
  description: 'Local microphone and system-audio note-taker with private transcription and optional AI review.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
