"use client";

import { useEffect } from "react";

// Renders one AdSense ad unit. The adsbygoogle.js library itself is loaded
// once, site-wide, via next/script in app/layout.js — this component just
// registers one ad slot and tells the library to fill it.
export default function AdSenseSlot({
  slot,
  format = "auto",
  fullWidthResponsive = true,
  className = "",
}) {
  useEffect(() => {
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (err) {
      console.error("AdSense push failed:", err);
    }
  }, []);

  return (
    <ins
      className={`adsbygoogle ${className}`}
      style={{ display: "block" }}
      data-ad-client="ca-pub-4598821881505606"
      data-ad-slot={slot}
      data-ad-format={format}
      data-full-width-responsive={fullWidthResponsive ? "true" : "false"}
    />
  );
}