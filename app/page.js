"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

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
    const remaining = remainingAllCooldownSeconds();

    if (snapshot && remaining > 0) {
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
      setSecret((prev) =>
        prev && prev.id === secret.id ? { ...prev, views: prev.views + 1 } : prev
      );
    });
  }, [secret, isAdCard]);

  const react = async (emoji) => {
    if (!secret || isAdCard || reacted) return;
    setReacted(true);
    addId(REACTED_KEY, secret.id);
    setSecret((prev) => ({
      ...prev,
      reactions: { ...prev.reactions, [emoji]: (prev.reactions[emoji] || 0) + 1 },
    }));
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

          {/* 【収益化】匿名アプリの世界観に最適化したプレミアムアフィリエイトカード */}
          {secret && isAdCard && (
            <div
              key={secret.id}
              className={`secret-card ad-card ${transitioning ? "hiding" : ""}`}
              style={{ borderColor: "rgba(234, 179, 8, 0.3)" }}
            >
              <div className="card-badges">
                <span className="badge" style={{ backgroundColor: "rgba(234, 179, 8, 0.15)", color: "#eab308" }}>
                  SPONSOR / 暇つぶし
                </span>
              </div>
              
              <p className="secret-text" style={{ fontSize: "1.1rem", fontWeight: "500" }}>
                【深夜の暇つぶしに】今だけ無料で読める！SNSでバズり散らかした超人気コミックが全巻開放中。他人の秘密より刺激的な裏側、覗いてみる？
              </p>
              
              <div className="secret-meta" style={{ marginTop: "1.5rem" }}>
                {/* A8.netなどで取得したあなた専用のアフィリエイトURLへ差し替えてください */}
                <a 
                  href="https://px.a8.net/svt/ejp?a8mat=XXXXX" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="next-btn"
                  style={{ 
                    display: "block", 
                    width: "100%", 
                    textAlign: "center", 
                    backgroundColor: "#eab308", 
                    color: "#0a0a0a", 
                    fontWeight: "700",
                    borderRadius: "0.75rem",
                    padding: "0.85rem 0",
                    boxShadow: "0 10px 15px -3px rgba(234, 179, 8, 0.2)",
                    textDecoration: "none"
                  }}
                >
                  今すぐ無料で読む →
                </a>
              </div>
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