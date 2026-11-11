"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";

const MAX_MS = 90_000;

function stopStream(media: MediaStream | null) {
  media?.getTracks().forEach((track) => track.stop());
}

export function VoiceInput({
  disabled,
  onTranscript,
  onError,
}: {
  disabled?: boolean;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}) {
  const [state, setState] = useState<
    "idle" | "acquiring" | "recording" | "transcribing"
  >("idle");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stopTimer = useRef<number | null>(null);
  const alive = useRef(true);
  const acquiring = useRef(false);

  const release = useCallback(() => {
    if (stopTimer.current) window.clearTimeout(stopTimer.current);
    stopTimer.current = null;
    stopStream(stream.current);
    stream.current = null;
    recorder.current = null;
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      acquiring.current = false;
      const active = recorder.current;
      if (active && active.state !== "inactive") {
        active.ondataavailable = null;
        active.onstop = null;
        active.stop();
      }
      release();
    };
  }, [release]);

  async function upload(blob: Blob) {
    if (!alive.current) return;
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
      if (!alive.current) return;
      const data = (await response.json()) as { text?: string; error?: string };
      if (!alive.current) return;
      if (!response.ok) throw new Error(data.error || "Transcription failed.");
      if (!data.text?.trim()) {
        onError("I could not hear any words. Try again.");
        return;
      }
      onTranscript(data.text.trim());
    } catch (error) {
      if (!alive.current) return;
      onError(error instanceof Error ? error.message : "Transcription failed.");
    } finally {
      if (alive.current) setState("idle");
    }
  }

  async function toggle() {
    if (disabled || !alive.current) return;
    if (state === "recording") {
      recorder.current?.stop();
      return;
    }
    if (acquiring.current || state === "acquiring" || state === "transcribing")
      return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      onError("This browser cannot use the microphone.");
      return;
    }
    acquiring.current = true;
    setState("acquiring");
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current) {
        stopStream(media);
        return;
      }
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
        const stillMounted = alive.current;
        release();
        if (stillMounted) void upload(blob);
      };
      if (!alive.current) {
        rec.ondataavailable = null;
        rec.onstop = null;
        stopStream(media);
        release();
        return;
      }
      recorder.current = rec;
      rec.start();
      setState("recording");
      stopTimer.current = window.setTimeout(() => {
        if (alive.current) rec.stop();
      }, MAX_MS);
    } catch {
      release();
      if (!alive.current) return;
      setState("idle");
      onError("Microphone access is blocked. Allow it and try again.");
    } finally {
      acquiring.current = false;
    }
  }

  const recording = state === "recording";
  const label =
    state === "recording"
      ? "Stop dictation"
      : state === "acquiring"
        ? "Requesting microphone"
        : "Dictate a message";
  return (
    <button
      type="button"
      className={`mic-button ${recording ? "recording" : ""}`}
      aria-pressed={recording}
      aria-label={label}
      disabled={disabled || state === "transcribing" || state === "acquiring"}
      onClick={() => void toggle()}
    >
      <Mic size={16} />
      <span className="sr-only" role="status">
        {state === "recording"
          ? "Listening"
          : state === "acquiring"
            ? "Requesting microphone"
            : state === "transcribing"
              ? "Transcribing"
              : ""}
      </span>
    </button>
  );
}
