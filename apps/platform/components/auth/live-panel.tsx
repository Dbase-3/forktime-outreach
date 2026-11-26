"use client";

// The right half of sign-in: a dotted world map with calls pinging in the
// places we serve (Australia and the US), and one call playing out on a card.
// It's an illustration, not live data: four made-up calls on a loop.

import { Check, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { DOT_STEP, DOT_TOP, LAND } from "./world-dots";

const CELL = 10; // SVG units per grid dot
const W = LAND[0].length * CELL;
const H = LAND.length * CELL;

/** Where a latitude/longitude lands on the dot grid, in SVG units. */
const place = (lat: number, lon: number) => ({ x: ((lon + 180) / DOT_STEP) * CELL, y: ((DOT_TOP - lat) / DOT_STEP + 0.5) * CELL });

const CITIES = {
  Sydney: place(-33.87, 151.21),
  Melbourne: place(-37.81, 144.96),
  Brisbane: place(-27.47, 153.03),
  Perth: place(-31.95, 115.86),
  Adelaide: place(-34.93, 138.6),
  "New York": place(40.71, -74.0),
  "Los Angeles": place(34.05, -118.24),
  Chicago: place(41.88, -87.63),
  Austin: place(30.27, -97.74),
  Miami: place(25.76, -80.19),
  Seattle: place(47.6, -122.33),
};
type City = keyof typeof CITIES;

type Scene = { city: City; business: string; inbound: boolean; who: string; lines: ["ai" | "them", string][]; outcome: string };

// Every agent says it's an AI assistant and that the call is recorded, as ours do.
const SCENES: Scene[] = [
  {
    city: "Sydney",
    business: "Northside Motors",
    inbound: false,
    who: "Mia",
    lines: [
      ["ai", "Hi Mia, it's the AI assistant for Northside Motors. This call is recorded. Your car's due for its one-month check."],
      ["them", "Oh, right. Anything on Thursday?"],
      ["ai", "Thursday I have 9:30 or 2 o'clock. Which suits?"],
      ["them", "9:30 is good."],
    ],
    outcome: "Booked · Thu 9:30 am",
  },
  {
    city: "Austin",
    business: "Brightside Dental",
    inbound: true,
    who: "Caller",
    lines: [
      ["ai", "Thanks for calling Brightside Dental. I'm the AI assistant, and this call is recorded. How can I help?"],
      ["them", "I need to move my cleaning on Tuesday."],
      ["ai", "No problem. Friday at 11 is free. Want that one?"],
      ["them", "Perfect, thanks."],
    ],
    outcome: "Moved · Fri 11:00 am",
  },
  {
    city: "Melbourne",
    business: "Harbour Physio",
    inbound: false,
    who: "Noah",
    lines: [
      ["ai", "Hi Noah, it's the AI assistant for Harbour Physio. This call is recorded. You asked about a knee assessment."],
      ["them", "Yeah, I did. How much is it?"],
      ["ai", "It's $95 for the first visit. I can hold Monday at 4 for you."],
      ["them", "Go on then."],
    ],
    outcome: "Booked · Mon 4:00 pm",
  },
  {
    city: "New York",
    business: "Elm Street Realty",
    inbound: true,
    who: "Caller",
    lines: [
      ["ai", "Elm Street Realty, you're speaking with the AI assistant. This call is recorded."],
      ["them", "Is the open house on Saturday still on?"],
      ["ai", "It is, 10 till 11. Shall I text you the address?"],
      ["them", "Yes please."],
    ],
    outcome: "Address texted",
  },
];

const RING_MS = 1400;
const LINE_MS = 2600;
const OUTCOME_MS = 3200;

/** Steps through the scenes: 0 = ringing, 1..n = lines shown, n+1 = outcome. */
function useScene(still: boolean) {
  const [at, setAt] = useState({ scene: 0, step: still ? SCENES[0].lines.length + 1 : 0 });
  useEffect(() => {
    if (still) return;
    const lines = SCENES[at.scene].lines.length;
    const wait = at.step === 0 ? RING_MS : at.step <= lines ? LINE_MS : OUTCOME_MS;
    const t = setTimeout(() => setAt((a) => (a.step > lines ? { scene: (a.scene + 1) % SCENES.length, step: 0 } : { ...a, step: a.step + 1 })), wait);
    return () => clearTimeout(t);
  }, [at, still]);
  return at;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(q.matches);
    const on = () => setReduced(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** Seconds since the call connected, as m:ss. */
function useClock(running: boolean, key: number) {
  const [s, setS] = useState(0);
  useEffect(() => {
    setS(0);
    if (!running) return;
    const t = setInterval(() => setS((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [running, key]);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const Dots = memo(function Dots() {
  const dots = useMemo(() => {
    const out: string[] = [];
    LAND.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) if (row[c] === "#") out.push(`M${c * CELL + CELL / 2 - 1.8} ${r * CELL + CELL / 2}a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0`);
    });
    return out.join("");
  }, []);
  return <path d={dots} className="fill-fg/20" />;
});

export function LivePanel() {
  const still = useReducedMotion();
  const { scene, step } = useScene(still);
  const s = SCENES[scene];
  const connected = step > 0;
  const done = step > s.lines.length;
  const clock = useClock(connected && !done && !still, scene);
  const shown = s.lines.slice(0, Math.min(step, s.lines.length));
  const speaking = connected && !done && shown[shown.length - 1]?.[0] === "ai";
  const active = CITIES[s.city];
  const Dir = s.inbound ? PhoneIncoming : PhoneOutgoing;

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-subtle">
      <div className="px-12 pt-12">
        <p className="metric-label">Answering and calling · Australia &amp; US</p>
        <h2 className="mt-3 max-w-md text-2xl font-semibold leading-tight tracking-[-0.02em] text-fg">AI phone agents that pick up, call back and book, around the clock.</h2>
      </div>

      {/* The map */}
      <div className="flex flex-1 items-center px-8">
      <div className="relative w-full" style={{ aspectRatio: `${W} / ${H}` }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden>
          <Dots />
          {(Object.keys(CITIES) as City[]).map((name, i) => {
            const p = CITIES[name];
            return (
              <g key={name}>
                {!still && <circle cx={p.x} cy={p.y} r={4} className="map-ping fill-accent/40" style={{ animationDelay: `${(i * 0.73) % 4}s` }} />}
                <circle cx={p.x} cy={p.y} r={3} className="fill-accent/70" />
              </g>
            );
          })}
          <circle cx={active.x} cy={active.y} r={14} className="fill-accent/15" />
          <circle cx={active.x} cy={active.y} r={5} className="fill-accent" />
          {!still && <circle key={scene} cx={active.x} cy={active.y} r={6} className="map-ping-strong fill-none stroke-accent" strokeWidth={1.5} />}
        </svg>
        <MapLabel x={active.x / W} y={active.y / H} text={`${s.city} · ${s.inbound ? "Inbound" : "Outbound"}`} />
      </div>
      </div>

      {/* The call */}
      <div className="relative px-8 pb-10">
        <div className="mx-auto w-full max-w-[440px] rounded-2xl bg-surface p-4 shadow-lift">
          <div className="flex items-center gap-3">
            <div className="orb-wrap h-9 w-9 shrink-0" data-phase={!connected ? "idle" : done ? "ended" : speaking ? "speaking" : "listening"}>
              <div className="orb" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fg">{s.business}</p>
              <p className="flex items-center gap-1 text-xs text-fg-3">
                <Dir size={12} /> {s.inbound ? "Incoming call" : `Calling ${s.who}`} · {s.city}
              </p>
            </div>
            <span className="flex items-center gap-1.5 font-mono text-xs text-fg-2">
              {!connected ? (
                "Ringing…"
              ) : done ? (
                "Ended"
              ) : (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden /> {clock}
                </>
              )}
            </span>
          </div>

          <div className="mt-3 flex h-[156px] flex-col justify-end gap-2.5 overflow-hidden border-t border-line pt-3" aria-live="off">
            {shown.slice(-3).map(([who, text], i, arr) => (
              <div key={`${scene}-${shown.length - arr.length + i}`} className="animate-pop-in">
                <p className="metric-label">{who === "ai" ? "AI assistant" : s.who}</p>
                <p className={`mt-0.5 text-sm ${who === "ai" ? "text-fg" : "text-fg-2"}`}>{text}</p>
              </div>
            ))}
          </div>

          <div className="mt-3 flex h-6 items-center">
            {done && (
              <span key={scene} className="inline-flex animate-pop-in items-center gap-1.5 rounded-md bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                <Check size={13} strokeWidth={2.5} /> {s.outcome}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** LiveKit-style tag beside the active city (x, y are 0–1 of the map box); it
 *  sits on the left of cities near the right edge so it never runs off. */
function MapLabel({ x, y, text }: { x: number; y: number; text: string }) {
  const flip = x > 0.7;
  return (
    <span
      className="pointer-events-none absolute whitespace-nowrap rounded-md border border-line-strong bg-surface/90 px-2 py-1 font-mono text-2xs uppercase tracking-[0.08em] text-fg-2 shadow-pop backdrop-blur transition-[left,top] duration-500"
      style={{ left: `${x * 100}%`, top: `${y * 100}%`, transform: `translate(${flip ? "calc(-100% - 18px)" : "18px"}, -50%)` }}
    >
      {text}
    </span>
  );
}
