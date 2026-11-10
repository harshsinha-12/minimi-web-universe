import OpenAI, { toFile } from "openai";
import { settings } from "../config";

const extensions = new Map([
  ["audio/webm", "webm"],
  ["audio/mp4", "mp4"],
  ["audio/mpeg", "mp3"],
  ["audio/wav", "wav"],
  ["audio/wave", "wav"],
  ["audio/x-wav", "wav"],
  ["audio/ogg", "ogg"],
]);
const hits = new Map<string, number[]>();
const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 8;

export function inspectAudio(file: { type: string; size: number }) {
  const mime = file.type.split(";")[0]?.trim().toLowerCase() ?? "";
  const ext = extensions.get(mime);
  if (!ext)
    throw new Error("Record WebM, MP4, MPEG, WAV, or Ogg audio and try again.");
  if (file.size < 256)
    throw new Error("That recording was too short to transcribe.");
  if (file.size > 8_000_000)
    throw new Error(
      "That recording is too long. Keep it under about two minutes.",
    );
  return { mime, ext };
}

export function allowTranscription(owner: string, now = Date.now()) {
  const recent = (hits.get(owner) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= LIMIT) {
    hits.set(owner, recent);
    return false;
  }
  recent.push(now);
  hits.set(owner, recent);
  return true;
}

export function resetTranscriptionLimits() {
  hits.clear();
}

export async function transcribeAudio(
  bytes: Buffer,
  filename: string,
  mime: string,
  client = new OpenAI({ maxRetries: 0, timeout: 30_000 }),
) {
  const file = await toFile(bytes, filename, { type: mime });
  const result = await client.audio.transcriptions.create({
    file,
    model: settings.transcribeModel,
    response_format: "json",
  });
  const text = typeof result === "string" ? result : result.text;
  return text.trim();
}
