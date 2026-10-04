import { Fraunces, Inter } from 'next/font/google';
import './globals.css';

// Spec §3 typography: Fraunces (display/serif) + Inter (UI/body), self-hosted
// at build via next/font with display: swap. Variable fonts, one request each.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  axes: ['opsz'],
});

export const metadata = {
  title: 'Infinite Worship',
  description: 'Worship playback and intelligent remixing',
}

// Scheme follows the OS via CSS media query (§2.5); the meta color-scheme
// keeps native controls consistent before CSS paints.
export const viewport = {
  colorScheme: 'dark light',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body className="min-h-screen">{children}</body>
    </html>
  )
}
