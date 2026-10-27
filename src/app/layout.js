import { Analytics } from '@vercel/analytics/next';

export const metadata = {
  title: 'MAPL Girls Tennis',
  description: 'MAPL Girls Tennis Tournament',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
