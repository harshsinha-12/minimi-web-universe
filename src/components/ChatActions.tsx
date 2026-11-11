"use client";
import { useState } from "react";
import { Check, Copy, Download, Share2 } from "lucide-react";
import { chatFileName, formatChat } from "./chat-export";

export function ChatActions({
  answer,
  messages,
  title,
}: {
  answer: string;
  messages: { role: string; content: string }[];
  title: string;
}) {
  const [notice, setNotice] = useState("");
  function flash(text: string) {
    setNotice(text);
    window.setTimeout(() => setNotice(""), 1600);
  }
  const transcript = formatChat(messages);
  async function copy(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    flash(label);
  }
  function download() {
    const blob = new Blob([transcript], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = chatFileName(title);
    link.click();
    URL.revokeObjectURL(url);
    flash("Downloaded");
  }
  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: title || "minimi chat",
          text: transcript,
        });
        flash("Shared");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
      }
    }
    await copy(transcript, "Copied chat");
  }
  return (
    <div className="chat-actions">
      <button
        type="button"
        className="icon-btn"
        aria-label="Copy answer"
        onClick={() => void copy(answer, "Copied answer")}
      >
        <Copy size={14} />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="Copy chat"
        onClick={() => void copy(transcript, "Copied chat")}
      >
        <Copy size={14} />
        <span>Chat</span>
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="Download chat"
        onClick={download}
      >
        <Download size={14} />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="Share chat"
        onClick={() => void share()}
      >
        <Share2 size={14} />
      </button>
      {notice && (
        <span className="chat-action-notice" role="status">
          <Check size={12} /> {notice}
        </span>
      )}
    </div>
  );
}
