import { useSimulation } from '../context/SimulationContext';
import BuildingCard from './BuildingCard';

export default function BuildingGrid() {
  const { state } = useSimulation();
  const { episode } = state;
  if (!episode) return null;

  return (
    <div className={`grid gap-3 ${
      episode.buildings.length <= 3 ? 'grid-cols-3' : 'grid-cols-3 lg:grid-cols-3'
    }`}>
      {episode.buildings.map((bName, i) => (
        <BuildingCard key={bName} buildingName={bName} index={i} />
      ))}
    </div>
  );
}
