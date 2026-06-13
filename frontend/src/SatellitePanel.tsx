import { useState } from "react";

export default function SatellitePanel() {
  const [noradID, setNoradID] = useState("");
  const [status, setStatus] = useState("");

  const fetchSatellite = async () => {
    const red = await fetch(
      `http://localhost:8000/satellites/fetch/${noradID}`,
      { method: "POST" },
    );
    const data = await red.json();
    if (data.error) {
      setStatus(`Error: ${data.error}`);
    } else {
      setStatus(`Added: ${data.name}`);
    }
  };

  return (
    <div>
      <input
        type="text"
        value={noradID}
        onChange={(e) => setNoradID(e.target.value)}
        placeholder="NORAD ID"
      />
      <button onClick={fetchSatellite}>Fetch Satellite</button>
      <p>{status}</p>
    </div>
  );
}
