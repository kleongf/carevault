import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CareVault — Your health, your permissions',
  description: 'A synthetic healthcare memory and permissions demonstration.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
