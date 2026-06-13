import { Canvas } from "@react-three/fiber";
import { OrbitControls, Sphere } from "@react-three/drei";

type Position = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  elevation_km: number;
};

function latLonToXYZ(lat: number, lon: number, radius: number) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return {
    x: -radius * Math.sin(phi) * Math.cos(theta),
    y: radius * Math.cos(phi),
    z: radius * Math.sin(phi) * Math.sin(theta),
  };
}

export default function Globe({ positions }: { positions: Position[] }) {
  return (
    <Canvas camera={{ position: [0, 0, 3] }}>
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} />
      <Sphere args={[1, 64, 64]}>
        <meshStandardMaterial color="royalblue" wireframe />
      </Sphere>
      {positions.map((pos) => {
        const { x, y, z } = latLonToXYZ(pos.latitude, pos.longitude, 1.05);
        return (
          <mesh key={pos.id} position={[x, y, z]}>
            <sphereGeometry args={[0.02, 8, 8]} />
            <meshStandardMaterial color="red" />
          </mesh>
        );
      })}
      <OrbitControls />
    </Canvas>
  );
}
