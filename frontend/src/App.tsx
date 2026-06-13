import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import Globe from "./Globe";
import SatellitePanel from "./SatellitePanel";
import OrbitalElementsPanel, { type OrbitalElements } from "./OrbitalElementsPanel";
import { supabase } from "./supabase";

export type Position = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  elevation_km: number;
};

export type TrailPoint = Position & { capturedOffset: number };
export type Trails = Record<number, TrailPoint[]>;

type SatelliteRecord = {
  id: number;
  name: string;
  tle_line1: string;
  tle_line2: string;
};

type Conjunction = {
  sat1: string;
  sat2: string;
  distance_km: number;
  min_distance_km: number;
  tca_minutes: number;
};

type SunMoon = {
  sun: { x: number; y: number; z: number };
  moon: { x: number; y: number; z: number };
};

const TRAIL_LENGTH = 90;
const MAX_MINUTES = 1440;

function formatOffset(m: number) {
  const sign = m >= 0 ? "+" : "-";
  const totalSec = Math.round(Math.abs(m) * 60);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
  const min = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  const sec = String(totalSec % 60).padStart(2, "0");
  return `T${sign}${h}:${min}:${sec}`;
}

const btnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "rgba(255,255,255,0.35)",
  fontFamily: "monospace",
  fontSize: 12,
  cursor: "pointer",
  padding: "2px 6px",
  letterSpacing: 1,
};

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      sessionRef.current = session;
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      sessionRef.current = session;
    });
    return () => subscription.unsubscribe();
  }, []);

  // Attaches the Supabase JWT to every API request
  const API = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
  const authFetch = (path: string, options?: RequestInit) => {
    const token = sessionRef.current?.access_token;
    return fetch(`${API}${path}`, {
      ...options,
      headers: {
        ...(options?.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  };

  const [positions, setPositions] = useState<Position[]>([]);
  const [minutesOffset, setMinutesOffset] = useState(0);
  const trailsRef = useRef<Trails>({});
  const [trails, setTrails] = useState<Trails>({});
  const [showObjects, setShowObjects] = useState(false);
  const [satellites, setSatellites] = useState<SatelliteRecord[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(10);
  const [playDirection, setPlayDirection] = useState<1 | -1>(1);
  const [showTrail, setShowTrail] = useState(true);
  const [showGroundTrack, setShowGroundTrack] = useState(true);
  const [conjunctions, setConjunctions] = useState<Conjunction[]>([]);
  const [cdmThreshold, setCdmThreshold] = useState(500);
  const [sunMoon, setSunMoon] = useState<SunMoon | null>(null);
  const [selectedSat, setSelectedSat] = useState<Position | null>(null);
  const [elements, setElements] = useState<OrbitalElements | null>(null);

  const knownIdsRef = useRef<Set<number>>(new Set());
  const isPlayingRef = useRef(false);
  isPlayingRef.current = isPlaying;
  const minutesOffsetRef = useRef(0);
  minutesOffsetRef.current = minutesOffset;

  // CDM polling
  useEffect(() => {
    if (!session) return;
    const doFetch = () => {
      authFetch(`/cdm?threshold_km=${cdmThreshold}`)
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => Array.isArray(data) && setConjunctions(data))
        .catch((err) => console.error("CDM fetch error:", err));
    };
    doFetch();
    const id = setInterval(doFetch, 5000);
    return () => clearInterval(id);
  }, [cdmThreshold, session]);

  // Time animation
  const togglePlay = (dir: 1 | -1) => {
    if (isPlaying && playDirection === dir) {
      setIsPlaying(false);
    } else {
      if (dir !== playDirection) clearTrails();
      setPlayDirection(dir);
      setIsPlaying(true);
    }
  };

  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      setMinutesOffset((prev) => {
        const next = prev + (playDirection * playSpeed) / 10;
        if (next >= MAX_MINUTES) { setIsPlaying(false); return MAX_MINUTES; }
        if (next <= -MAX_MINUTES) { setIsPlaying(false); return -MAX_MINUTES; }
        return next;
      });
    }, 100);
    return () => clearInterval(id);
  }, [isPlaying, playSpeed, playDirection]);

  const clearTrails = () => {
    trailsRef.current = {};
    knownIdsRef.current = new Set();
    setTrails({});
  };

  const resetAll = () => {
    setMinutesOffset(0);
    setIsPlaying(false);
    setPlayDirection(1);
    clearTrails();
  };

  const fetchSatelliteList = async () => {
    const res = await authFetch("/satellites/");
    const data: SatelliteRecord[] = await res.json();
    setSatellites(data);
  };

  useEffect(() => {
    if (showObjects) fetchSatelliteList();
  }, [showObjects]);

  // Display positions + sun/moon — reruns on every minutesOffset change
  useEffect(() => {
    if (!session) return;
    const fetchDisplay = async () => {
      const [posRes, smRes] = await Promise.all([
        authFetch(`/satellites/positions?minutes_from_now=${minutesOffset}`),
        authFetch(`/sun_moon?minutes_from_now=${minutesOffset}`),
      ]);
      if (!posRes.ok || !smRes.ok) return;
      const [posData, smData] = await Promise.all([posRes.json(), smRes.json()]);
      if (!Array.isArray(posData)) return;
      setPositions(posData);
      setSunMoon(smData);
    };
    fetchDisplay();
    const id = setInterval(fetchDisplay, 2000);
    return () => clearInterval(id);
  }, [minutesOffset, session]);

  // Trail accumulation — stable interval, reads live values through refs
  useEffect(() => {
    const accumulate = async () => {
      const playing = isPlayingRef.current;
      const offset = minutesOffsetRef.current;
      if (!playing && offset !== 0) return;
      if (!sessionRef.current) return;

      const res = await authFetch(
        `/satellites/positions?minutes_from_now=${offset}`,
      );
      const data: Position[] = await res.json();
      const updated = { ...trailsRef.current };
      for (const p of data) {
        if (!knownIdsRef.current.has(p.id)) {
          updated[p.id] = [];
          knownIdsRef.current.add(p.id);
        }
        updated[p.id] = [
          ...(updated[p.id] ?? []),
          { ...p, capturedOffset: offset },
        ].slice(-TRAIL_LENGTH);
      }
      trailsRef.current = updated;
      setTrails({ ...updated });
    };

    accumulate();
    const id = setInterval(accumulate, 500);
    return () => clearInterval(id);
  }, []);

  // Fetch orbital elements when a satellite is selected
  useEffect(() => {
    if (!selectedSat) { setElements(null); return; }
    authFetch(`/satellites/${selectedSat.id}/elements`)
      .then((r) => r.json())
      .then(setElements)
      .catch(console.error);
  }, [selectedSat?.id]);

  // Keep selected sat data fresh as positions update
  const selectedSatLive = selectedSat
    ? (positions.find((p) => p.id === selectedSat.id) ?? selectedSat)
    : null;

  // Login screen shown when not authenticated
  if (!session) {
    return (
      <div style={{
        width: "100%", height: "100%", background: "#000008",
        display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 24,
      }}>
        <div style={{ fontFamily: "monospace", letterSpacing: 6, fontSize: 13, color: "rgba(255,255,255,0.3)", textTransform: "uppercase" }}>
          Orbital Simulator
        </div>
        <button
          onClick={() => supabase.auth.signInWithOAuth({ provider: "github", options: { redirectTo: window.location.origin } })}
          style={{
            background: "none",
            border: "1px solid rgba(255,255,255,0.2)",
            color: "rgba(255,255,255,0.7)",
            fontFamily: "monospace",
            fontSize: 11,
            letterSpacing: 3,
            padding: "10px 24px",
            cursor: "pointer",
            textTransform: "uppercase",
          }}
        >
          Login with GitHub
        </button>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <Globe
        positions={positions}
        trails={trails}
        minutesOffset={minutesOffset}
        showTrail={showTrail}
        showGroundTrack={showGroundTrack}
        sunDir={sunMoon?.sun}
        moonDir={sunMoon?.moon}
        onSelectSat={setSelectedSat}
      />

      {/* Top bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          pointerEvents: "none",
        }}
      >
        <span
          style={{
            fontFamily: "monospace",
            fontSize: 11,
            letterSpacing: 4,
            color: "rgba(255,255,255,0.35)",
            textTransform: "uppercase",
          }}
        >
          Orbital Simulator
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <span
            style={{
              fontFamily: "monospace",
              fontSize: 11,
              color: minutesOffset === 0 ? "rgba(80,255,160,0.6)" : "rgba(255,180,60,0.7)",
              letterSpacing: 2,
            }}
          >
            {formatOffset(minutesOffset)}
            <span style={{ marginLeft: 12, color: "rgba(255,255,255,0.2)" }}>
              {positions.length} OBJ
            </span>
          </span>
          <button
            onClick={() => supabase.auth.signOut()}
            style={{ ...btnStyle, pointerEvents: "all", fontSize: 9, letterSpacing: 2, opacity: 0.5 }}
          >
            {session.user.email ?? "logout"} ✕
          </button>
        </div>
      </div>

      {/* Left panel: selected sat info + CDM */}
      <div
        style={{
          position: "absolute",
          top: 56,
          left: 20,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          maxWidth: 240,
        }}
      >
        {/* Selected satellite — full elements panel */}
        {selectedSatLive && elements && (
          <OrbitalElementsPanel
            elements={elements}
            live={selectedSatLive}
            onClose={() => setSelectedSat(null)}
          />
        )}
        {selectedSatLive && !elements && (
          <div style={{ fontFamily: "monospace", fontSize: 10, color: "rgba(255,255,255,0.3)", padding: "8px 0" }}>
            loading elements…
          </div>
        )}

        {/* CDM conjunctions */}
        {conjunctions.length > 0 && (
          <div
            style={{
              fontFamily: "monospace",
              fontSize: 9,
              letterSpacing: 3,
              color: "rgba(255,255,255,0.2)",
              textTransform: "uppercase",
            }}
          >
            Conjunctions
          </div>
        )}
        {conjunctions.map((c, i) => (
          <div
            key={i}
            style={{
              backgroundColor: "rgba(255,80,80,0.1)",
              border: "1px solid rgba(255,80,80,0.3)",
              padding: "8px 12px",
              color: "rgba(255,80,80,0.9)",
              fontFamily: "monospace",
              fontSize: 10,
              lineHeight: 1.7,
            }}
          >
            <div>
              <strong>{c.sat1}</strong> &amp; <strong>{c.sat2}</strong>
            </div>
            <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 9, marginTop: 2 }}>
              now {c.distance_km} km
            </div>
            <div style={{ color: "rgba(255,140,80,0.8)", fontSize: 9 }}>
              TCA {c.min_distance_km} km in {c.tca_minutes} min
            </div>
          </div>
        ))}

        {/* CDM threshold input */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "monospace" }}>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", letterSpacing: 2 }}>THR</span>
          <input
            type="number"
            value={cdmThreshold}
            onChange={(e) => setCdmThreshold(Number(e.target.value))}
            style={{
              width: 70,
              background: "rgba(255,255,255,0.04)",
              border: "none",
              borderBottom: "1px solid rgba(255,255,255,0.12)",
              color: "rgba(255,255,255,0.6)",
              fontFamily: "monospace",
              fontSize: 11,
              padding: "3px 0",
              outline: "none",
            }}
          />
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>km</span>
        </div>
      </div>

      {/* Right panel */}
      <div
        style={{
          position: "absolute",
          top: 56,
          right: 20,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <SatellitePanel onAdded={fetchSatelliteList} authFetch={authFetch} />

        {/* Layer toggles */}
        <div style={{ display: "flex", gap: 6 }}>
          {(
            [
              ["Trail", showTrail, setShowTrail],
              ["G-Track", showGroundTrack, setShowGroundTrack],
            ] as const
          ).map(([label, active, set]) => (
            <button
              key={label}
              onClick={() => set((v: boolean) => !v)}
              style={{
                flex: 1,
                background: "none",
                border: `1px solid ${active ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.07)"}`,
                color: active ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.2)",
                fontSize: 9,
                fontFamily: "monospace",
                letterSpacing: 2,
                padding: "5px 4px",
                cursor: "pointer",
                textTransform: "uppercase",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowObjects((v) => !v)}
          style={{
            background: "none",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "rgba(255,255,255,0.35)",
            fontSize: 10,
            fontFamily: "monospace",
            letterSpacing: 2,
            padding: "5px 10px",
            cursor: "pointer",
            textTransform: "uppercase",
            width: "100%",
          }}
        >
          {showObjects ? "Hide" : "Objects"}
        </button>

        {showObjects && (
          <div
            style={{
              fontFamily: "monospace",
              fontSize: 11,
              width: 200,
              borderTop: "1px solid rgba(255,255,255,0.08)",
              paddingTop: 8,
            }}
          >
            <div
              style={{
                fontSize: 9,
                letterSpacing: 3,
                color: "rgba(255,255,255,0.2)",
                textTransform: "uppercase",
                marginBottom: 8,
              }}
            >
              Tracked ({satellites.length})
            </div>
            {satellites.length === 0 && (
              <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 10 }}>none</div>
            )}
            {satellites.map((s) => (
              <div
                key={s.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "4px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                  color: "rgba(255,255,255,0.55)",
                }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 130,
                    fontSize: 11,
                  }}
                >
                  {s.name}
                </span>
                <button
                  onClick={async () => {
                    await authFetch(`/satellites/${s.id}`, { method: "DELETE" });
                    if (selectedSat?.id === s.id) setSelectedSat(null);
                    clearTrails();
                    fetchSatelliteList();
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "rgba(255,80,80,0.5)",
                    cursor: "pointer",
                    fontFamily: "monospace",
                    fontSize: 12,
                    padding: "0 2px",
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Time slider */}
      <div
        style={{
          position: "absolute",
          bottom: 24,
          left: "50%",
          transform: "translateX(-50%)",
          width: 360,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontFamily: "monospace",
            fontSize: 9,
            color: "rgba(255,255,255,0.2)",
            letterSpacing: 2,
            marginBottom: 6,
            textTransform: "uppercase",
          }}
        >
          <span>-24h</span>
          <span
            onClick={resetAll}
            style={{ cursor: "pointer", color: "rgba(255,255,255,0.35)" }}
          >
            reset
          </span>
          <span>+24h</span>
        </div>
        <input
          type="range"
          min={-MAX_MINUTES}
          max={MAX_MINUTES}
          value={minutesOffset}
          onChange={(e) => {
            setIsPlaying(false);
            setMinutesOffset(Number(e.target.value));
          }}
          style={{
            width: "100%",
            accentColor: minutesOffset === 0 ? "#50ffa0" : "#ffb43c",
            cursor: "pointer",
            opacity: 0.8,
          }}
        />

        {/* Playback controls */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            marginTop: 10,
            fontFamily: "monospace",
          }}
        >
          <button onClick={resetAll} style={btnStyle}>⏹</button>

          <button
            onClick={() => togglePlay(-1)}
            style={{
              ...btnStyle,
              color: isPlaying && playDirection === -1
                ? "rgba(80,255,160,0.7)"
                : "rgba(255,255,255,0.35)",
            }}
          >
            {isPlaying && playDirection === -1 ? "⏸" : "◀"}
          </button>

          <button
            onClick={() => togglePlay(1)}
            style={{
              ...btnStyle,
              color: isPlaying && playDirection === 1
                ? "rgba(80,255,160,0.7)"
                : "rgba(255,255,255,0.35)",
            }}
          >
            {isPlaying && playDirection === 1 ? "⏸" : "▶"}
          </button>

          {([1, 10, 60] as const).map((s) => (
            <button
              key={s}
              onClick={() => setPlaySpeed(s)}
              style={{
                ...btnStyle,
                color: playSpeed === s ? "rgba(255,180,60,0.9)" : "rgba(255,255,255,0.2)",
                fontSize: 9,
              }}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;
