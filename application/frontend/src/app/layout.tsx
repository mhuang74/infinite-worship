import './globals.css';

export const metadata = {
  title: 'Infinite Worship',
  description: 'Worship playback and intelligent remixing',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  )
}
