"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "../lib/supabaseClient";
import AdSenseSlot from "./components/AdSenseSlot";

const EMOJIS = ["😂", "😢", "❤️", "😮", "😡"];
const VIEWED_KEY = "nightjar_viewed_secrets";
const REACTED_KEY = "nightjar_reacted_ids";
const REPORTED_KEY = "nightjar_reported_ids";
const MY_SECRETS_KEY = "nightjar_my_secret_ids"; 

const MY_REACTIONS_KEY = "nightjar_reacted_ids";

const AD_EVERY = 5; // 5枚ごとにスポンサーカードを挿入してマネタイズ
const COOLDOWN_SECONDS = 5; 
const TRANSITION_MS = 350; 
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; 

const ALL_SESSION_KEY = "nightjar_all_session";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readIds(key) {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id) => typeof id === "string" && UUID_REGEX.test(id));
  } catch {
    return [];
  }
}

function addId(key, id) {
  const current = readIds(key);
  if (!current.includes(id)) {
    current.push(id);
    window.localStorage.setItem(key, JSON.stringify(current));
  }
}

function readMyFeedIds() {
  const posted = readIds(MY_SECRETS_KEY);
  const reactedTo = readIds(MY_REACTIONS_KEY);
  return [...new Set([...posted, ...reactedTo])];
}

function readAllSession() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ALL_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.secret) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeAllSession(snapshot) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ALL_SESSION_KEY, JSON.stringify(snapshot));
  } catch {
  }
}

