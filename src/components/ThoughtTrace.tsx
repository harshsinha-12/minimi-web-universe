"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import type { Trace } from "../types";
import { thoughtDuration, thoughtHeading } from "./thought-label";

export function ThoughtTrace({
  running,
  steps,
  elapsedMs,
  runId,
  onLoad,
}: {
  running: boolean;
  steps: Trace[];
  elapsedMs?: number | null;
  runId: string | null;
  onLoad?: () => void;
}) {
  const [opened, setOpened] = useState<boolean | null>(null);
  const open = opened ?? running;
  const requested = useRef(false);
  useEffect(() => {
    if (running || !runId || steps.length || requested.current) return;
    requested.current = true;
    onLoad?.();
  }, [running, runId, steps.length, onLoad]);
  if (!running && !runId && !steps.length) return null;
  const heading = thoughtHeading(running, thoughtDuration(steps, elapsedMs));
  return (
    <section className={`thought ${open ? "open" : ""}`}>
      <button
        type="button"
        className="thought-toggle"
        aria-expanded={open}
        onClick={() => setOpened(!open)}
      >
        <Sparkles size={14} />
        <span>{heading}</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <ol className="thought-steps">
          {steps.length ? (
            steps.map((step, index) => (
              <li
                key={`${step.at}-${index}`}
                className={
                  running && index === steps.length - 1 ? "active" : ""
                }
              >
                <span className="thought-mark" aria-hidden="true" />
                <span>{step.detail}</span>
              </li>
            ))
          ) : (
            <li className={running ? "active" : ""}>
              <span className="thought-mark" aria-hidden="true" />
              <span>{running ? "Starting" : "No steps were recorded"}</span>
            </li>
          )}
        </ol>
      )}
    </section>
  );
}
