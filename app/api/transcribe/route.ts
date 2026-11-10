import OpenAI from "openai";
import { ownerSession, assertOrigin } from "@/server/session";
import {
  allowTranscription,
  inspectAudio,
  transcribeAudio,
} from "@/server/transcribe";
import { logger } from "@/server/logger";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const started = Date.now();
  try {
    assertOrigin(request);
    const owner = await ownerSession();
    const form = await request.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File))
      throw new Error("Record an audio clip before transcribing.");
    const { mime, ext } = inspectAudio({ type: audio.type, size: audio.size });
    if (!allowTranscription(owner))
      return Response.json(
        {
          error:
            "Too many dictation attempts. Wait a few minutes and try again.",
        },
        { status: 429 },
      );
    const text = await transcribeAudio(
      Buffer.from(await audio.arrayBuffer()),
      `speech.${ext}`,
      mime,
    );
    logger.info(
      { component: "transcribe", bytes: audio.size, ms: Date.now() - started },
      "transcribed audio",
    );
    return Response.json({ text });
  } catch (error) {
    logger.warn(
      { component: "transcribe", err: error },
      "transcription rejected",
    );
    const message =
      error instanceof OpenAI.APIError
        ? `Transcription failed (${error.status ?? "connection"}).`
        : error instanceof Error
          ? error.message
          : "Could not transcribe that recording.";
    return Response.json({ error: message }, { status: 400 });
  }
}
