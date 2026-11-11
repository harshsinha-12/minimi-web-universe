"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import {
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Globe2,
  History,
  Menu,
  MessageCircle,
  PanelLeftClose,
  Plus,
  Search,
  Sparkles,
  Square,
  Trash2,
  X,
  Leaf,
  SlidersHorizontal,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Conversation, Memory, Message, Trace } from "../types";
import { annotateMarkdown } from "../ai/evidence";
import { isNewConversationShortcut } from "./shortcuts";
import { consumeEvents } from "../stream/sse";
import { Cat } from "./Cat";
import { formatAnswer } from "./chat-export";
import { ChatActions } from "./ChatActions";
import { SourcePills, SourcesSidebar } from "./SourcePills";
import { ThoughtTrace } from "./ThoughtTrace";
import { VoiceInput } from "./VoiceInput";

type Bootstrap = {
  conversations: Conversation[];
  memories: Memory[];
  model: string;
  memoryEnabled: boolean;
  redisConfigured: boolean;
};
const suggestions = [
  {
    icon: Globe2,
    label: "Find a fresh perspective",
    text: "Compare three Postgres hosting options for a small TypeScript app. Check current pricing and cite official sources.",
    color: "lavender",
  },
  {
    icon: History,
    label: "Pick up an earlier thought",
    text: "What did we last discuss, and where did we leave off?",
    color: "peach",
  },
  {
    icon: Sparkles,
    label: "See what’s changed",
    text: "Has anything changed since our last comparison? Check the original options against current sources.",
    color: "sage",
  },
];
function subscribeNarrow(onChange: () => void) {
  const media = window.matchMedia("(max-width: 799px)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
function useNarrowScreen() {
  return useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia("(max-width: 799px)").matches,
    () => false,
  );
}
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

export default function ChatApp() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [thread, setThread] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [web, setWeb] = useState(false);
  const narrow = useNarrowScreen();
  const [sidebarChoice, setSidebar] = useState<boolean | null>(null);
  const sidebar = sidebarChoice ?? !narrow;
  const [panel, setPanel] = useState<"memory" | "about" | null>(null);
  const [sourceMessageId, setSourceMessageId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [traces, setTraces] = useState<
    Record<string, { trace: Trace[]; metrics: Record<string, unknown> }>
  >({});
  const [copied, setCopied] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const refresh = async () => {
    const data = await json<Bootstrap>("/api/bootstrap");
    setBoot(data);
    return data;
  };
  const openThread = async (id: string) => {
    if (busy) return;
    setError(null);
    setPanel(null);
    setThread(id);
    const data = await json<{ messages: Message[] }>(
      `/api/conversations/${id}`,
    );
    setMessages(data.messages);
    window.history.replaceState(null, "", `/?thread=${id}`);
    if (window.innerWidth < 800) setSidebar(false);
  };
  useEffect(() => {
    void json<Bootstrap>("/api/bootstrap")
      .then((data) => {
        setBoot(data);
        const id = new URLSearchParams(window.location.search).get("thread");
        if (id) return openThread(id);
      })
      .catch((e: Error) => setError(e.message));
    return () => abort.current?.abort();
    // Initial bootstrap only; thread navigation is an explicit user action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const target =
      !busy && window.location.hash
        ? document.getElementById(window.location.hash.slice(1))
        : bottom.current;
    target?.scrollIntoView({ behavior: busy ? "instant" : "smooth" });
  }, [messages, busy]);
  useEffect(() => {
    if (!panel) return;
    const timer = setInterval(() => void refresh().catch(() => {}), 10000);
    return () => clearInterval(timer);
  }, [panel]);
  const newThread = useCallback(() => {
    if (busy) return;
    setThread(null);
    setMessages([]);
    setPanel(null);
    setSourceMessageId(null);
    setText("");
    setError(null);
    window.history.replaceState(null, "", "/");
    input.current?.focus();
    if (window.innerWidth < 800) setSidebar(false);
  }, [busy]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (isNewConversationShortcut(e)) {
        e.preventDefault();
        newThread();
      }
      if (e.key === "Escape") {
        setPanel(null);
        setSourceMessageId(null);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [newThread]);
  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!text.trim() || busy || !boot) return;
    const question = text.trim();
    setText("");
    setError(null);
    setBusy(true);
    setProgress("Gathering your context");
    setPanel(null);
    const controller = new AbortController();
    abort.current = controller;
    let id = thread;
    let finished = false;
    const trace: Trace[] = [];
    const optimisticId = crypto.randomUUID();
    try {
      if (!id) {
        id = (
          await json<{ id: string }>("/api/conversations", { method: "POST" })
        ).id;
        setThread(id);
        window.history.replaceState(null, "", `/?thread=${id}`);
      }
      const activeId = id;
      setMessages((old) => [
        ...old,
        {
          id: crypto.randomUUID(),
          conversationId: activeId,
          role: "user",
          content: question,
          createdAt: new Date().toISOString(),
          status: "completed",
          citations: [],
          sources: [],
          runId: null,
        },
        {
          id: optimisticId,
          conversationId: activeId,
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          status: "running",
          citations: [],
          sources: [],
          runId: null,
        },
      ]);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: activeId,
          requestId: crypto.randomUUID(),
          message: question,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          forceSearch: web,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Could not start this answer.");
      }
      if (!response.body)
        throw new Error("Streaming is not available in this browser.");
      await consumeEvents(response.body, (event) => {
        if (event.type === "progress") {
          const step = {
            at: Number(event.at),
            stage: String(event.stage),
            detail: String(event.detail),
          };
          setProgress(step.detail);
          trace.push(step);
          setTraces((old) => ({
            ...old,
            [optimisticId]: { trace: [...trace], metrics: {} },
          }));
        }
        if (event.type === "delta")
          setMessages((old) =>
            old.map((m) =>
              m.id === optimisticId
                ? { ...m, content: m.content + String(event.text) }
                : m,
            ),
          );
        if (event.type === "done") {
          finished = true;
          const message = event.message as Message;
          setMessages((old) =>
            old.map((m) => (m.id === optimisticId ? message : m)),
          );
          setTraces((old) => ({
            ...old,
            [message.id]: {
              trace: event.trace as Trace[],
              metrics: event.metrics as Record<string, unknown>,
            },
          }));
        }
        if (event.type === "error") {
          finished = true;
          setError(String(event.error));
          if (event.message)
            setMessages((old) =>
              old.map((m) =>
                m.id === optimisticId ? (event.message as Message) : m,
              ),
            );
        }
      });
      if (!finished)
        throw new Error(
          "The connection ended before the answer completed. Your question is saved.",
        );
    } catch (e) {
      if (!id) setText(question);
      if (!controller.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Could not complete this answer.",
        );
      setMessages((old) =>
        old.map((m) =>
          m.id === optimisticId
            ? {
                ...m,
                status: "interrupted",
                content: m.content || "Answer stopped. Your question is saved.",
              }
            : m,
        ),
      );
    } finally {
      setBusy(false);
      setProgress("");
      abort.current = null;
      void refresh().catch(() => {});
      if (id) {
        const data = await json<{ messages: Message[] }>(
          `/api/conversations/${id}`,
        ).catch(() => null);
        if (data && !controller.signal.aborted) setMessages(data.messages);
      }
      if (trace.length)
        setTraces((old) => ({
          ...old,
          [optimisticId]: {
            trace: [...trace],
            metrics: old[optimisticId]?.metrics ?? {},
          },
        }));
      input.current?.focus();
    }
  }
  async function loadTrace(message: Message) {
    if (!message.runId || traces[message.id]?.trace?.length) return;
    const run = await json<{
      trace: Trace[];
      metrics: Record<string, unknown>;
    }>(`/api/runs/${message.runId}`);
    setTraces((old) =>
      old[message.id]?.trace?.length
        ? old
        : { ...old, [message.id]: { trace: run.trace, metrics: run.metrics } },
    );
  }
  const count = boot?.conversations.length ?? 0;
  const currentTitle = boot?.conversations.find((c) => c.id === thread)?.title;
  const sourceMessage =
    messages.find((item) => item.id === sourceMessageId) ?? null;

  return (
    <div
      className={`app-shell ${sidebar ? "" : "sidebar-hidden"} ${sourceMessage ? "sources-open" : ""}`}
    >
      {sidebar && (
        <button
          className="sidebar-scrim"
          aria-label="Close sidebar"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className="sidebar" aria-label="Conversations" inert={!sidebar}>
        <div className="brand">
          <Cat small />
          <span>
            minimi<span className="brand-dot">.</span>
          </span>
          <button
            className="icon-btn collapse"
            aria-label="Close sidebar"
            onClick={() => setSidebar(false)}
          >
            <PanelLeftClose size={17} />
          </button>
        </div>
        <div className="sidebar-caption">a little more context</div>
        <button className="new-thread" onClick={newThread} disabled={busy}>
          <Plus size={18} /> New conversation <span>⌘ K</span>
        </button>
        <nav>
          <button
            className={!panel ? "nav-item active" : "nav-item"}
            onClick={() => setPanel(null)}
          >
            <MessageCircle size={17} /> Conversations <span>{count}</span>
          </button>
          <button
            className={panel === "memory" ? "nav-item active" : "nav-item"}
            onClick={() => {
              setPanel("memory");
              void refresh();
            }}
          >
            <BookOpen size={17} /> Your memory{" "}
            <span>{boot?.memories.length || ""}</span>
          </button>
        </nav>
        <div className="history-label">
          <span>RECENT THREADS</span>
          <button
            className="icon-btn"
            aria-label="Search conversations"
            onClick={() => setShowSearch(!showSearch)}
          >
            <Search size={15} />
          </button>
        </div>
        {showSearch && (
          <input
            className="history-search"
            placeholder="Find a conversation…"
            aria-label="Find a conversation"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
          />
        )}
        <div className="thread-list">
          {boot?.conversations
            .filter((c) => c.title.toLowerCase().includes(filter.toLowerCase()))
            .map((c) => (
              <button
                className={`thread ${thread === c.id ? "selected" : ""}`}
                disabled={busy}
                onClick={() =>
                  void openThread(c.id).catch((e) => setError(e.message))
                }
                key={c.id}
              >
                <MessageCircle size={14} />
                <span>{c.title}</span>
              </button>
            ))}
          {count === 0 && (
            <div className="history-empty">
              Your next good thought
              <br />
              starts a thread.
            </div>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="memory-note">
            <div className="note-icon">
              <Leaf size={17} />
            </div>
            <div>
              <strong>Good thoughts stay with you.</strong>
              <p>
                Pick up where you left off,
                <br />
                even in a new conversation.
              </p>
            </div>
          </div>
          <button className="profile" onClick={() => setPanel("about")}>
            <span className="avatar">
              <Cat small />
            </span>
            <span>
              Your workspace<small>Personal research companion</small>
            </span>
            <SlidersHorizontal size={16} />
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="topbar-title">
            {!sidebar && (
              <button
                className="icon-btn"
                aria-label="Open sidebar"
                onClick={() => setSidebar(true)}
              >
                <Menu size={19} />
              </button>
            )}
            <span>
              {panel === "memory"
                ? "Your memory"
                : panel === "about"
                  ? "Your workspace"
                  : currentTitle || "A new conversation"}
            </span>
            <ChevronDown size={13} />
          </div>
          <button
            className="memory-pill"
            onClick={() => {
              setPanel(panel === "memory" ? null : "memory");
              void refresh();
            }}
          >
            <span
              className={boot?.memoryEnabled ? "status-dot" : "status-dot off"}
            />{" "}
            Memory {boot?.memoryEnabled ? "on" : "off"}
            <ChevronRight size={12} />
          </button>
        </header>
        {panel ? (
          <section className="settings-panel">
            <button className="back-link" onClick={() => setPanel(null)}>
              <X size={16} /> Back to conversation
            </button>
            {panel === "memory" ? (
              <>
                <div className="eyebrow">
                  <BookOpen size={15} /> YOUR CONTEXT, CONNECTED
                </div>
                <h1>
                  A few things
                  <br />
                  <em>worth remembering.</em>
                </h1>
                <p className="panel-intro">
                  Useful context from your conversations, with a trail back to
                  where it came from. You’re always in control.
                </p>
                <div className="memory-toolbar">
                  <span>{boot?.memories.length || 0} memories</span>
                  <button
                    className="text-btn"
                    onClick={async () => {
                      await json("/api/memory", { method: "POST" });
                      setProgress(
                        "Memory refresh queued. Your conversations are already available.",
                      );
                    }}
                  >
                    <Sparkles size={14} /> Refresh memory
                  </button>
                </div>
                {progress && !busy && <p className="muted">{progress}</p>}
                {boot?.memories.length ? (
                  <div className="memory-list">
                    {boot.memories.map((m) => (
                      <article className="memory-entry" key={m.id}>
                        <div className="memory-kind">
                          {m.kind.replaceAll("_", " ")}
                          <span>v{m.version}</span>
                        </div>
                        <p>{m.text}</p>
                        <div className="memory-entry-footer">
                          <span>
                            {m.sources.length} original{" "}
                            {m.sources.length === 1 ? "message" : "messages"} ·{" "}
                            {new Date(m.createdAt).toLocaleDateString()}
                          </span>
                          <button
                            className="icon-btn"
                            aria-label={`Forget memory: ${m.text.slice(0, 35)}`}
                            title="Forget derived memory; original conversation stays"
                            onClick={async () => {
                              await json("/api/memory", {
                                method: "DELETE",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ id: m.id }),
                              });
                              await refresh();
                            }}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                        <details>
                          <summary>Where this came from</summary>
                          {m.sources.map((s, i) => (
                            <div key={i}>
                              <blockquote>{s.quote}</blockquote>
                              <button
                                className="text-btn"
                                onClick={async () => {
                                  const source = await json<{
                                    conversationId: string;
                                  }>(`/api/messages/${s.messageId}`);
                                  await openThread(source.conversationId);
                                  window.history.replaceState(
                                    null,
                                    "",
                                    `/?thread=${source.conversationId}#message-${s.messageId}`,
                                  );
                                }}
                              >
                                {"View original conversation"}{" "}
                                <ArrowUpRight size={12} />
                              </button>
                            </div>
                          ))}
                        </details>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="memory-blank">
                    <Cat />
                    <h3>A clean slate. A curious mind.</h3>
                    <p>
                      As we talk, useful preferences and decisions will appear
                      here. Your exact conversations are saved straight away.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="eyebrow">
                  <Leaf size={15} /> MADE FOR A LITTLE MORE CLARITY
                </div>
                <h1>
                  Room to think.
                  <br />
                  <em>Context to continue.</em>
                </h1>
                <p className="panel-intro">
                  An independent chat-agent submission for the minimi hiring
                  challenge, inspired by minimi and Wispr Flow.
                </p>
                <div className="about-grid">
                  <div>
                    <Globe2 />
                    <h3>One tool. An open web.</h3>
                    <p>
                      OpenAI’s web search checks current facts and brings back
                      clickable sources.
                    </p>
                  </div>
                  <div>
                    <History />
                    <h3>Remember the conversation.</h3>
                    <p>
                      Original messages live in SQLite. Background synthesis
                      creates source-linked memories. Redis caches relevant
                      context when available.
                    </p>
                  </div>
                  <div>
                    <BookOpen />
                    <h3>Know what’s shared.</h3>
                    <p>
                      Relevant messages are sent to OpenAI to answer and
                      consolidate memory. Redis stores temporary context. This
                      is not an entirely on-device AI.
                    </p>
                  </div>
                </div>
                <p className="muted">
                  Answer model: {boot?.model || "Loading…"} · Redis:{" "}
                  {boot?.redisConfigured ? "configured" : "local fallback"}
                </p>
              </>
            )}
          </section>
        ) : (
          <>
            <div
              className={`conversation-area ${messages.length ? "has-messages" : ""}`}
            >
              {!messages.length ? (
                <section className="welcome">
                  <div className="welcome-tag">
                    <span /> A THOUGHTFUL LITTLE RESEARCH COMPANION
                  </div>
                  <div className="hero-cat">
                    <Cat />
                    <span className="cat-spark one">✦</span>
                    <span className="cat-spark two">✧</span>
                  </div>
                  <h1>
                    A little context.
                    <br />
                    <em>A lot more clarity.</em>
                  </h1>
                  <p>
                    Follow a thought. Find an answer.
                    <br />
                    Come back to a conversation that remembers.
                  </p>
                </section>
              ) : (
                <div className="message-list">
                  {messages.map((m) => (
                    <article
                      id={`message-${m.id}`}
                      className={`message ${m.role} ${m.status}`}
                      key={m.id}
                    >
                      {m.role === "assistant" && (
                        <div className="assistant-label">
                          <Cat small />
                          <span>minimi</span>
                        </div>
                      )}
                      {m.role === "assistant" && (
                        <ThoughtTrace
                          running={m.status === "running"}
                          steps={traces[m.id]?.trace ?? []}
                          elapsedMs={
                            typeof traces[m.id]?.metrics.elapsedMs === "number"
                              ? (traces[m.id]?.metrics.elapsedMs as number)
                              : null
                          }
                          runId={m.runId}
                          onLoad={() => void loadTrace(m)}
                        />
                      )}
                      <div className="message-body">
                        {m.content ? (
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              a: ({ href, children }) => (
                                <a
                                  href={href}
                                  target={
                                    href?.startsWith("http")
                                      ? "_blank"
                                      : undefined
                                  }
                                  rel="noopener noreferrer"
                                >
                                  {children}
                                </a>
                              ),
                            }}
                          >
                            {annotateMarkdown(m.content, m.citations)}
                          </ReactMarkdown>
                        ) : (
                          <div className="thinking-line">
                            <span />
                            <span />
                            <span />
                          </div>
                        )}
                      </div>
                      {m.role === "assistant" && m.status !== "running" && (
                        <>
                          <div className="message-actions">
                            {(m.sources.length > 0 ||
                              m.citations.length > 0) && (
                              <SourcePills
                                messageId={m.id}
                                sources={m.sources}
                                citations={m.citations}
                                open={sourceMessageId === m.id}
                                onToggle={() =>
                                  setSourceMessageId((current) =>
                                    current === m.id ? null : m.id,
                                  )
                                }
                              />
                            )}
                            {m.id ===
                            [...messages]
                              .reverse()
                              .find(
                                (item) =>
                                  item.role === "assistant" &&
                                  item.status !== "running",
                              )?.id ? (
                              <ChatActions
                                messages={messages}
                                title={currentTitle || "minimi chat"}
                              />
                            ) : (
                              <button
                                type="button"
                                className="icon-btn"
                                aria-label="Copy answer"
                                onClick={() => {
                                  void navigator.clipboard.writeText(
                                    formatAnswer(m),
                                  );
                                  setCopied(m.id);
                                  setTimeout(() => setCopied(null), 1600);
                                }}
                              >
                                {copied === m.id ? (
                                  <Check size={14} />
                                ) : (
                                  <Copy size={14} />
                                )}
                              </button>
                            )}
                            {m.status !== "completed" && (
                              <span className="interrupted-label">
                                {m.status}
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </article>
                  ))}
                  <div ref={bottom} />
                </div>
              )}
            </div>
            <div
              className={`composer-section ${messages.length ? "docked" : ""}`}
            >
              <form className="composer" onSubmit={send}>
                <label className="sr-only" htmlFor="message">
                  Your message
                </label>
                <textarea
                  ref={input}
                  id="message"
                  placeholder="What’s on your mind?"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={2}
                  maxLength={12000}
                  disabled={!boot}
                />
                <div className="composer-bottom">
                  <button
                    type="button"
                    className={`web-toggle ${web ? "enabled" : ""}`}
                    aria-pressed={web}
                    onClick={() => setWeb(!web)}
                  >
                    <Globe2 size={15} /> Search the web
                    {web && <Check size={12} />}
                  </button>
                  <div className="composer-right">
                    <span className="model-label">
                      Thoughtful by nature <Sparkles size={12} />
                    </span>
                    <VoiceInput
                      disabled={!boot}
                      onTranscript={(transcript) => {
                        setText((current) =>
                          current.trim()
                            ? `${current.trim()} ${transcript}`
                            : transcript,
                        );
                        input.current?.focus();
                      }}
                      onError={setError}
                    />
                    {busy ? (
                      <button
                        type="button"
                        className="send-button stop"
                        aria-label="Stop answer"
                        onClick={() => abort.current?.abort()}
                      >
                        <Square size={16} fill="currentColor" />
                      </button>
                    ) : (
                      <button
                        type="submit"
                        className="send-button"
                        aria-label="Send message"
                        disabled={!text.trim() || !boot}
                      >
                        <ArrowUp size={20} />
                      </button>
                    )}
                  </div>
                </div>
              </form>
              {error && (
                <div className="error-banner" role="alert">
                  {error}
                  <button
                    className="icon-btn"
                    aria-label="Dismiss error"
                    onClick={() => setError(null)}
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
              {!messages.length && (
                <div className="suggestions">
                  {suggestions.map((s) => (
                    <button
                      className={`suggestion ${s.color}`}
                      key={s.label}
                      onClick={() => {
                        setText(s.text);
                        input.current?.focus();
                      }}
                    >
                      <s.icon size={17} />
                      <span>{s.label}</span>
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
                </div>
              )}
              <div className="composer-caption">
                <span>Curiosity welcome. Sources included.</span>
                <span>
                  Mic to dictate · Enter to send <kbd>↵</kbd>
                </span>
              </div>
            </div>
          </>
        )}
        <footer className="app-footer">
          <span>Small companion. Bigger picture.</span>
          <button onClick={() => setPanel("about")}>
            Made with context <Leaf size={11} />
          </button>
        </footer>
      </main>
      {sourceMessage && (
        <>
          <button
            className="sources-scrim"
            aria-label="Close sources"
            onClick={() => setSourceMessageId(null)}
          />
          <SourcesSidebar
            messageId={sourceMessage.id}
            sources={sourceMessage.sources}
            citations={sourceMessage.citations}
            onClose={() => setSourceMessageId(null)}
          />
        </>
      )}
    </div>
  );
}
