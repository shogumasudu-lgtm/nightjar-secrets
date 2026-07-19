import { Fraunces, IBM_Plex_Mono } from "next/font/google";
import Link from "next/link";
import Script from "next/script";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-display",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata = {
  title: "Nightjar — secrets from strangers",
  description: "Release a secret into the dark. Read what strangers have let go of.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${plexMono.variable}`}>
   export const metadata = {
  title: "Nightjar - secrets from strangers",
  description: "Release a secret into the dark. Read what strangers have let go of.",
  other: {
    "google-adsense-account": "ca-pub-4598821881505606",
  },
};
      <body>
        <div className="sky">
          <header className="site-header">
            <a href="/" className="wordmark">
              night<em>jar</em>
            </a>
            
              <nav className="site-nav">
  <a href="/">read</a>
  <a href="/post">Confess</a>
  <a href="https://x.com/nightjar67rydn" target="_blank">My X account</a>
</nav>
            
          </header>
          <main>{children}</main>
          <footer className="site-footer">
            <Link
              href="/guidelines"
              className="footer-link text-xs text-gray-600 hover:text-gray-400 underline transition-colors"
            >
              Guidelines & Privacy
            </Link>
            <p className="site-footer-copy">
              every secret is anonymous. nothing is ever traced back to you.
            </p>
          </footer>
        </div>
      </body>
    </html>
  );
}