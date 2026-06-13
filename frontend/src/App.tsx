import { useEffect, useState } from "react";
import Globe from "./Globe";
import SatellitePanel from "./SatellitePanel";

type Position = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  elevation_km: number;
};

function App() {
  const [positions, setPositions] = useState<Position[]>([]);

  useEffect(() => {
    const fetch_positions = async () => {
      const res = await fetch("http://localhost:8000/satellites/positions");
      const data = await res.json();
      setPositions(data);
    };

    fetch_positions();
    const interval = setInterval(fetch_positions, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <SatellitePanel />
      <Globe positions={positions} />
    </div>
  );
}

export default App;
