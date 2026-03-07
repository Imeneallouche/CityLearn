import { useEffect, useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  Cell, Legend, LineChart, Line, ReferenceLine,
} from 'recharts';
import { useSimulation } from '../context/SimulationContext';
import { fmtNum, kpiLabel } from '../lib/format';
import { ENERGY, BUILDING_PALETTE } from '../lib/colors';

const BASELINE_TYPES = [
  { key: 'baseline', label: 'Baseline (No-Op)', emoji: '🎯', description: 'CityLearn BaselineAgent — empty actions' },
  { key: 'rbc', label: 'Rule-Based Controller', emoji: '🖥️', description: 'CityLearn BasicRBC — hour-based rules' },
];

const KPI_ORDER = [
  'cost_total', 'carbon_emissions_total', 'annual_normalized_unserved_energy_total',
  'daily_peak_average', 'daily_one_minus_load_factor_average',
  'all_time_peak_average', 'ramping_average',
];

function ComparisonTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white/95 backdrop-blur border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs space-y-1">
      <div className="font-semibold text-slate-700">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-slate-500">{p.name}:</span>
          <span className="font-mono font-semibold" style={{ color: p.color }}>{fmtNum(p.value, 3)}</span>
        </div>
      ))}
    </div>
  );
}

function BaselineSelector({ selected, onSelect, loading }) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Compare Against</div>
      <div className="flex gap-2">
        {BASELINE_TYPES.map(({ key, label, emoji, description }) => {
          const isActive = selected === key;
          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              disabled={loading}
              className={`flex-1 flex items-center gap-2 p-2.5 rounded-lg border text-left transition-all duration-200 ${
                isActive
                  ? 'border-indigo-300 bg-indigo-50 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
              } ${loading ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
            >
              <span>{emoji}</span>
              <div>
                <div className={`text-xs font-semibold ${isActive ? 'text-indigo-700' : 'text-slate-700'}`}>{label}</div>
                <div className="text-[9px] text-slate-400 mt-0.5">{description}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function KPIComparisonChart({ currentKpis, baselineKpis, currentLabel, baselineLabel }) {
  const data = useMemo(() => {
    if (!currentKpis || !baselineKpis) return [];
    const distCurrent = currentKpis['District'] || {};
    const distBaseline = baselineKpis['District'] || {};

    return KPI_ORDER
      .filter(k => distCurrent[k] !== undefined || distBaseline[k] !== undefined)
      .map(k => ({
        name: kpiLabel(k),
        current: distCurrent[k] || 0,
        baseline: distBaseline[k] || 0,
      }));
  }, [currentKpis, baselineKpis]);

  if (data.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
        District KPI Comparison
      </div>
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 5, left: -10, bottom: 0 }} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} angle={-20} textAnchor="end" height={50} />
            <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
            <Tooltip content={<ComparisonTooltip />} />
            <ReferenceLine y={1} stroke="#94a3b8" strokeDasharray="3 3" label={{ value: 'baseline=1', position: 'right', fontSize: 9, fill: '#94a3b8' }} />
            <Bar dataKey="current" name={currentLabel} fill={ENERGY.grid.main} radius={[3, 3, 0, 0]} barSize={18} />
            <Bar dataKey="baseline" name={baselineLabel} fill="#94a3b8" radius={[3, 3, 0, 0]} barSize={18} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function CrossModelChart({ comparisonData }) {
  if (!comparisonData?.models?.length) return null;

  const data = useMemo(() => {
    const kpiKeys = KPI_ORDER.filter(k => {
      return comparisonData.models.some(m => {
        const d = m.kpis?.['District'] || {};
        return d[k] !== undefined;
      });
    });

    return kpiKeys.map(k => {
      const row = { name: kpiLabel(k) };
      comparisonData.models.forEach((m) => {
        const d = m.kpis?.['District'] || {};
        row[m.model_id] = d[k] || 0;
      });
      return row;
    });
  }, [comparisonData]);

  const modelColors = useMemo(() => {
    const colors = {};
    comparisonData.models.forEach((m, i) => {
      colors[m.model_id] = BUILDING_PALETTE[i % BUILDING_PALETTE.length];
    });
    return colors;
  }, [comparisonData]);

  if (data.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">
        Cross-Model Comparison ({comparisonData.dataset_size} buildings)
      </div>
      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 5, left: -10, bottom: 30 }} barGap={1}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} angle={-20} textAnchor="end" height={50} />
            <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
            <Tooltip content={<ComparisonTooltip />} />
            <ReferenceLine y={1} stroke="#94a3b8" strokeDasharray="3 3" />
            {comparisonData.models.map((m) => (
              <Bar
                key={m.model_id}
                dataKey={m.model_id}
                name={`${m.algorithm.toUpperCase()}/${m.reward_variant}`}
                fill={modelColors[m.model_id]}
                radius={[2, 2, 0, 0]}
                barSize={14}
              />
            ))}
            <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} verticalAlign="bottom" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function TimeseriesOverlay({ episode, baselineData, step }) {
  if (!baselineData || !episode) return null;

  const chartData = useMemo(() => {
    const len = Math.min(episode.timesteps, baselineData.timesteps || 0);
    const data = [];
    for (let i = 0; i < len; i++) {
      data.push({
        step: i,
        agent: episode.community.net_consumption[i] || 0,
        baseline: baselineData.community.net_consumption[i] || 0,
      });
    }
    return data;
  }, [episode, baselineData]);

  return (
    <div className="space-y-2">
      <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
        Net Consumption: Agent vs Baseline
      </div>
      <div style={{ height: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="step" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
            <Tooltip content={<ComparisonTooltip />} />
            <ReferenceLine x={step} stroke={ENERGY.grid.main} strokeWidth={1.5} strokeDasharray="4 4" />
            <Line type="monotone" dataKey="agent" name="RL Agent" stroke={ENERGY.grid.main} strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="baseline" name="Baseline" stroke="#94a3b8" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
            <Legend wrapperStyle={{ fontSize: 10 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function AgentSelector({ catalog, currentModelId, episode, selectedAgentId, onSelect, loading }) {
  const sameSchemaModels = useMemo(() =>
    catalog.filter(m => m.model_id !== currentModelId && String(m.dataset_size) === String(episode?.dataset_size)),
    [catalog, currentModelId, episode]
  );
  if (sameSchemaModels.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Agent vs Agent</div>
      <div className="flex gap-2">
        <select
          value={selectedAgentId || ''}
          onChange={e => onSelect(e.target.value || null)}
          disabled={loading}
          className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
        >
          <option value="">Select a model to compare…</option>
          {sameSchemaModels.map(m => (
            <option key={m.model_id} value={m.model_id}>
              {m.algorithm.toUpperCase()} / {m.reward_variant} / {m.dataset_size}b
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function AgentVsAgentChart({ episode, compareAgentData, step }) {
  if (!compareAgentData || !episode) return null;

  const labelA = `${(episode.algorithm || 'RL').toUpperCase()}/${episode.reward_variant || ''}`;
  const labelB = `${(compareAgentData.algorithm || 'RL').toUpperCase()}/${compareAgentData.reward_variant || ''}`;

  const chartData = useMemo(() => {
    const len = Math.min(episode.timesteps, compareAgentData.timesteps || 0);
    const data = [];
    for (let i = 0; i < len; i++) {
      data.push({
        step: i,
        agentA: episode.community.net_consumption[i] || 0,
        agentB: compareAgentData.community.net_consumption[i] || 0,
      });
    }
    return data;
  }, [episode, compareAgentData]);

  // KPI comparison table
  const kpiData = useMemo(() => {
    const kpisA = episode.kpis?.['District'] || {};
    const kpisB = compareAgentData.kpis?.['District'] || {};
    return KPI_ORDER
      .filter(k => kpisA[k] !== undefined || kpisB[k] !== undefined)
      .map(k => ({
        key: k,
        label: kpiLabel(k),
        a: kpisA[k],
        b: kpisB[k],
        diff: kpisA[k] != null && kpisB[k] != null ? kpisA[k] - kpisB[k] : null,
      }));
  }, [episode, compareAgentData]);

  return (
    <>
      <div className="space-y-2">
        <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
          Net Consumption: {labelA} vs {labelB}
        </div>
        <div style={{ height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="step" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
              <Tooltip content={<ComparisonTooltip />} />
              <ReferenceLine x={step} stroke={ENERGY.grid.main} strokeWidth={1.5} strokeDasharray="4 4" />
              <Line type="monotone" dataKey="agentA" name={labelA} stroke={ENERGY.grid.main} strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="agentB" name={labelB} stroke={ENERGY.solar.main} strokeWidth={1.5} dot={false} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {kpiData.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
            KPI: {labelA} vs {labelB}
          </div>
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 overflow-hidden">
            {kpiData.map(({ key, label, a, b, diff }) => {
              const isBetter = diff !== null && diff < 0;
              return (
                <div key={key} className="flex items-center justify-between px-3 py-1.5 text-xs bg-white">
                  <span className="text-slate-600">{label}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono tabular-nums" style={{ color: ENERGY.grid.main }}>
                      {a != null ? fmtNum(a, 3) : '—'}
                    </span>
                    <span className="text-slate-300">/</span>
                    <span className="font-mono tabular-nums" style={{ color: ENERGY.solar.main }}>
                      {b != null ? fmtNum(b, 3) : '—'}
                    </span>
                    {diff !== null && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${isBetter ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                        {isBetter ? '' : '+'}{fmtNum(diff, 3)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

export default function ComparisonPanel() {
  const { state, dispatch, loadBaseline, loadComparison, loadCompareAgent } = useSimulation();
  const { episode, step, compareBaseline, baselineData, baselineLoading, comparisonData,
          compareAgentId, compareAgentData, compareAgentLoading, catalog, selectedModelId } = state;

  // Auto-load cross-model comparison when panel opens
  useEffect(() => {
    if (episode && !comparisonData) {
      loadComparison();
    }
  }, [episode, comparisonData, loadComparison]);

  if (!episode) return null;

  const currentLabel = `${(episode.algorithm || 'RL').toUpperCase()}/${episode.reward_variant || ''}`;
  const baselineLabel = compareBaseline === 'rbc' ? 'BasicRBC' : compareBaseline === 'baseline' ? 'BaselineAgent' : 'Baseline';

  return (
    <div className="compare-enter space-y-4">
      {/* Baseline selector */}
      <BaselineSelector
        selected={compareBaseline}
        onSelect={loadBaseline}
        loading={baselineLoading}
      />

      {/* Loading indicator */}
      {baselineLoading && (
        <div className="flex items-center justify-center gap-2 py-4 text-indigo-600 text-xs">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Running baseline simulation...
        </div>
      )}

      {/* KPI comparison: agent vs baseline */}
      {baselineData && (
        <>
          <KPIComparisonChart
            currentKpis={episode.kpis}
            baselineKpis={baselineData.kpis}
            currentLabel={currentLabel}
            baselineLabel={baselineLabel}
          />
          <TimeseriesOverlay episode={episode} baselineData={baselineData} step={step} />
        </>
      )}

      {/* Cross-model comparison */}
      <CrossModelChart comparisonData={comparisonData} />

      {/* Agent vs Agent */}
      <AgentSelector
        catalog={catalog}
        currentModelId={selectedModelId}
        episode={episode}
        selectedAgentId={compareAgentId}
        onSelect={loadCompareAgent}
        loading={compareAgentLoading}
      />
      {compareAgentLoading && (
        <div className="flex items-center justify-center gap-2 py-3 text-indigo-600 text-xs">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading agent data…
        </div>
      )}
      {compareAgentData && <AgentVsAgentChart episode={episode} compareAgentData={compareAgentData} step={step} />}

      {/* Summary table */}
      {baselineData && episode.kpis && (
        <div className="space-y-1">
          <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
            Summary: {currentLabel} vs {baselineLabel}
          </div>
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 overflow-hidden">
            {KPI_ORDER.map(k => {
              const current = episode.kpis?.['District']?.[k];
              const baseline = baselineData.kpis?.['District']?.[k];
              if (current === undefined && baseline === undefined) return null;
              const diff = current !== undefined && baseline !== undefined ? current - baseline : null;
              const isBetter = diff !== null && diff < 0;
              return (
                <div key={k} className="flex items-center justify-between px-3 py-1.5 text-xs bg-white">
                  <span className="text-slate-600 flex items-center gap-1.5">
                    {diff !== null && (isBetter ? '📉' : '📈')}
                    {kpiLabel(k)}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="font-mono tabular-nums" style={{ color: ENERGY.grid.main }}>
                      {current !== undefined ? fmtNum(current, 3) : '—'}
                    </span>
                    <span className="text-slate-300">/</span>
                    <span className="font-mono tabular-nums text-slate-400">
                      {baseline !== undefined ? fmtNum(baseline, 3) : '—'}
                    </span>
                    {diff !== null && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${isBetter ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                        {isBetter ? '' : '+'}{fmtNum(diff, 3)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
