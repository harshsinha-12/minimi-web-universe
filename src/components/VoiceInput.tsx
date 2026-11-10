"use client";
import { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";

const MAX_MS = 90_000;

export function VoiceInput({
  disabled,
  onTranscript,
  onError,
}: {
  disabled?: boolean;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}) {
  const [state, setState] = useState<"idle" | "recording" | "transcribing">(
    "idle",
  );
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stopTimer = useRef<number | null>(null);

  function release() {
    if (stopTimer.current) window.clearTimeout(stopTimer.current);
    stopTimer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    recorder.current = null;
  }

  useEffect(() => release, []);

  async function upload(blob: Blob) {
    setState("transcribing");
    try {
      if (blob.size < 800) {
        onError("That recording was too short. Hold the mic a little longer.");
        return;
      }
      const type = blob.type.split(";")[0] || "audio/webm";
      const extension = type.includes("mp4")
        ? "mp4"
        : type.includes("ogg")
          ? "ogg"
          : type.includes("wav")
            ? "wav"
            : "webm";
      const body = new FormData();
      body.set(
        "audio",
        new File([blob], `speech.${extension}`, { type: type || "audio/webm" }),
      );
      const response = await fetch("/api/transcribe", { method: "POST", body });
      const data = (await response.json()) as { text?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "Transcription failed.");
      if (!data.text?.trim()) {
        onError("I could not hear any words. Try again.");
        return;
      }
      onTranscript(data.text.trim());
    } catch (error) {
      onError(error instanceof Error ? error.message : "Transcription failed.");
    } finally {
      setState("idle");
    }
  }

  async function toggle() {
    if (disabled || state === "transcribing") return;
    if (state === "recording") {
      recorder.current?.stop();
      return;
    }
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      onError("This browser cannot use the microphone.");
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
      const mime = preferred.find((item) =>
        MediaRecorder.isTypeSupported(item),
      );
      const rec = new MediaRecorder(
        media,
        mime ? { mimeType: mime } : undefined,
      );
      chunks.current = [];
      rec.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunks.current, {
          type: rec.mimeType || "audio/webm",
        });
        release();
        void upload(blob);
      };
      recorder.current = rec;
      rec.start();
      setState("recording");
      stopTimer.current = window.setTimeout(() => rec.stop(), MAX_MS);
    } catch {
      release();
      setState("idle");
      onError("Microphone access is blocked. Allow it and try again.");
    }
  }

  const recording = state === "recording";
  return (
    <button
      type="button"
      className={`mic-button ${recording ? "recording" : ""}`}
      aria-pressed={recording}
      aria-label={recording ? "Stop dictation" : "Dictate a message"}
      disabled={disabled || state === "transcribing"}
      onClick={() => void toggle()}
    >
      <Mic size={16} />
      <span className="sr-only" role="status">
        {state === "recording"
          ? "Listening"
          : state === "transcribing"
            ? "Transcribing"
            : ""}
      </span>
    </button>
  );
}
