import { useMemo } from 'react';
import { useSimulation } from '../context/SimulationContext';
import { fmtKWh, fmtNum } from '../lib/format';
import { ENERGY, BUILDING_PALETTE } from '../lib/colors';


/* Animated flow line between two points */
function FlowLine({ x1, y1, x2, y2, value, maxVal, color, reverse = false }) {
  const absVal = Math.abs(value);
  const thickness = maxVal > 0 ? Math.max(1.5, (absVal / maxVal) * 6) : 1.5;
  const opacity = maxVal > 0 ? Math.max(0.15, absVal / maxVal) : 0.15;
  const direction = reverse ? 'reverse' : 'normal';

  return (
    <g>
      {/* Background track */}
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={thickness + 2} strokeOpacity={0.08} strokeLinecap="round" />
      {/* Animated flow */}
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={color}
        strokeWidth={thickness}
        strokeOpacity={opacity}
        strokeDasharray="6 4"
        strokeLinecap="round"
      >
        <animate attributeName="stroke-dashoffset" from="0" to={reverse ? "20" : "-20"} dur="1s" repeatCount="indefinite" />
      </line>
    </g>
  );
}

const NODE_EMOJIS = { plug: '🔌', sun: '☀️', battery: '🔋' };

/* Node box in the diagram */
function NodeBox({ x, y, w, h, label, sublabel, iconType, bgColor, borderColor, textColor }) {
  const emoji = iconType && NODE_EMOJIS[iconType];
  return (
    <g>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={8} fill={bgColor} stroke={borderColor} strokeWidth={1.5} />
      {emoji && <text x={x - 22} y={y + 1} textAnchor="middle" fontSize={13}>{emoji}</text>}
      <text x={x + (emoji ? 4 : 0)} y={y - 4} textAnchor="middle" fill={textColor} fontSize={11} fontWeight={700}>{label}</text>
      {sublabel && <text x={x} y={y + 11} textAnchor="middle" fill={textColor} fontSize={9} fontWeight={500} opacity={0.7}>{sublabel}</text>}
    </g>
  );
}

/* Building node with battery gauge */
function BuildingNode({ x, y, name, netCons, batterySoc, pvGen, color, isSelected, onClick }) {
  const importing = netCons > 0;
  const w = 90, h = 70;

  return (
    <g className="cursor-pointer" onClick={onClick}>
      {/* Selection highlight */}
      {isSelected && <rect x={x - w / 2 - 3} y={y - h / 2 - 3} width={w + 6} height={h + 6} rx={11} fill="none" stroke={color} strokeWidth={2} strokeDasharray="4 2" opacity={0.5} />}

      {/* Card */}
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={8} fill="white" stroke={color} strokeWidth={1.5} />

      {/* Building icon + name */}
      <text x={x} y={y - 20} textAnchor="middle" fill={color} fontSize={10} fontWeight={700}>{name.replace('Building_', 'B')}</text>

      {/* Battery gauge bar */}
      <rect x={x - 30} y={y - 8} width={60} height={6} rx={3} fill="#f1f5f9" />
      <rect x={x - 30} y={y - 8} width={Math.max(0, Math.min(60, 60 * (batterySoc || 0)))} height={6} rx={3} fill={ENERGY.battery.main} />
      <text x={x} y={y + 8} textAnchor="middle" fill="#64748b" fontSize={8}>{fmtNum((batterySoc || 0) * 100, 0)}%</text>

      {/* Net consumption */}
      <text x={x} y={y + 22} textAnchor="middle" fill={importing ? ENERGY.consumption.main : ENERGY.generation.main} fontSize={9} fontWeight={600}>
        {importing ? '↓' : '↑'} {fmtNum(Math.abs(netCons), 2)} kWh
      </text>
    </g>
  );
}

