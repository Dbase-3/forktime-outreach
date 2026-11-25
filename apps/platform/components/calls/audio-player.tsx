"use client";

// The call recording: waveform you can click or drag to jump, play/pause,
// ±10 s, speed, and a menu (download, copy transcript). A call with a real
// recording plays it; a sample call (no audio file) runs a silent clock so
// following and jumping can still be tried, and says so.

import clsx from "clsx";
import { Check, Copy, Download, MoreHorizontal, Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent } from "react";
import { clock, sampleWaveform } from "@/lib/call-review";

export interface PlayerHandle {
  seek: (sec: number, opts?: { play?: boolean }) => void;
}

interface Props {
  callId: string;
  url?: string;
  durationSec: number;
  transcriptText: string;
  onTime: (sec: number) => void;
}

const SPEEDS = [1, 1.25, 1.5, 2];
const BAR_PITCH = 5; // px per bar incl. its gap: as many bars as the width fits

export const AudioPlayer = forwardRef<PlayerHandle, Props>(function AudioPlayer({ callId, url, durationSec, transcriptText, onTime }, ref) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const wave = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(durationSec);
  const [speed, setSpeed] = useState(1);
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const simulated = !url;
  const [barCount, setBarCount] = useState(0);
  const bars = useMemo(() => (barCount > 0 ? sampleWaveform(callId, barCount) : []), [callId, barCount]);

  useEffect(() => {
    const el = wave.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setBarCount(Math.max(16, Math.floor(entry.contentRect.width / BAR_PITCH))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const timeRef = useRef(0);
  const report = useCallback(
    (t: number) => {
      timeRef.current = t;
      setTime(t);
      onTime(t);
    },
    [onTime],
  );

  // Sample calls: a silent clock that runs at the chosen speed. The position
  // lives in a ref so nothing is set from inside a state updater.
  useEffect(() => {
    if (!simulated || !playing) return;
    let last = performance.now();
    let frame = 0;
    const tick = (nowMs: number) => {
      const next = Math.min(duration, timeRef.current + ((nowMs - last) / 1000) * speed);
      last = nowMs;
      report(next);
      if (next >= duration) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [simulated, playing, speed, duration, report]);

  const seek = useCallback(
    (sec: number, opts?: { play?: boolean }) => {
      const t = Math.max(0, Math.min(duration, sec));
      if (audio.current) audio.current.currentTime = t;
      report(t);
      if (opts?.play) setPlaying(true);
    },
    [duration, report],
  );
  useImperativeHandle(ref, () => ({ seek }), [seek]);

  // Real recordings: keep the element in step with our state.
  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    el.playbackRate = speed;
    if (playing && el.paused) void el.play().catch(() => setPlaying(false));
    if (!playing && !el.paused) el.pause();
  }, [playing, speed]);

  const toggle = () => {
    if (!playing && time >= duration) seek(0);
    setPlaying((p) => !p);
  };

  const scrubTo = (clientX: number) => {
    const box = wave.current?.getBoundingClientRect();
    if (!box) return;
    seek(((clientX - box.left) / box.width) * duration);
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubTo(event.clientX);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.buttons !== 1) return;
    scrubTo(event.clientX);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(transcriptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const progress = duration > 0 ? time / duration : 0;

  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      {url && (
        <audio
          ref={audio}
          src={url}
          preload="metadata"
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || durationSec)}
          onTimeUpdate={(e) => report(e.currentTarget.currentTime)}
          onEnded={() => setPlaying(false)}
        />
      )}
      <div className="flex items-center gap-3">
        <button type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play"} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fg text-background transition hover:bg-fg/85 active:scale-95">
          {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="translate-x-px" />}
        </button>
        <div
          ref={wave}
          role="slider"
          tabIndex={0}
          aria-label="Recording position"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${clock(time)} of ${clock(duration)}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") seek(time + 5);
            if (e.key === "ArrowLeft") seek(time - 5);
          }}
          className="flex h-9 min-w-0 flex-1 cursor-pointer touch-none items-center gap-[2px] rounded focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/30"
        >
          {bars.map((h, i) => (
            <span key={i} className={clsx("flex-1 rounded-full transition-colors", i / bars.length < progress ? "bg-fg" : "bg-line-strong")} style={{ height: `${Math.round(h * 100)}%` }} />
          ))}
        </div>
        <span className="shrink-0 font-mono text-xs tabular-nums text-fg-3">
          {clock(time)} / {clock(duration)}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-1">
        <button type="button" className="btn-icon h-7 w-7" onClick={() => seek(time - 10)} aria-label="Back 10 seconds" title="Back 10 seconds">
          <RotateCcw size={14} />
        </button>
        <button type="button" className="btn-icon h-7 w-7" onClick={() => seek(time + 10)} aria-label="Forward 10 seconds" title="Forward 10 seconds">
          <RotateCw size={14} />
        </button>
        <button
          type="button"
          onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}
          title="Playback speed"
          className="h-7 rounded-md px-2 font-mono text-xs font-medium tabular-nums text-fg-2 transition-colors hover:bg-muted"
        >
          {speed}×
        </button>
        {simulated && <span className="ml-1 truncate text-xs text-fg-3">Sample call · no audio, the timeline is simulated</span>}
        <div className="relative ml-auto">
          <button type="button" className="btn-icon h-7 w-7" onClick={() => setMenu((m) => !m)} aria-label="More" aria-expanded={menu}>
            <MoreHorizontal size={15} />
          </button>
          {menu && (
            <div className="absolute right-0 top-8 z-10 w-52 overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-pop" onMouseLeave={() => setMenu(false)}>
              {url ? (
                <a href={url} download className="flex h-8 items-center gap-2 rounded-md px-2 text-sm text-fg-2 hover:bg-muted hover:text-fg">
                  <Download size={14} /> Download recording
                </a>
              ) : (
                <span className="flex h-8 items-center gap-2 px-2 text-sm text-fg-4">
                  <Download size={14} /> No audio to download
                </span>
              )}
              <button type="button" onClick={copy} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-fg-2 hover:bg-muted hover:text-fg">
                {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />} {copied ? "Copied" : "Copy transcript"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
