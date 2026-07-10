"use client";

import React from "react";
import {
  CheckCircle2, Circle, Loader2, AlertTriangle, FileText, Search, Image as ImageIcon,
  Mic2, Film, Sparkles, Download,
} from "lucide-react";
import {cx} from "@/utils/cx";

export type MonitorEvent = {
  type: string;
  stage?: string;
  percent?: number;
  message?: string;
  currentFrame?: number;
  result?: Record<string, unknown>;
};

// The canonical pipeline stages, in order, with a friendly label + icon. The
// generator emits many fine-grained `stage` values (transcribe, extract, script,
// scrape, media, logos, tts, render, ...); we map each to one of these buckets so
// the rail reads cleanly.
const STAGE_DEFS: Array<{key: string; label: string; icon: React.FC<{size?: number; className?: string}>; matches: string[]}> = [
  {key: "source", label: "Transcribe", icon: FileText, matches: ["source", "transcribe", "input"]},
  {key: "script", label: "Script", icon: Sparkles, matches: ["script", "extract"]},
  {key: "media", label: "Media", icon: ImageIcon, matches: ["scrape", "media", "logos", "prerender", "pattern"]},
  {key: "voice", label: "Voiceover", icon: Mic2, matches: ["voice", "tts"]},
  {key: "render", label: "Render", icon: Film, matches: ["render", "props"]},
  {key: "done", label: "Done", icon: Download, matches: ["done", "complete"]},
];

function bucketFor(stage?: string): string {
  const s = (stage || "").toLowerCase();
  for (const def of STAGE_DEFS) {
    if (def.matches.some((m) => s.includes(m))) return def.key;
  }
  return "script";
}

// Human-readable sub-step from a raw event message (kept short).
function describe(ev?: MonitorEvent): string {
  if (!ev) return "";
  if (ev.type === "error") return ev.message || "Error";
  if (ev.type === "complete") return "Stage complete";
  return (ev.message || ev.stage || "").toString();
}

/**
 * RenderMonitor — shows, at a glance, EXACTLY what the pipeline is doing right
 * now: which stage is active, the current sub-step, a live progress bar, the
 * frame counter during render, and a compact rolling activity feed. Driven
 * entirely by the SSE `events` the page already collects — no new wiring.
 */
export function RenderMonitor({
  events,
  progress,
  running,
  currentFrame,
  totalFrames,
  className,
}: {
  events: MonitorEvent[];
  progress: number;
  running: boolean;
  currentFrame?: number;
  totalFrames?: number;
  className?: string;
}) {
  const last = events.length ? events[events.length - 1] : undefined;
  const lastErr = [...events].reverse().find((e) => e.type === "error");
  const activeBucket = last ? bucketFor(last.stage) : "";
  const isComplete = last?.type === "complete" || progress >= 100;
  const isError = Boolean(lastErr) && last?.type === "error";

  // Which buckets have been touched (for the done/active/pending state).
  const seen = new Set(events.map((e) => bucketFor(e.stage)));
  const activeIndex = STAGE_DEFS.findIndex((d) => d.key === activeBucket);

  // Last ~6 non-empty messages for the activity feed.
  const feed = events
    .filter((e) => describe(e).trim())
    .slice(-6)
    .reverse();

  const renderingFrames = activeBucket === "render" && typeof currentFrame === "number" && currentFrame > 0 && (totalFrames || 0) > 0;

  return (
    <div className={cx("grid gap-4", className)}>
      {/* Stage rail */}
      <div className="grid grid-cols-6 gap-1.5">
        {STAGE_DEFS.map((def, i) => {
          const Icon = def.icon;
          const done = isComplete && def.key !== "done" ? true : seen.has(def.key) && (activeIndex > i || isComplete);
          const active = running && def.key === activeBucket && !isComplete;
          const errored = isError && def.key === activeBucket;
          return (
            <div
              key={def.key}
              className={cx(
                "flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-center transition-colors",
                errored
                  ? "border-red-500/40 bg-red-500/10"
                  : active
                    ? "border-primary bg-primary/10"
                    : done
                      ? "border-emerald-500/30 bg-emerald-500/10"
                      : "border-border bg-muted/20",
              )}
            >
              <span
                className={cx(
                  errored ? "text-red-400" : active ? "text-primary" : done ? "text-emerald-400" : "text-muted-foreground",
                )}
              >
                {errored ? <AlertTriangle size={16} /> : active ? <Loader2 size={16} className="animate-spin" /> : done ? <CheckCircle2 size={16} /> : <Icon size={16} />}
              </span>
              <span className="text-[9px] font-medium leading-tight text-muted-foreground">{def.label}</span>
            </div>
          );
        })}
      </div>

      {/* Current activity headline */}
      <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
        <div className="flex items-center gap-2">
          {isError ? (
            <AlertTriangle size={15} className="flex-shrink-0 text-red-400" />
          ) : isComplete ? (
            <CheckCircle2 size={15} className="flex-shrink-0 text-emerald-400" />
          ) : running ? (
            <Loader2 size={15} className="flex-shrink-0 animate-spin text-primary" />
          ) : (
            <Circle size={15} className="flex-shrink-0 text-muted-foreground" />
          )}
          <span className={cx("min-w-0 flex-1 truncate text-xs font-medium", isError ? "text-red-300" : "text-foreground")}>
            {isError ? describe(lastErr) : isComplete ? "Reel ready to download" : running ? describe(last) || "Working…" : "Idle — start a stage to begin"}
          </span>
          <span className="flex-shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{Math.round(progress)}%</span>
        </div>

        {/* Progress bar */}
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cx("h-full rounded-full transition-[width] duration-300 ease-out", isError ? "bg-red-500" : isComplete ? "bg-emerald-500" : "bg-primary")}
            style={{width: `${Math.max(2, Math.min(100, progress))}%`}}
          />
        </div>

        {/* Frame counter during render */}
        {renderingFrames ? (
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><Film size={12} /> Rendering frames</span>
            <span className="font-mono tabular-nums">{currentFrame} / {totalFrames}</span>
          </div>
        ) : null}
      </div>

      {/* Rolling activity feed */}
      <div className="grid gap-1">
        {feed.length === 0 ? (
          <p className="px-1 text-[11px] text-muted-foreground">No activity yet.</p>
        ) : (
          feed.map((ev, i) => (
            <div key={i} className={cx("flex items-start gap-2 px-1 text-[11px]", i === 0 ? "text-foreground" : "text-muted-foreground")}>
              <span className="mt-1 flex-shrink-0">
                <Circle size={6} className={cx(i === 0 ? "fill-primary text-primary" : "fill-muted-foreground/40 text-muted-foreground/40")} />
              </span>
              <span className="min-w-0 flex-1 break-words leading-snug">{describe(ev)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