export default function EnergyFlow() {
  const { state, dispatch } = useSimulation();
  const { episode, step, selectedBuilding } = state;
  if (!episode) return null;

  const { community, buildings_data, buildings } = episode;
  const n = buildings.length;

  // Current step values
  const netCommunity = community.net_consumption[step] || 0;
  const solarTotal = community.solar_generation[step] || 0;
  const importing = netCommunity > 0;

  // Compute max values for scaling flow lines
  const maxCommunityNet = useMemo(() => Math.max(...community.net_consumption.map(Math.abs), 1), [community]);
  const maxSolar = useMemo(() => Math.max(...community.solar_generation, 1), [community]);
  const maxBuildingNet = useMemo(() => {
    let m = 1;
    for (const b of buildings) {
      const bd = buildings_data[b];
      if (bd?.net_consumption) m = Math.max(m, ...bd.net_consumption.map(Math.abs));
    }
    return m;
  }, [buildings, buildings_data]);

  // SVG dimensions
  const svgW = 800;
  const svgH = 240;
  const busY = 100;
  const buildingY = 200;
  const solarPos = { x: svgW / 2, y: 30 };
  const gridPos = { x: 60, y: busY };
  const busStartX = 130;
  const busEndX = svgW - 30;

  // Building positions
  const buildingSpacing = (busEndX - busStartX) / (n + 1);
  const buildingPositions = buildings.map((_, i) => ({
    x: busStartX + buildingSpacing * (i + 1),
    y: buildingY,
  }));

  return (
    <div className="card">
      <div className="card-header">
        <span>⚡</span>
        <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">District Energy Flow</h3>
        <span className="ml-auto text-[10px] text-slate-400">
          {importing ? 'Importing from grid' : 'Exporting to grid'} · {fmtKWh(Math.abs(netCommunity))}
        </span>
      </div>
      <div className="card-body p-0">
        <svg viewBox={`0 0 ${svgW} ${svgH + 10}`} className="w-full" style={{ minHeight: 200 }}>
          <defs>
            <linearGradient id="busGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={ENERGY.grid.main} stopOpacity={0.1} />
              <stop offset="50%" stopColor={ENERGY.grid.main} stopOpacity={0.2} />
              <stop offset="100%" stopColor={ENERGY.grid.main} stopOpacity={0.1} />
            </linearGradient>
          </defs>

          {/* District bus bar */}
          <rect x={busStartX} y={busY - 12} width={busEndX - busStartX} height={24} rx={12} fill="url(#busGradient)" stroke={ENERGY.grid.main} strokeWidth={1} strokeOpacity={0.3} />
          <text x={(busStartX + busEndX) / 2} y={busY + 4} textAnchor="middle" fill={ENERGY.grid.main} fontSize={10} fontWeight={600} opacity={0.6}>
            District Bus
          </text>

          {/* Grid node */}
          <NodeBox
            x={gridPos.x} y={gridPos.y} w={80} h={44}
            label="Grid" sublabel={fmtKWh(Math.abs(netCommunity))}
            iconType="plug"
            bgColor={importing ? '#eef2ff' : '#ecfdf5'}
            borderColor={importing ? ENERGY.grid.main : ENERGY.generation.main}
            textColor={importing ? ENERGY.grid.main : ENERGY.generation.main}
          />

          {/* Grid ↔ Bus flow */}
          <FlowLine
            x1={gridPos.x + 40} y1={busY}
            x2={busStartX} y2={busY}
            value={netCommunity} maxVal={maxCommunityNet}
            color={importing ? ENERGY.grid.main : ENERGY.generation.main}
            reverse={!importing}
          />

          {/* Solar node */}
          <NodeBox
            x={solarPos.x} y={solarPos.y} w={90} h={36}
            label="Solar" sublabel={fmtKWh(solarTotal)}
            iconType="sun"
            bgColor="#fffbeb" borderColor={ENERGY.solar.main} textColor={ENERGY.solar.dark}
          />

          {/* Solar → Bus flow */}
          <FlowLine
            x1={solarPos.x} y1={solarPos.y + 18}
            x2={solarPos.x} y2={busY - 12}
            value={solarTotal} maxVal={maxSolar}
            color={ENERGY.solar.main}
          />

          {/* Building nodes + flow lines */}
          {buildings.map((bName, i) => {
            const bd = buildings_data[bName];
            const pos = buildingPositions[i];
            const netCons = bd?.net_consumption?.[step] || 0;
            const soc = bd?.battery_soc?.[step] || 0;
            const pvGen = bd?.pv_generation?.[step] || 0;

            return (
              <g key={bName}>
                {/* Bus → Building flow */}
                <FlowLine
                  x1={pos.x} y1={busY + 12}
                  x2={pos.x} y2={pos.y - 35}
                  value={netCons} maxVal={maxBuildingNet}
                  color={netCons > 0 ? ENERGY.consumption.main : ENERGY.generation.main}
                  reverse={netCons < 0}
                />
                <BuildingNode
                  x={pos.x} y={pos.y}
                  name={bName}
                  netCons={netCons}
                  batterySoc={soc}
                  pvGen={pvGen}
                  color={BUILDING_PALETTE[i % BUILDING_PALETTE.length]}
                  isSelected={selectedBuilding === bName}
                  onClick={() => dispatch({ type: 'SELECT_BUILDING', payload: bName })}
                />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
