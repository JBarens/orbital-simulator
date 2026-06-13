import { useState } from "react";

type AuthFetch = (path: string, options?: RequestInit) => Promise<Response>;

export default function SatellitePanel({
  onAdded,
  authFetch,
}: {
  onAdded?: () => void;
  authFetch: AuthFetch;
}) {
  const [noradID, setNoradID] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchSatellite = async () => {
    if (!noradID) return;
    setLoading(true);
    setStatus("");
    try {
      const tleRes = await fetch(`https://tle.ivanstanojevic.me/api/tle/${noradID}`);
      if (!tleRes.ok) { setStatus("err: NORAD ID not found"); setLoading(false); return; }
      const tle = await tleRes.json();
      if (!tle.line1 || !tle.line2) { setStatus("err: No TLE data"); setLoading(false); return; }

      const saveRes = await authFetch("/satellites/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tle.name, tle_line1: tle.line1, tle_line2: tle.line2 }),
      });
      const saved = await saveRes.json();
      setLoading(false);
      if (saved.detail) { setStatus(`err: ${saved.detail}`); return; }
      setStatus(`+ ${saved.name}`);
      setNoradID("");
      onAdded?.();
    } catch (e) {
      setStatus("err: Network error");
      setLoading(false);
    }
  };

  return (
    <div style={{ fontFamily: "monospace", width: 200 }}>
      <div style={{
        fontSize: 9, letterSpacing: 3, color: "rgba(255,255,255,0.2)",
        textTransform: "uppercase", marginBottom: 8,
      }}>
        Add Object
      </div>
      <input
        value={noradID}
        onChange={(e) => setNoradID(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && fetchSatellite()}
        placeholder="NORAD ID"
        style={{
          width: "100%", background: "rgba(255,255,255,0.04)", border: "none",
          borderBottom: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.7)",
          padding: "6px 0", fontSize: 12, fontFamily: "monospace", outline: "none",
        }}
      />
      <button
        onClick={fetchSatellite}
        disabled={loading}
        style={{
          marginTop: 8, background: "none", border: "1px solid rgba(255,255,255,0.1)",
          color: "rgba(255,255,255,0.35)", fontSize: 10, fontFamily: "monospace",
          letterSpacing: 2, padding: "5px 10px", cursor: "pointer",
          textTransform: "uppercase", width: "100%",
        }}
      >
        {loading ? "..." : "Fetch"}
      </button>
      {status && (
        <div style={{
          marginTop: 8, fontSize: 10, letterSpacing: 1,
          color: status.startsWith("err") ? "rgba(255,80,80,0.7)" : "rgba(80,255,160,0.7)",
        }}>
          {status}
        </div>
      )}
    </div>
  );
}
