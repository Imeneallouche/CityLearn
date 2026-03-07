import { useState, useMemo } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Legend,
} from 'recharts';
import { useSimulation } from '../context/SimulationContext';
import { fmtNum } from '../lib/format';
import { ENERGY, BUILDING_PALETTE, CHART_GRID, CHART_TEXT } from '../lib/colors';

const TABS = [
  { key: 'community', label: 'Community Energy' },
  { key: 'building', label: 'Building Detail' },
  { key: 'temperature', label: 'Temperature' },
];

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white/95 backdrop-blur border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <div className="font-semibold text-slate-700 mb-1">Step {label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-slate-500">{p.name}:</span>
          <span className="font-mono font-semibold" style={{ color: p.color }}>{fmtNum(p.value, 2)}</span>
        </div>
      ))}
    </div>
  );
}

export default function CommunityCharts() {
  const { state } = useSimulation();
  const { episode, step, selectedBuilding } = state;
  const [activeTab, setActiveTab] = useState('community');

  if (!episode) return null;

  const { community, buildings_data, buildings, weather } = episode;

  // Community chart data
  const communityData = useMemo(() => {
    return community.net_consumption.map((_, i) => ({
      step: i,
      net: community.net_consumption[i],
      solar: community.solar_generation[i],
      co2: community.co2[i],
      cost: community.price_cost[i],
    }));
  }, [community]);

  // Building detail data
  const buildingData = useMemo(() => {
    if (!selectedBuilding || !buildings_data[selectedBuilding]) return [];
    const bd = buildings_data[selectedBuilding];
    return (bd.net_consumption || []).map((_, i) => ({
      step: i,
      net: bd.net_consumption?.[i] || 0,
      pv: bd.pv_generation?.[i] || bd.solar_generation?.[i] || 0,
      battery_soc: (bd.battery_soc?.[i] || 0) * 100,
      charge: bd.battery_charge?.[i] || 0,
      cooling: bd.cooling_demand?.[i] || 0,
      baseload: bd.non_shiftable_load?.[i] || 0,
    }));
  }, [selectedBuilding, buildings_data]);

  // Temperature data
  const tempData = useMemo(() => {
    return (weather.outdoor_temperature || []).map((_, i) => {
      const row = { step: i, outdoor: weather.outdoor_temperature[i] };
      buildings.forEach((b, bi) => {
        row[b] = buildings_data[b]?.indoor_temperature?.[i] || 0;
      });
      return row;
    });
  }, [weather, buildings, buildings_data]);

  // Window for chart view (show last 200 steps or all if less)
  const windowSize = 200;
  const sliceStart = Math.max(0, step - windowSize);
  const sliceEnd = Math.min(communityData.length, step + 50);

  const axisProps = {
    tick: { fontSize: 10, fill: CHART_TEXT },
    tickLine: false,
    axisLine: { stroke: CHART_GRID },
  };

  return (
    <div className="card">
      {/* Tabs */}
      <div className="flex items-center border-b border-slate-100">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-xs font-semibold tracking-wide transition-colors ${
              activeTab === tab.key
                ? 'text-indigo-600 border-b-2 border-indigo-600'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
        {activeTab === 'building' && selectedBuilding && (
          <span className="ml-auto pr-3 text-[10px] text-slate-400">
            Showing: {selectedBuilding.replace('_', ' ')}
          </span>
        )}
      </div>

      <div className="card-body p-2" style={{ height: 240 }}>
        {activeTab === 'community' && (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={communityData.slice(sliceStart, sliceEnd)} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
              <XAxis dataKey="step" {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="solar" name="Solar Gen" stroke={ENERGY.solar.main} fill={ENERGY.solar.light} strokeWidth={1.5} isAnimationActive={false} />
              <Area type="monotone" dataKey="net" name="Net Consumption" stroke={ENERGY.consumption.main} fill={ENERGY.consumption.light} strokeWidth={1.5} isAnimationActive={false} />
              <ReferenceLine x={step} stroke={ENERGY.grid.main} strokeWidth={1.5} strokeDasharray="4 2" />
            </AreaChart>
          </ResponsiveContainer>
        )}

        {activeTab === 'building' && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={buildingData.slice(sliceStart, sliceEnd)} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
              <XAxis dataKey="step" {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="net" name="Net" stroke={ENERGY.consumption.main} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="pv" name="PV Gen" stroke={ENERGY.solar.main} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="battery_soc" name="Battery %" stroke={ENERGY.battery.main} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="charge" name="Batt Charge" stroke={ENERGY.cooling.main} strokeWidth={1} dot={false} strokeDasharray="3 3" isAnimationActive={false} />
              <ReferenceLine x={step} stroke={ENERGY.grid.main} strokeWidth={1.5} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        )}

        {activeTab === 'temperature' && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={tempData.slice(sliceStart, sliceEnd)} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
              <XAxis dataKey="step" {...axisProps} />
              <YAxis domain={['dataMin - 2', 'dataMax + 2']} {...axisProps} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="outdoor" name="Outdoor" stroke="#94a3b8" strokeWidth={2} dot={false} isAnimationActive={false} />
              {buildings.map((b, i) => (
                <Line
                  key={b}
                  type="monotone"
                  dataKey={b}
                  name={b.replace('_', ' ')}
                  stroke={BUILDING_PALETTE[i % BUILDING_PALETTE.length]}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
              <ReferenceLine x={step} stroke={ENERGY.grid.main} strokeWidth={1.5} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
