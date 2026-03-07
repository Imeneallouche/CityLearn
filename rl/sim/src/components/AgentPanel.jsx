import { useSimulation } from '../context/SimulationContext';
import { fmtNum, fmtKWh } from '../lib/format';
import { ENERGY, BUILDING_PALETTE } from '../lib/colors';


function ActionGauge({ label, value, unit, color, icon }) {
  const isPos = value >= 0;
  const pct = Math.min(Math.abs(value) * 100, 100);
  const isSignificant = Math.abs(value) > 0.4;

  return (
    <div className="flex items-center gap-2">
      <span className="w-5 flex items-center justify-center text-slate-400">{icon}</span>
      <div className="flex-1">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[10px] text-slate-500">{label}</span>
          <span className={`text-[10px] font-mono font-semibold tabular-nums transition-all duration-300 ${isSignificant ? 'font-bold scale-105' : ''}`} style={{ color }}>
            {isPos ? '+' : ''}{fmtNum(value, 3)} {unit}
          </span>
        </div>
        <div className="relative h-2 bg-slate-100 rounded-full">
          <div className="absolute left-1/2 top-0 w-px h-full bg-slate-300 z-10" />
          {isPos ? (
            <div
              className={`absolute left-1/2 top-0 h-full rounded-r-full transition-all duration-150 ${isSignificant ? 'action-pulse' : ''}`}
              style={{ width: `${pct / 2}%`, backgroundColor: color }}
            />
          ) : (
            <div
              className={`absolute top-0 h-full rounded-l-full transition-all duration-150 ${isSignificant ? 'action-pulse' : ''}`}
              style={{ right: '50%', width: `${pct / 2}%`, backgroundColor: color }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* Compact single-line row for non-selected buildings */
function CompactRow({ bName, index, bd, step, isSelected, isSignificant, onClick }) {
  const color = BUILDING_PALETTE[index % BUILDING_PALETTE.length];
  const netCons = bd.net_consumption?.[step] || 0;
  const soc = bd.battery_soc?.[step] || 0;
  const importing = netCons > 0;

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-all duration-200 text-left ${
        isSelected ? 'border-indigo-300 bg-indigo-50/40' : 'border-slate-100 bg-white hover:bg-slate-50'
      } ${isSignificant ? 'action-highlight' : ''}`}
    >
      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="text-[11px] font-semibold text-slate-700 flex-1 truncate">{bName.replace('_', ' ')}</span>
      {/* Mini battery bar */}
      <div className="w-10 h-1.5 bg-slate-100 rounded-full overflow-hidden shrink-0">
        <div className="h-full rounded-full" style={{ width: `${Math.min(soc * 100, 100)}%`, backgroundColor: ENERGY.battery.main }} />
      </div>
      <span className={`text-[9px] font-bold tabular-nums w-14 text-right ${importing ? 'text-red-500' : 'text-emerald-500'}`}>
        {fmtNum(netCons, 1)}
      </span>
      {isSignificant && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 action-pulse shrink-0" />}
    </button>
  );
}

export default function AgentPanel() {
  const { state, dispatch } = useSimulation();
  const { episode, step, selectedBuilding } = state;
  if (!episode) return null;

  const { buildings, buildings_data, algorithm } = episode;

  return (
    <div className="card flex flex-col">
      <div className="card-header">
        <span>🤖</span>
        <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Agent Decisions</h3>
        <span className="ml-auto inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-full bg-indigo-50 text-indigo-600">
          {(algorithm || 'RL').toUpperCase()}
        </span>
      </div>
      <div className="card-body space-y-2 overflow-y-auto flex-1">
        {buildings.map((bName, i) => {
          const bd = buildings_data[bName];
          if (!bd) return null;

          const charge = bd.battery_charge?.[step] || 0;
          const soc = bd.battery_soc?.[step] || 0;
          const netCons = bd.net_consumption?.[step] || 0;
          const pvGen = bd.pv_generation?.[step] || bd.solar_generation?.[step] || 0;
          const cooling = bd.cooling_demand?.[step] || 0;
          const nonShift = bd.non_shiftable_load?.[step] || 0;

          const isSelected = selectedBuilding === bName;
          const color = BUILDING_PALETTE[i % BUILDING_PALETTE.length];

          const maxCharge = Math.max(...(bd.battery_charge || [0]).map(Math.abs), 0.01);
          const chargeNorm = charge / maxCharge;
          const isSignificantAction = Math.abs(chargeNorm) > 0.4;

          // Non-selected buildings: compact row
          if (!isSelected) {
            return (
              <CompactRow
                key={bName}
                bName={bName}
                index={i}
                bd={bd}
                step={step}
                isSelected={false}
                isSignificant={isSignificantAction}
                onClick={() => dispatch({ type: 'SELECT_BUILDING', payload: bName })}
              />
            );
          }

          // Selected building: expanded card
          return (
            <div
              key={bName}
              className={`rounded-lg border border-indigo-300 bg-indigo-50/30 p-2.5 space-y-2 transition-all duration-200 ${isSignificantAction ? 'action-highlight' : ''}`}
            >
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-xs font-bold text-slate-700">{bName.replace('_', ' ')}</span>
                {isSignificantAction && (
                  <span className="ml-auto flex items-center gap-1 text-[9px] font-semibold text-indigo-500">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-500 action-pulse" />
                    Active
                  </span>
                )}
              </div>

              <ActionGauge
                label="Battery charge"
                value={chargeNorm}
                unit={`(${fmtNum(charge, 2)} kWh)`}
                color={charge >= 0 ? ENERGY.battery.main : ENERGY.consumption.main}
                icon="🔋"
              />

              <div className="flex gap-1.5 text-center">
                <div className="flex-1 bg-amber-50 rounded-md py-1">
                  <div className="text-[9px] text-amber-600 flex items-center justify-center gap-0.5">☀️ PV</div>
                  <div className="text-[10px] font-bold text-amber-700">{fmtNum(pvGen, 1)}</div>
                </div>
                <div className="flex-1 bg-blue-50 rounded-md py-1">
                  <div className="text-[9px] text-blue-600 flex items-center justify-center gap-0.5">❄️ Cool</div>
                  <div className="text-[10px] font-bold text-blue-700">{fmtNum(cooling, 1)}</div>
                </div>
                <div className="flex-1 bg-slate-50 rounded-md py-1">
                  <div className="text-[9px] text-slate-500 flex items-center justify-center gap-0.5">🏠 Base</div>
                  <div className="text-[10px] font-bold text-slate-700">{fmtNum(nonShift, 1)}</div>
                </div>
                <div className={`flex-1 rounded-md py-1 ${netCons > 0 ? 'bg-red-50' : 'bg-emerald-50'}`}>
                  <div className={`text-[9px] flex items-center justify-center gap-0.5 ${netCons > 0 ? 'text-red-600' : 'text-emerald-600'}`}>⚡ Net</div>
                  <div className={`text-[10px] font-bold ${netCons > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{fmtNum(netCons, 1)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
