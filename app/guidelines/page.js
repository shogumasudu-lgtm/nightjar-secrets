import Link from "next/link";

export const metadata = {
  title: "Guidelines & Privacy — Nightjar",
};

export default function Guidelines() {
  return (
    <div className="compose">
      <h1>Guidelines & Privacy</h1>

      <p className="lede">the short version, in plain language.</p>

      <p className="guideline">
        Nightjar has no accounts, no names, and no way to trace a secret back
        to whoever posted it. Please don&apos;t post anyone&apos;s phone
        number, email, home address, full name, or any other identifying
        detail — including your own.
      </p>

      <p className="guideline">
        Every secret you post is checked for obvious contact info (phone
        numbers, emails, messaging-app handles) before it&apos;s published.
        You can also report anything that shouldn&apos;t be here using the
        flag on each card — reports are reviewed privately and aren&apos;t
        visible to other visitors.
      </p>

      <p className="guideline">
        View counts and reactions are tracked per-browser using local storage
        on your device, not a personal account — clearing your browser data
        resets what this browser remembers having seen. To keep things from
        being spammed, there&apos;s a short wait between posts.
      </p>

      <p className="guideline">
        Don&apos;t post anything illegal, threatening, or intended to harm a
        specific person. When in doubt, leave it out.
      </p>

      {/* 💡 ここにAIクレジットを追加しました */}
      <p className="guideline" style={{ opacity: 0.5, fontStyle: "italic" }}>
        Project Attribution: Nightjar is proudly built with AI, balancing 
        automated rapid development with strict transparent safeguards for human privacy.
      </p>

      <Link className="primary-btn" href="/" style={{ textAlign: "center", marginTop: "2rem" }}>
        back to secrets
      </Link>
    </div>
  );
}