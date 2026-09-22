import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/script-integrations", label: "Script Integrations" },
  { href: "/google-accounts", label: "Google Accounts" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/ad-groups", label: "Ad Groups" },
  { href: "/ads", label: "Ads" },
  { href: "/offers", label: "Offers" },
  { href: "/landing-pages", label: "Landing Pages" },
  { href: "/tracking-links", label: "Tracking Links" },
  { href: "/clicks", label: "Clicks" },
  { href: "/conversions", label: "Conversions" },
  { href: "/orders", label: "Orders" },
  { href: "/url-versions", label: "URL Versions" },
  { href: "/jobs", label: "Sync Jobs" },
  { href: "/audit-logs", label: "Audit Logs" },
];

export const metadata = {
  title: "AdLinkLab",
  description: "Research SaaS for Google Ads tracking and attribution experiments",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
          <aside className="border-r border-ink/10 bg-ink text-mist">
            <div className="px-5 py-6">
              <p className="font-display text-2xl tracking-tight">AdLinkLab</p>
              <p className="mt-1 text-sm text-mist/70">Phase 8.4.7 · Dashboard</p>
            </div>
            <nav className="flex flex-col gap-0.5 px-3 pb-8">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-3 py-2 text-sm text-mist/85 transition hover:bg-white/10 hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="px-6 py-8 lg:px-10">{children}</main>
        </div>
      </body>
    </html>
  );
}
