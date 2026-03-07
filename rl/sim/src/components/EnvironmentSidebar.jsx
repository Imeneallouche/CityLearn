import { useMemo, useState } from 'react';
import { useSimulation } from '../context/SimulationContext';
import { fmtNum, fmtKWh, fmtTemp, fmtPct, fmtPrice, fmtTimestamp, sum } from '../lib/format';
import { ENERGY } from '../lib/colors';


function Stat({ label, value, unit, color }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className="text-[12px] font-semibold tabular-nums" style={{ color: color || '#0f172a' }}>
        {value}<span className="text-[10px] font-normal text-slate-400 ml-0.5">{unit}</span>
      </span>
    </div>
  );
}

function Section({ title, icon, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 transition-colors"
      >
        <span className="text-sm">{icon}</span>
        <h3 className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider flex-1">{title}</h3>
        <span className={`text-slate-400 text-[10px] transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>
      {open && <div className="px-3 pb-2.5 space-y-0.5 border-t border-slate-100">{children}</div>}
    </div>
  );
}

function MiniBar({ value, max, color }) {
  const pct = max > 0 ? Math.min(Math.abs(value) / max * 100, 100) : 0;
  return (
    <div className="h-1 w-full bg-slate-100 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-200" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

export default function EnvironmentSidebar() {
  const { state } = useSimulation();
  const { episode, step } = state;
  if (!episode) return null;

  const { community, weather, pricing, carbon_intensity } = episode;

  const cumulative = useMemo(() => ({
    netConsumption: sum(community.net_consumption.slice(0, step + 1)),
    solarGen: sum(community.solar_generation.slice(0, step + 1)),
    co2: sum(community.co2.slice(0, step + 1)),
    cost: sum(community.price_cost.slice(0, step + 1)),
  }), [community, step]);

  const maxNet = useMemo(() => Math.max(...community.net_consumption.map(Math.abs)), [community]);
  const maxSolar = useMemo(() => Math.max(...community.solar_generation.map(Math.abs)), [community]);

  const ts = community.timestamps?.[step];
  const hour = ts ? new Date(ts).getHours() : step % 24;
  const isDaytime = hour >= 6 && hour < 20;

  return (
    <aside className="flex flex-col gap-2.5 p-3 overflow-y-auto border-r border-slate-200 bg-slate-50/50">
      {/* Time — always visible, compact */}
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white border border-slate-200 shadow-sm">
        <span className="text-lg">🕐</span>
        <div className="flex-1 min-w-0">
          <div className="text-lg font-bold tabular-nums text-slate-900 leading-tight">
            {ts ? fmtTimestamp(ts) : `Step ${step}`}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
            {isDaytime ? '☀️' : '🌙'} Hour {hour} · {isDaytime ? 'Day' : 'Night'}
          </div>
        </div>
      </div>

      {/* Weather — collapsed by default */}
      <Section title="Weather" icon="🌤️" defaultOpen={false}>
        <Stat label="Temperature" value={fmtTemp(weather.outdoor_temperature[step])} unit="" color={ENERGY.temperature.main} />
        <Stat label="Humidity" value={fmtPct(weather.outdoor_humidity[step])} unit="" color="#3b82f6" />
        <Stat label="Direct irradiance" value={fmtNum(weather.direct_irradiance[step], 0)} unit=" W/m²" color={ENERGY.solar.main} />
        <Stat label="Diffuse irradiance" value={fmtNum(weather.diffuse_irradiance[step], 0)} unit=" W/m²" color={ENERGY.solar.main} />
      </Section>

      {/* Pricing & Carbon */}
      <Section title="Pricing & Carbon" icon="💲">
        <Stat label="Electricity price" value={fmtPrice(pricing.electricity_price[step])} unit="" color={ENERGY.price.main} />
        {pricing.price_predicted_1 && (
          <Stat label="Predicted +1h" value={fmtPrice(pricing.price_predicted_1[step])} unit="" color="#94a3b8" />
        )}
        <Stat label="Carbon intensity" value={fmtNum(carbon_intensity[step], 3)} unit=" kg/kWh" color={ENERGY.carbon.main} />
      </Section>

      {/* Current step community */}
      <Section title="District (step)" icon="⚡">
        <Stat label="Net consumption" value={fmtKWh(community.net_consumption[step])} unit="" color={community.net_consumption[step] > 0 ? ENERGY.consumption.main : ENERGY.generation.main} />
        <MiniBar value={community.net_consumption[step]} max={maxNet} color={community.net_consumption[step] > 0 ? ENERGY.consumption.main : ENERGY.generation.main} />
        <Stat label="Solar generation" value={fmtKWh(community.solar_generation[step])} unit="" color={ENERGY.solar.main} />
        <MiniBar value={community.solar_generation[step]} max={maxSolar} color={ENERGY.solar.main} />
        <Stat label="CO₂ emissions" value={fmtNum(community.co2[step], 3)} unit=" kg" color={ENERGY.carbon.main} />
        <Stat label="Electricity cost" value={fmtPrice(community.price_cost[step])} unit="" color={ENERGY.price.main} />
      </Section>

      {/* Cumulative — collapsed by default */}
      <Section title="Cumulative" icon="📊" defaultOpen={false}>
        <Stat label="Total consumption" value={fmtKWh(cumulative.netConsumption)} unit="" color={ENERGY.consumption.main} />
        <Stat label="Total solar" value={fmtKWh(cumulative.solarGen)} unit="" color={ENERGY.solar.main} />
        <Stat label="Total CO₂" value={fmtNum(cumulative.co2, 1)} unit=" kg" color={ENERGY.carbon.main} />
        <Stat label="Total cost" value={fmtPrice(cumulative.cost)} unit="" color={ENERGY.price.main} />
      </Section>
    </aside>
  );
}
