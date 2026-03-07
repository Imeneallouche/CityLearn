import { useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts';
import { useSimulation } from '../context/SimulationContext';
import { fmtNum, kpiLabel, kpiColor, kpiBg } from '../lib/format';
import { ENERGY, BUILDING_PALETTE } from '../lib/colors';


function LiveMetric({ emoji, label, value, prevValue, unit, color }) {
  const delta = prevValue != null && value != null ? value - prevValue : null;
  return (
    <div className="flex items-center justify-between py-1.5 px-2 rounded-md bg-white border border-slate-100">
      <span className="flex items-center gap-1.5 text-[11px] text-slate-600">
        <span>{emoji}</span>
        {label}
      </span>
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold tabular-nums" style={{ color }}>
          {value != null ? fmtNum(value, 2) : '—'} <span className="text-[9px] font-normal text-slate-400">{unit}</span>
        </span>
        {delta != null && Math.abs(delta) > 0.001 && (
          <span className={`text-[9px] font-semibold tabular-nums ${delta > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
            {delta > 0 ? '▲' : '▼'}{fmtNum(Math.abs(delta), 2)}
          </span>
        )}
      </div>
    </div>
  );
}

function KPIRow({ label, value }) {
  const colorClass = kpiColor(value);
  const bgClass = kpiBg(value);
  const isBetter = value < 1;
  return (
    <div className={`flex items-center justify-between py-1.5 px-2 rounded-md ${bgClass}`}>
      <span className="flex items-center gap-1 text-xs text-slate-600">
        {isBetter ? '📉' : '📈'}
        {label}
      </span>
      <span className={`text-xs font-bold tabular-nums ${colorClass}`}>
        {fmtNum(value, 3)}
      </span>
    </div>
  );
}

function KPITooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="bg-white/95 backdrop-blur border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <div className="font-semibold text-slate-700">{d?.name}</div>
      <div className="font-mono">{fmtNum(d?.value, 3)}</div>
    </div>
  );
}

export default function KPIPanel() {
  const { state } = useSimulation();
  const { episode, step } = state;
  if (!episode || !episode.kpis) return null;

  const { community } = episode;

  // Live running metrics (recomputed each step)
  const live = useMemo(() => {
    const slice = (arr) => arr.slice(0, step + 1);
    const prevSlice = (arr) => step > 0 ? arr.slice(0, step) : [];
    const sum = (arr) => arr.reduce((a, b) => a + (Number(b) || 0), 0);
    const max = (arr) => arr.length > 0 ? Math.max(...arr) : 0;
    const mean = (arr) => arr.length > 0 ? sum(arr) / arr.length : 0;

    // Ramping: average absolute change between consecutive steps
    const ramping = (arr) => {
      if (arr.length < 2) return 0;
      let total = 0;
      for (let i = 1; i < arr.length; i++) total += Math.abs(arr[i] - arr[i - 1]);
      return total / (arr.length - 1);
    };

    const netSlice = slice(community.net_consumption);
    const prevNetSlice = prevSlice(community.net_consumption);

    return {
      cost: sum(slice(community.price_cost)),
      prevCost: sum(prevSlice(community.price_cost)),
      co2: sum(slice(community.co2)),
      prevCo2: sum(prevSlice(community.co2)),
      peakDemand: max(netSlice),
      prevPeakDemand: max(prevNetSlice),
      avgConsumption: mean(netSlice),
      prevAvgConsumption: mean(prevNetSlice),
      ramping: ramping(netSlice),
      prevRamping: ramping(prevNetSlice),
      selfSufficiency: sum(slice(community.solar_generation)) / Math.max(sum(netSlice.filter(v => v > 0)), 0.01) * 100,
    };
  }, [community, step]);

  // Final normalized KPIs
  const districtKpis = episode.kpis['District'] || {};
  const kpiKeys = Object.keys(districtKpis).filter(k => typeof districtKpis[k] === 'number');

  // Running KPI approximations (converge to final values)
  const runningKpis = useMemo(() => {
    const N = community.net_consumption.length;
    const n = step + 1;
    if (n >= N) return districtKpis;

    const HPD = 24;
    const sum = arr => arr.reduce((a, b) => a + (Number(b) || 0), 0);
    const mx = arr => arr.length ? Math.max(...arr) : 0;
    const mean = arr => arr.length ? sum(arr) / arr.length : 0;

    const net = community.net_consumption.slice(0, n);
    const cost = community.price_cost.slice(0, n);
    const co2A = community.co2.slice(0, n);
    const completeDays = Math.floor(n / HPD);
    const totalDays = Math.floor(N / HPD);

    const cumKpi = (partial, full, fk) => {
      const p = sum(partial), t = sum(full);
      return Math.abs(t) > 1e-6 ? (p / t) * (N / n) * fk : fk;
    };
    const peakKpi = (partial, full, fk) => {
      const p = mx(partial), t = mx(full);
      return Math.abs(t) > 1e-6 ? (p / t) * fk : fk;
    };
    const dailyAgg = (nDays, fn) => {
      const v = [];
      for (let d = 0; d < nDays; d++)
        v.push(fn(community.net_consumption.slice(d * HPD, (d + 1) * HPD)));
      return v;
    };

    const dk = districtKpis;
    const r = {};

    if (dk['cost_total'] != null)
      r['cost_total'] = cumKpi(cost, community.price_cost, dk['cost_total']);
    if (dk['carbon_emissions_total'] != null)
      r['carbon_emissions_total'] = cumKpi(co2A, community.co2, dk['carbon_emissions_total']);
    if (dk['electricity_consumption_total'] != null)
      r['electricity_consumption_total'] = cumKpi(net, community.net_consumption, dk['electricity_consumption_total']);
    if (dk['all_time_peak_average'] != null)
      r['all_time_peak_average'] = peakKpi(net, community.net_consumption, dk['all_time_peak_average']);
    if (dk['daily_peak_average'] != null && completeDays > 0) {
      const pm = mean(dailyAgg(completeDays, mx)), fm = mean(dailyAgg(totalDays, mx));
      r['daily_peak_average'] = Math.abs(fm) > 1e-6 ? (pm / fm) * dk['daily_peak_average'] : dk['daily_peak_average'];
    }
    if (dk['daily_one_minus_load_factor_average'] != null && completeDays > 0) {
      const lf = s => { const pk = mx(s); return pk > 0 ? 1 - sum(s) / (pk * HPD) : 0; };
      const pm = mean(dailyAgg(completeDays, lf)), fm = mean(dailyAgg(totalDays, lf));
      r['daily_one_minus_load_factor_average'] = Math.abs(fm) > 1e-6 ? (pm / fm) * dk['daily_one_minus_load_factor_average'] : dk['daily_one_minus_load_factor_average'];
    }
    if (dk['ramping_average'] != null && net.length >= 2) {
      let rp = 0; for (let i = 1; i < net.length; i++) rp += Math.abs(net[i] - net[i - 1]);
      rp /= net.length - 1;
      let rf = 0; for (let i = 1; i < community.net_consumption.length; i++) rf += Math.abs(community.net_consumption[i] - community.net_consumption[i - 1]);
      rf /= community.net_consumption.length - 1;
      r['ramping_average'] = Math.abs(rf) > 1e-6 ? (rp / rf) * dk['ramping_average'] : dk['ramping_average'];
    }

    // Keys we can't compute stay at final value
    for (const k of Object.keys(dk))
      if (r[k] == null && typeof dk[k] === 'number') r[k] = dk[k];

    return r;
  }, [community, step, districtKpis]);

  const isComplete = step + 1 >= community.net_consumption.length;

  // Per-building comparison
  const buildingAvgs = useMemo(() => {
    return episode.buildings.map((b, i) => {
      const bkpi = episode.kpis[b] || {};
      const vals = Object.values(bkpi).filter(v => typeof v === 'number');
      const avg = vals.length > 0 ? vals.reduce((a, c) => a + c, 0) / vals.length : 0;
      return { name: b.replace('Building_', 'B'), value: avg, color: BUILDING_PALETTE[i % BUILDING_PALETTE.length] };
    });
  }, [episode]);

  return (
    <div className="card">
      <div className="card-header">
        <span>📊</span>
        <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Performance</h3>
      </div>
      <div className="card-body space-y-3">
        {/* Live running metrics */}
        <div className="space-y-1">
          <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mb-1">
            Live Metrics <span className="text-slate-300 font-normal">(up to hour {step + 1})</span>
          </div>
          <LiveMetric emoji="💲" label="Total cost" value={live.cost} prevValue={live.prevCost} unit="$" color={ENERGY.price.main} />
          <LiveMetric emoji="🌿" label="Total CO₂" value={live.co2} prevValue={live.prevCo2} unit="kg" color={ENERGY.carbon.main} />
          <LiveMetric emoji="📈" label="Peak demand" value={live.peakDemand} prevValue={live.prevPeakDemand} unit="kWh" color={ENERGY.consumption.main} />
          <LiveMetric emoji="〰️" label="Avg ramping" value={live.ramping} prevValue={live.prevRamping} unit="kWh" color={ENERGY.grid.main} />
          <LiveMetric emoji="☀️" label="Solar coverage" value={live.selfSufficiency} prevValue={null} unit="%" color={ENERGY.solar.main} />
        </div>

        {/* Normalized KPIs vs baseline (running → final) */}
        <div className="space-y-1">
          <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider mb-1">
            {isComplete ? 'Final' : 'Running'} KPIs <span className="text-slate-300 font-normal">(vs baseline · hour {step + 1})</span>
          </div>
          {kpiKeys.slice(0, 7).map(k => (
            <KPIRow key={k} label={kpiLabel(k)} value={runningKpis[k] ?? districtKpis[k]} />
          ))}
        </div>

        {/* Building comparison bar chart */}
        {buildingAvgs.length > 0 && (
          <div>
            <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mt-1 mb-1">
              Building Avg KPI
            </div>
            <div style={{ height: 90 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={buildingAvgs} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                  <Tooltip content={<KPITooltip />} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {buildingAvgs.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center justify-center gap-4 mt-1">
              <span className="text-[9px] text-emerald-600">{'< 1.0 = better than baseline'}</span>
              <span className="text-[9px] text-red-500">{'> 1.0 = worse'}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
