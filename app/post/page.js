"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";

const MAX_LEN = 500;
const POST_COOLDOWN = 90 * 1000; // 90 seconds
const LAST_POST_KEY = "nightjar_last_post_time";
const MY_SECRETS_KEY = "nightjar_my_secret_ids";

// Words/phrases that usually signal someone is trying to exchange contact
// details rather than post an anonymous secret. Add or remove freely.
const NG_WORDS = [
  "line id",
  "line:",
  "whatsapp",
  "wechat",
  "telegram",
  "instagram",
  "facebook",
  "snapchat",
  "kakao",
  "@gmail",
  "@hotmail",
  "@yahoo",
  "@outlook",
];

// Matches common phone-number shapes: 090-123-4567, (02) 1234 5678,
// +66 81 234 5678, 0812345678, etc.
const PHONE_REGEX = /(\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{2,4}[-.\s]?\d{3,4}\b/;

// Catches any run of 7+ digits in a row (covers phone numbers formatted
// without separators, and most ID-style numbers).
const LONG_DIGIT_REGEX = /\d{7,}/;

// Standard email pattern.
const EMAIL_REGEX = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

/**
 * Checks free-text content for personal contact info or NG words.
 * Returns a human-readable description of the first violation found,
 * or null if the text looks safe to post.
 */
function findPrivacyViolation(text) {
  if (EMAIL_REGEX.test(text)) return "an email address";
  if (PHONE_REGEX.test(text) || LONG_DIGIT_REGEX.test(text)) return "a phone number";

  const lower = text.toLowerCase();
  for (const word of NG_WORDS) {
    if (lower.includes(word)) return `a reference to a messaging app or contact handle ("${word}")`;
  }

  return null;
}

export default function PostSecret() {
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  const cooldownInterval = useRef(null);

  // Starts (or restarts) the countdown from a given "last posted at" time.
  // Safe to call with a stale/old timestamp — it just resolves to 0.
  const startCooldownFrom = (lastPostTime) => {
    const elapsed = Date.now() - lastPostTime;
    const remainingMs = POST_COOLDOWN - elapsed;

    if (cooldownInterval.current) {
      clearInterval(cooldownInterval.current);
      cooldownInterval.current = null;
    }

    if (remainingMs <= 0) {
      setCooldownRemaining(0);
      return;
    }

    setCooldownRemaining(Math.ceil(remainingMs / 1000));

    cooldownInterval.current = setInterval(() => {
      setCooldownRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownInterval.current);
          cooldownInterval.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // On mount, check whether a cooldown from a previous post is still active.
  useEffect(() => {
    const lastPostRaw = window.localStorage.getItem(LAST_POST_KEY);
    if (lastPostRaw) {
      const lastPostTime = parseInt(lastPostRaw, 10);
      if (!Number.isNaN(lastPostTime)) {
        startCooldownFrom(lastPostTime);
      }
    }

    return () => {
      if (cooldownInterval.current) clearInterval(cooldownInterval.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (cooldownRemaining > 0) return; // extra guard, in case the button state is stale

    const trimmed = content.trim();
    if (!trimmed) return;

    setError(null);

    const violation = findPrivacyViolation(trimmed);
    if (violation) {
      setError(
        `This looks like it contains ${violation}. For your safety, remove any personal contact details and try again.`
      );
      return;
    }

    setSubmitting(true);

    const { data: inserted, error: insertError } = await supabase
      .from("secrets")
      .insert({ content: trimmed })
      .select("id")
      .single();

    setSubmitting(false);

    if (insertError) {
      setError("That secret couldn't be released. Try again.");
      return;
    }

    // Remember this secret as one of "mine" — not used for anything yet,
    // but here so a future feature (e.g. "my posts" / self-delete) has
    // something to work from without needing an account system.
    if (inserted?.id) {
      try {
        const mySecrets = JSON.parse(
          window.localStorage.getItem(MY_SECRETS_KEY) || "[]"
        );
        if (Array.isArray(mySecrets) && !mySecrets.includes(inserted.id)) {
          mySecrets.push(inserted.id);
          window.localStorage.setItem(MY_SECRETS_KEY, JSON.stringify(mySecrets));
        }
      } catch {
        // If localStorage is unavailable or corrupted, this is a nice-to-have,
        // not a requirement — fail silently rather than blocking the post.
      }
    }

    setContent("");
    setDone(true);

    // Start the 90-second cooldown right as the post succeeds.
    const now = Date.now();
    window.localStorage.setItem(LAST_POST_KEY, now.toString());
    startCooldownFrom(now);
  };

  if (done) {
    return (
      <div className="compose">
        <h1>Released.</h1>
        <p className="lede">
          it's out there now, waiting for a stranger to find it.
        </p>
        <Link className="primary-btn" href="/" style={{ textAlign: "center" }}>
          go read some secrets
        </Link>
        <button
          className="next-btn"
          onClick={() => {
            // Even if this is clicked during an active cooldown, the compose
            // view below re-checks cooldownRemaining and shows the rest
            // message instead of the form — so the limit can't be bypassed.
            setDone(false);
          }}
          style={{ marginTop: "0.5rem" }}
        >
          confess again
        </button>
      </div>
    );
  }

  if (cooldownRemaining > 0) {
    return (
      <div className="compose">
        <h1>Let it go.</h1>
        <p className="lede" style={{ opacity: 0.6 }}>
          no account, no name, no way back to you. once it's posted, it belongs
          to the dark.
        </p>
        <p className="guideline">
          Your mind needs rest. You can release another secret in{" "}
          {cooldownRemaining} second{cooldownRemaining === 1 ? "" : "s"}.
        </p>
        <textarea value="" placeholder="type your secret…" disabled readOnly />
        <div className="compose-footer">
          <span className="char-count">0 / {MAX_LEN}</span>
          <button className="primary-btn" type="button" disabled>
            wait {cooldownRemaining}s
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="compose" onSubmit={submit}>
      <h1>Let it go.</h1>
      <p className="lede">
        no account, no name, no way back to you. once it's posted, it belongs
        to the dark.
      </p>
      <p className="guideline">
        Please do not share any personal identification, phone numbers,
        addresses, or harmful content. Keep it anonymous and safe.
      </p>
      <textarea
        value={content}
        maxLength={MAX_LEN}
        onChange={(e) => setContent(e.target.value)}
        placeholder="type your secret…"
        disabled={submitting}
        autoFocus
      />
      <div className="compose-footer">
        <span className={`char-count ${content.length >= MAX_LEN ? "limit" : ""}`}>
          {content.length} / {MAX_LEN}
        </span>
        <button
          className="primary-btn"
          type="submit"
          disabled={submitting || !content.trim() || cooldownRemaining > 0}
        >
          {submitting ? "releasing…" : "release it"}
        </button>
      </div>
      {error && <p className="status-text error">{error}</p>}
    </form>
  );
}