function remainingAllCooldownSeconds() {
  const snapshot = readAllSession();
  if (!snapshot || !snapshot.cooldownEndsAt) return 0;
  const remainingMs = snapshot.cooldownEndsAt - Date.now();
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

function FeedListItem({ item, isMine, isReactedByMe, showToast, onRemoved }) {
  const [reacted, setReacted] = useState(() =>
    readIds(REACTED_KEY).includes(item.id)
  );
  const [reactions, setReactions] = useState(item.reactions || {});
  const [views, setViews] = useState(item.views);
  const [hiding, setHiding] = useState(false);
  const viewedRef = useRef(false);

  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;

    const alreadyViewed = readIds(VIEWED_KEY).includes(item.id);
    if (alreadyViewed) return;

    addId(VIEWED_KEY, item.id);
    supabase.rpc("increment_view", { secret_id: item.id }).then(() => {
      setViews((v) => v + 1);
    });
  }, []);

  const react = async (emoji) => {
    if (reacted) return;
    setReacted(true);
    addId(REACTED_KEY, item.id);
    setReactions((prev) => ({ ...prev, [emoji]: (prev[emoji] || 0) + 1 }));
    await supabase.rpc("add_reaction", { secret_id: item.id, emoji_key: emoji });
  };

  const report = async () => {
    if (hiding) return;
    addId(REPORTED_KEY, item.id);
    setHiding(true);
    showToast("Reported");

    setTimeout(() => {
      onRemoved(item.id);
    }, TRANSITION_MS);

    const { error: reportError } = await supabase
      .from("reports")
      .insert({ secret_id: item.id });

    if (reportError) {
      console.error("Failed to save report for secret:", item.id, reportError);
    }
  };

  return (
    <div className={`secret-card list-item ${hiding ? "hiding" : ""}`}>
      {(isMine || isReactedByMe) && (
        <div className="card-badges">
          {isMine && <span className="badge badge-mine">My Secret</span>}
          {isReactedByMe && <span className="badge badge-reacted">Reacted</span>}
        </div>
      )}
      <button
        type="button"
        className="report-btn"
        onClick={report}
        disabled={hiding}
        aria-label="report this secret"
      >
        ⚑ report
      </button>
      <p className="secret-text">{item.content}</p>
      <div className="secret-meta">
        <span>seen by {views} strangers</span>
        <span>{new Date(item.created_at).toLocaleDateString()}</span>
      </div>
      <div className="reactions list-reactions">
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            className="reaction-btn"
            onClick={() => react(emoji)}
            disabled={reacted}
            aria-label={`react with ${emoji}`}
          >
            <span>{emoji}</span>
            <span className="reaction-count">{reactions?.[emoji] || 0}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MyFeedTimeline({ showToast }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [subTab, setSubTab] = useState("all"); 

  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    setLoading(true);
    setError(null);

    const candidateIds = readMyFeedIds();

    if (candidateIds.length === 0) {
      if (requestId !== requestIdRef.current) return;
      setItems([]);
      setError("Nothing here yet — post a secret or react to one to build your feed.");
      setLoading(false);
      return;
    }

    const cutoffIso = new Date(Date.now() - EXPIRY_MS).toISOString();

    const { data, error: fetchError } = await supabase
      .from("secrets")
      .select("*")
      .in("id", candidateIds)
      .gte("created_at", cutoffIso)
      .order("created_at", { ascending: false });

    if (requestId !== requestIdRef.current) return;

    if (fetchError) {
      setItems([]);
      setError("Couldn't reach the dark. Check your Supabase setup.");
      setLoading(false);
      return;
    }

    if (!data || data.length === 0) {
      setItems([]);
      setError("Nothing here yet — post a secret or react to one to build your feed.");
      setLoading(false);
      return;
    }

    const uniqueById = Array.from(
      new Map(data.map((row) => [row.id, row])).values()
    );

    setItems(uniqueById);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  const myPostedIds = readIds(MY_SECRETS_KEY);
  const myReactedIds = readIds(MY_REACTIONS_KEY);

  const filteredItems = items.filter((item) => {
    if (subTab === "mine") return myPostedIds.includes(item.id);
    if (subTab === "reacted") return myReactedIds.includes(item.id);
    return true;
  });

  return (
    <>
      <div className="tab-switch">
        <button
          type="button"
          className={`tab-btn ${subTab === "all" ? "active" : ""}`}
          onClick={() => setSubTab("all")}
        >
          All
        </button>
        <button
          type="button"
          className={`tab-btn ${subTab === "mine" ? "active" : ""}`}
          onClick={() => setSubTab("mine")}
        >
          My Secrets
        </button>
        <button
          type="button"
          className={`tab-btn ${subTab === "reacted" ? "active" : ""}`}
          onClick={() => setSubTab("reacted")}
        >
          Reacted
        </button>
      </div>

      {loading && <p className="status-text">gathering your feed…</p>}

      {error && !loading && <p className="status-text error">{error}</p>}

      {!loading && !error && filteredItems.length === 0 && (
        <p className="status-text">nothing in this filter yet.</p>
      )}

      {!loading && !error && filteredItems.length > 0 && (
        <div className="feed-list">
          {filteredItems.map((item) => (
            <FeedListItem
              key={item.id}
              item={item}
              isMine={myPostedIds.includes(item.id)}
              isReactedByMe={myReactedIds.includes(item.id)}
              showToast={showToast}
              onRemoved={(id) =>
                setItems((prev) => prev.filter((s) => s.id !== id))
              }
            />
          ))}
        </div>
      )}
    </>
  );
}

export default function Home() {
  const [secret, setSecret] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reacted, setReacted] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [viewCount, setViewCount] = useState(0);
  const [isAdCard, setIsAdCard] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const [toast, setToast] = useState(null);
  const [activeTab, setActiveTab] = useState("all"); 
  const [myFeedMountKey, setMyFeedMountKey] = useState(0);

  const viewedThisSecret = useRef(false);
  const toastTimer = useRef(null);

  const pathname = usePathname();
  const prevPathnameRef = useRef(pathname);

  const showToast = (message) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  // Re-saves the session snapshot after the *content* of the current
  // secret changes (a reaction, a view-count bump) without touching the
  // cooldown that's already in progress — so a stale reaction/view count
  // never resurfaces after navigating away and back.
  const refreshSessionSnapshot = useCallback(
    (updatedSecret) => {
      const existing = readAllSession();
      writeAllSession({
        secret: updatedSecret,
        isAdCard,
        viewCount,
        cooldownEndsAt: existing?.cooldownEndsAt ?? Date.now(),
      });
    },
    [isAdCard, viewCount]
  );

  const loadRandomSecret = useCallback(async () => {
    const excludeIds = readIds(VIEWED_KEY);

    const { data, error: rpcError } = await supabase.rpc("get_random_secret", {
      exclude_ids: excludeIds,
    });

    if (rpcError) {
      setError("Couldn't reach the dark. Check your Supabase setup.");
      setLoading(false);
      return null;
    }

    let row = data && data[0];

    if (!row) {
      const { data: anyData, error: anyError } = await supabase.rpc(
        "get_random_secret",
        { exclude_ids: [] }
      );
      if (anyError) {
        setError("Couldn't reach the dark. Check your Supabase setup.");
        setLoading(false);
        return null;
      }
      row = anyData && anyData[0];
    }

    if (!row) {
      setSecret(null);
      setError("No secrets yet. Be the first to let one go.");
      setLoading(false);
      return null;
    }

    setSecret(row);
    setReacted(readIds(REACTED_KEY).includes(row.id));
    setLoading(false);
    return row;
  }, []);

  const advanceCard = useCallback(async () => {
    setLoading(true);
    setError(null);
    setTransitioning(false);
    setIsAdCard(false);
    viewedThisSecret.current = false;

    const nextCount = viewCount + 1;
    const showAd = nextCount % AD_EVERY === 0;

    let card = null;

    if (showAd) {
      card = { id: `ad-${nextCount}` };
      setIsAdCard(true);
      setSecret(card);
      setLoading(false);
    } else {
      card = await loadRandomSecret();
    }

    if (card) {
      setViewCount(nextCount);
      const cooldownEndsAt = Date.now() + COOLDOWN_SECONDS * 1000;
      writeAllSession({
        secret: card,
        isAdCard: showAd,
        viewCount: nextCount,
        cooldownEndsAt,
      });
      setCooldown(COOLDOWN_SECONDS);
    }
  }, [viewCount, loadRandomSecret]);

  useEffect(() => {
    if (activeTab !== "all") return;

    const snapshot = readAllSession();

    // Restoring the previously-shown secret should NOT depend on whether
    // the 5-second "next button" pacing cooldown has expired — those are
    // two unrelated things. A snapshot existing at all means "this is what
    // was on screen last", and should always be restored on return,
    // regardless of how long the visitor was away. `remaining` below only
    // controls whether the next-button is immediately clickable again.
    if (snapshot) {
      const remaining = remainingAllCooldownSeconds();
      setSecret(snapshot.secret);
      setIsAdCard(snapshot.isAdCard);
      setViewCount(snapshot.viewCount);
      setReacted(
        !snapshot.isAdCard && readIds(REACTED_KEY).includes(snapshot.secret.id)
      );
      setCooldown(remaining);
      setLoading(false);
      setError(null);
      setTransitioning(false);
      viewedThisSecret.current = true;
    } else {
      advanceCard();
    }
  }, [activeTab]);

  useEffect(() => {
    const cameBackToThisPage =
      prevPathnameRef.current !== pathname && pathname === "/";
    prevPathnameRef.current = pathname;

    if (cameBackToThisPage && activeTab === "mine") {
      setMyFeedMountKey((k) => k + 1);
    }
  }, [pathname, activeTab]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const interval = setInterval(() => {
      setCooldown(remainingAllCooldownSeconds());
    }, 1000);
    return () => clearInterval(interval);
  }, [cooldown > 0]);

  useEffect(() => {
    if (!secret || isAdCard || viewedThisSecret.current) return;
    viewedThisSecret.current = true;

    const alreadyViewed = readIds(VIEWED_KEY).includes(secret.id);
    if (alreadyViewed) return;

    addId(VIEWED_KEY, secret.id);
    supabase.rpc("increment_view", { secret_id: secret.id }).then(() => {
      const updated = { ...secret, views: secret.views + 1 };
      setSecret(updated);
      refreshSessionSnapshot(updated);
    });
  }, [secret, isAdCard]);

  const react = async (emoji) => {
    if (!secret || isAdCard || reacted) return;
    setReacted(true);
    addId(REACTED_KEY, secret.id);
    const updated = {
      ...secret,
      reactions: { ...secret.reactions, [emoji]: (secret.reactions[emoji] || 0) + 1 },
    };
    setSecret(updated);
    refreshSessionSnapshot(updated);
    await supabase.rpc("add_reaction", { secret_id: secret.id, emoji_key: emoji });
  };

  const goToNext = () => {
    if (transitioning || loading || cooldown > 0) return;
    setTransitioning(true);
    setTimeout(() => {
      advanceCard();
    }, TRANSITION_MS);
  };

  const reportSecret = async () => {
    if (!secret || isAdCard || transitioning) return;

    const reportedId = secret.id;

    addId(REPORTED_KEY, reportedId);
    setTransitioning(true);
    showToast("Reported");

    setTimeout(() => {
      advanceCard();
    }, TRANSITION_MS);

    const { error: reportError } = await supabase
      .from("reports")
      .insert({ secret_id: reportedId });

    if (reportError) {
      console.error("Failed to save report for secret:", reportedId, reportError);
    }
  };

  const switchTab = (tab) => {
    if (tab === activeTab || loading || transitioning) return;
    setActiveTab(tab);
    setViewCount(0);
    setCooldown(0);

    if (tab === "mine") {
      setMyFeedMountKey((k) => k + 1);
    }
  };

  const nextLabel = loading
    ? "listening…"
    : cooldown > 0
    ? `next secret (${cooldown}s)`
    : error
    ? "try again →"
    : "next secret →";

  return (
    <div className="stage">
      <div className="tab-switch">
        <button
          type="button"
          className={`tab-btn ${activeTab === "all" ? "active" : ""}`}
          onClick={() => switchTab("all")}
          disabled={loading || transitioning}
        >
          All Secrets
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === "mine" ? "active" : ""}`}
          onClick={() => switchTab("mine")}
          disabled={loading || transitioning}
        >
          My Feed
        </button>
      </div>

      {activeTab === "all" && (
        <>
          {loading && !secret && (
            <p className="status-text">listening in the dark…</p>
          )}

          {error && !secret && <p className="status-text error">{error}</p>}

          {/*
            Feed rotation ad slot. The A8.net affiliate card that was here
            required a Japanese bank account for payout, which isn't usable
            right now — replaced with an AdSense slot instead, since AdSense
            supports payout to a Thai bank account.
            TODO: replace "YOUR_AD_SLOT_ID_FEED" with the real ad unit slot
            id once your AdSense review is approved and you've created a
            dedicated ad unit for this placement.
          */}
          {secret && isAdCard && (
            <div
              key={secret.id}
              className={`ad-card ${transitioning ? "hiding" : ""}`}
            >
              <span className="ad-eyebrow">Sponsored</span>
              <AdSenseSlot slot="YOUR_AD_SLOT_ID_FEED" className="feed-ad-slot" />
            </div>
          )}

          {secret && !isAdCard && (
            <div
              key={secret.id}
              className={`secret-card ${transitioning ? "hiding" : ""}`}
            >
              <button
                type="button"
                className="report-btn"
                onClick={reportSecret}
                disabled={transitioning}
                aria-label="report this secret"
              >
                ⚑ report
              </button>
              <p className="secret-text">{secret.content}</p>
              <div className="secret-meta">
                <span>seen by {secret.views} strangers</span>
                <span>{new Date(secret.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          )}

          {secret && !isAdCard && (
            <div className="reactions">
              {EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  className="reaction-btn"
                  onClick={() => react(emoji)}
                  disabled={reacted || transitioning}
                  aria-label={`react with ${emoji}`}
                >
                  <span>{emoji}</span>
                  <span className="reaction-count">
                    {secret.reactions?.[emoji] || 0}
                  </span>
                </button>
              ))}
            </div>
          )}

          <button
            className="next-btn"
            onClick={goToNext}
            disabled={loading || transitioning || cooldown > 0}
          >
            {nextLabel}
          </button>
        </>
      )}

      {activeTab === "mine" && (
        <MyFeedTimeline
          key={`mine-active-${myFeedMountKey}`}
          showToast={showToast}
        />
      )}

      <Link href="/post" className="confess-link">
        got one of your own? confess it →
      </Link>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}