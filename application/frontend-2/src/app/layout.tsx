import './globals.css'

export const metadata = {
  title: 'Infinite Worship - Digital Audio System',
  description: 'Church music playback system with vintage audio equipment aesthetics',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  )
}
