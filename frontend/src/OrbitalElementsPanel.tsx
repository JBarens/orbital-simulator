import type { Position } from "./App";

export type OrbitalElements = {
  name: string;
  inclination: number;
  raan: number;
  eccentricity: number;
  arg_perigee: number;
  mean_anomaly: number;
  semi_major_axis_km: number;
  period_minutes: number;
  perigee_altitude_km: number;
  apogee_altitude_km: number;
};

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div style={{ flex: 1, background: "rgba(255,255,255,0.08)", height: 3, borderRadius: 2 }}>
      <div
        style={{
          width: `${Math.min((value / max) * 100, 100)}%`,
          height: "100%",
          background: "rgba(255,160,50,0.65)",
          borderRadius: 2,
        }}
      />
    </div>
  );
}

function OrbitShape({
  e,
  perigee,
  apogee,
}: {
  e: number;
  perigee: number;
  apogee: number;
}) {
  const a = 78;
  const b = a * Math.sqrt(Math.max(1 - e * e, 0.0001));
  const c = a * e;
  // Shift ellipse right so the left focus (Earth) has breathing room
  const cx = 20 + c + a;
  const cy = 58;

  return (
    <svg viewBox="0 0 210 116" style={{ width: "100%", display: "block" }}>
      {/* Orbit ellipse */}
      <ellipse
        cx={cx}
        cy={cy}
        rx={a}
        ry={b}
        fill="none"
        stroke="rgba(255,255,255,0.14)"
        strokeWidth={1.2}
        strokeDasharray="5 4"
      />
      {/* Earth at left focus */}
      <circle cx={cx - c} cy={cy} r={8} fill="rgba(30,90,220,0.85)" />
      <circle cx={cx - c} cy={cy} r={8} fill="none" stroke="rgba(100,180,255,0.35)" strokeWidth={1.5} />
      {/* Perigee */}
      <circle cx={cx - a} cy={cy} r={3.5} fill="rgba(255,90,50,0.9)" />
      <text x={cx - a} y={cy + 14} textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize={7}>
        Pe {Math.round(perigee)} km
      </text>
      {/* Apogee */}
      <circle cx={cx + a} cy={cy} r={3.5} fill="rgba(80,170,255,0.9)" />
      <text x={cx + a} y={cy - 10} textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize={7}>
        Ap {Math.round(apogee)} km
      </text>
    </svg>
  );
}

export default function OrbitalElementsPanel({
  elements,
  live,
  onClose,
}: {
  elements: OrbitalElements;
  live: Position;
  onClose: () => void;
}) {
  const row = (
    sym: string,
    label: string,
    value: string,
    bar?: { v: number; max: number },
  ) => (
    <div
      key={sym}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 0",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <span style={{ width: 14, color: "rgba(255,180,60,0.7)", fontSize: 10, fontStyle: "italic", flexShrink: 0 }}>
        {sym}
      </span>
      <span style={{ width: 64, color: "rgba(255,255,255,0.25)", fontSize: 8, letterSpacing: 1, flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ width: 96, color: "rgba(255,255,255,0.75)", fontSize: 10, fontFamily: "monospace", flexShrink: 0 }}>
        {value}
      </span>
      {bar && <Bar value={bar.v} max={bar.max} />}
    </div>
  );

  return (
    <div
      style={{
        fontFamily: "monospace",
        background: "rgba(4,4,12,0.88)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderLeft: "2px solid rgba(255,80,60,0.6)",
        padding: "12px 14px",
        width: 280,
        backdropFilter: "blur(4px)",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={{ color: "#fff", fontSize: 12, fontWeight: "bold", marginBottom: 3 }}>
            {elements.name}
          </div>
          <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 9, letterSpacing: 1 }}>
            {live.latitude.toFixed(2)}° &nbsp;{live.longitude.toFixed(2)}° &nbsp;{live.elevation_km.toFixed(0)} km
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "rgba(255,255,255,0.3)",
            cursor: "pointer",
            fontSize: 14,
            lineHeight: 1,
            padding: 0,
          }}
        >
          ✕
        </button>
      </div>

      {/* Orbit shape */}
      <div style={{ margin: "8px -2px 4px", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 }}>
        <OrbitShape
          e={elements.eccentricity}
          perigee={elements.perigee_altitude_km}
          apogee={elements.apogee_altitude_km}
        />
      </div>

      {/* Keplerian elements */}
      <div style={{ marginTop: 4 }}>
        <div style={{ fontSize: 8, letterSpacing: 3, color: "rgba(255,255,255,0.18)", textTransform: "uppercase", marginBottom: 5 }}>
          Keplerian Elements
        </div>
        {row("a", "Semi-major", `${elements.semi_major_axis_km.toFixed(1)} km`)}
        {row("e", "Eccentricity", elements.eccentricity.toFixed(6), { v: elements.eccentricity, max: 1 })}
        {row("i", "Inclination", `${elements.inclination.toFixed(3)}°`, { v: elements.inclination, max: 180 })}
        {row("Ω", "RAAN", `${elements.raan.toFixed(3)}°`, { v: elements.raan, max: 360 })}
        {row("ω", "Arg. Perigee", `${elements.arg_perigee.toFixed(3)}°`, { v: elements.arg_perigee, max: 360 })}
        {row("M", "Mean Anomaly", `${elements.mean_anomaly.toFixed(3)}°`, { v: elements.mean_anomaly, max: 360 })}
      </div>

      {/* Derived values */}
      <div
        style={{
          marginTop: 10,
          paddingTop: 8,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "8px 16px",
        }}
      >
        {[
          ["PERIOD", `${elements.period_minutes.toFixed(1)} min`],
          ["REV/DAY", (1440 / elements.period_minutes).toFixed(2)],
          ["PERIGEE", `${elements.perigee_altitude_km.toFixed(0)} km`],
          ["APOGEE", `${elements.apogee_altitude_km.toFixed(0)} km`],
        ].map(([label, val]) => (
          <div key={label}>
            <div style={{ fontSize: 7, color: "rgba(255,255,255,0.2)", letterSpacing: 2 }}>{label}</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", marginTop: 2 }}>{val}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
