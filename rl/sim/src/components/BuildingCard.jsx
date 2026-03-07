import { useSimulation } from '../context/SimulationContext';
import { fmtNum, fmtKWh, fmtTemp } from '../lib/format';
import { ENERGY, BUILDING_PALETTE } from '../lib/colors';


function Gauge({ label, value, max, min = 0, unit, color, icon }) {
  const range = max - min;
  const pct = range > 0 ? Math.max(0, Math.min(100, ((value - min) / range) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-[10px] text-slate-500">
          <span className="text-slate-400">{icon}</span>{label}
        </span>
        <span className="text-[11px] font-semibold tabular-nums" style={{ color }}>
          {fmtNum(value, 1)}{unit}
        </span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-200" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function ActionBar({ label, value, color }) {
  const pctPos = Math.max(0, value) * 50;
  const pctNeg = Math.max(0, -value) * 50;
  // Highlight significant actions
  const isSignificant = Math.abs(value) > 0.4;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-500">{label}</span>
        <span className={`text-[10px] font-mono tabular-nums transition-all duration-300 ${isSignificant ? 'font-bold' : ''}`} style={{ color }}>
          {value > 0 ? '+' : ''}{fmtNum(value, 2)}
        </span>
      </div>
      <div className="relative h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className="absolute left-1/2 top-0 w-px h-full bg-slate-300" />
        {value >= 0 ? (
          <div className={`absolute left-1/2 top-0 h-full rounded-r-full transition-all duration-200 ${isSignificant ? 'action-pulse' : ''}`} style={{ width: `${pctPos}%`, backgroundColor: color }} />
        ) : (
          <div className={`absolute top-0 h-full rounded-l-full transition-all duration-200 ${isSignificant ? 'action-pulse' : ''}`} style={{ right: '50%', width: `${pctNeg}%`, backgroundColor: color }} />
        )}
      </div>
    </div>
  );
}

export default function BuildingCard({ buildingName, index }) {
  const { state, dispatch } = useSimulation();
  const { episode, step, selectedBuilding } = state;
  if (!episode) return null;

  const bd = episode.buildings_data[buildingName];
  if (!bd) return null;

  const color = BUILDING_PALETTE[index % BUILDING_PALETTE.length];
  const isSelected = selectedBuilding === buildingName;

  const netCons = bd.net_consumption?.[step] || 0;
  const soc = bd.battery_soc?.[step] || 0;
  const charge = bd.battery_charge?.[step] || 0;
  const indoorTemp = bd.indoor_temperature?.[step] || 0;
  const coolingDemand = bd.cooling_demand?.[step] || 0;
  const dhwDemand = bd.dhw_demand?.[step] || 0;
  const pvGen = bd.pv_generation?.[step] || 0;
  const nonShift = bd.non_shiftable_load?.[step] || 0;

  const importing = netCons > 0;

  // Detect significant agent action for attention animation
  const maxCharge = Math.max(...(bd.battery_charge || [0]).map(Math.abs), 0.01);
  const chargeNorm = charge / maxCharge;
  const isSignificantAction = Math.abs(chargeNorm) > 0.4;

  return (
    <div
      className={`card cursor-pointer transition-all duration-200 hover:shadow-md ${
        isSelected ? 'ring-2 ring-offset-1' : ''
      } ${isSignificantAction ? 'action-highlight' : ''}`}
      style={isSelected ? { '--tw-ring-color': color } : {}}
      onClick={() => dispatch({ type: 'SELECT_BUILDING', payload: buildingName })}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-xs font-bold text-slate-800">{buildingName.replace('_', ' ')}</span>
        <span className={`ml-auto flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
          importing ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'
        }`}>
          {importing ? '⬇️' : '⬆️'}
          {importing ? 'Import' : 'Export'}
        </span>
      </div>

      <div className="p-3 space-y-2.5">
        {/* Net consumption */}
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] text-slate-500">Net consumption</span>
          <span className="text-lg font-bold tabular-nums" style={{ color: importing ? ENERGY.consumption.main : ENERGY.generation.main }}>
            {fmtKWh(netCons)}
          </span>
        </div>

        {/* Component breakdown */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          <div className="flex items-center gap-1.5 p-1.5 bg-amber-50 rounded-md">
            <span className="shrink-0">☀️</span>
            <div>
              <div className="text-[9px] text-amber-600">PV</div>
              <div className="text-[11px] font-bold text-amber-700 tabular-nums">{fmtNum(pvGen, 2)} kWh</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 p-1.5 bg-slate-50 rounded-md">
            <span className="shrink-0">🏠</span>
            <div>
              <div className="text-[9px] text-slate-500">Base</div>
              <div className="text-[11px] font-bold text-slate-700 tabular-nums">{fmtNum(nonShift, 2)} kWh</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 p-1.5 bg-blue-50 rounded-md">
            <span className="shrink-0">❄️</span>
            <div>
              <div className="text-[9px] text-blue-600">Cool</div>
              <div className="text-[11px] font-bold text-blue-700 tabular-nums">{fmtNum(coolingDemand, 2)} kWh</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 p-1.5 bg-pink-50 rounded-md">
            <span className="shrink-0">💧</span>
            <div>
              <div className="text-[9px] text-pink-600">DHW</div>
              <div className="text-[11px] font-bold text-pink-700 tabular-nums">{fmtNum(dhwDemand, 2)} kWh</div>
            </div>
          </div>
        </div>

        {/* Battery + Temperature gauges */}
        <Gauge label="Battery SOC" value={soc * 100} max={100} unit="%" color={ENERGY.battery.main} icon="🔋" />
        <Gauge label="Indoor Temp" value={indoorTemp} max={35} min={15} unit="°C" color={ENERGY.temperature.main} icon="🌡️" />

        {/* Agent action: battery charge/discharge */}
        <div className="pt-1 border-t border-slate-100">
          <div className="flex items-center gap-1 text-[10px] text-slate-400 font-semibold uppercase tracking-wider mb-1.5">
            Agent Action
            {isSignificantAction && (
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-500 action-pulse" />
            )}
          </div>
          <ActionBar label="Battery" value={chargeNorm} color={charge > 0 ? ENERGY.battery.main : ENERGY.consumption.main} />
        </div>
      </div>
    </div>
  );
}
