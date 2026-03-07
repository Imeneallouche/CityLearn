import { useSimulation } from '../context/SimulationContext';
import { fmtTimestamp } from '../lib/format';

const SPEEDS = [200, 100, 50, 20, 5];
const SPEED_LABELS = ['0.5×', '1×', '2×', '5×', '20×'];

export default function PlaybackBar() {
  const { state, dispatch } = useSimulation();
  const { episode, step, playing, speed } = state;
  if (!episode) return null;

  const total = episode.timesteps;
  const pct = total > 1 ? (step / (total - 1)) * 100 : 0;

  const ts = episode.community.timestamps?.[step];

  return (
    <div className="flex items-center gap-4 px-5 py-2.5 bg-white border-t border-slate-200 shadow-[0_-2px_8px_rgba(0,0,0,0.04)]">
      {/* Transport controls */}
      <div className="flex items-center gap-1">
        {/* Skip to start */}
        <button
          onClick={() => { dispatch({ type: 'STOP' }); dispatch({ type: 'SET_STEP', payload: 0 }); }}
          className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
          title="Skip to start"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="19 20 9 12 19 4 19 20" /><line x1="5" y1="19" x2="5" y2="5" />
          </svg>
        </button>

        {/* Step back */}
        <button
          onClick={() => dispatch({ type: 'SET_STEP', payload: step - 1 })}
          className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
          title="Step back"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="19 20 9 12 19 4 19 20" />
          </svg>
        </button>

        {/* Play/Pause */}
        <button
          onClick={() => dispatch({ type: 'TOGGLE_PLAY' })}
          className="p-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          )}
        </button>

        {/* Step forward */}
        <button
          onClick={() => dispatch({ type: 'SET_STEP', payload: step + 1 })}
          className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
          title="Step forward"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5 4 15 12 5 20 5 4" />
          </svg>
        </button>

        {/* Skip to end */}
        <button
          onClick={() => { dispatch({ type: 'STOP' }); dispatch({ type: 'SET_STEP', payload: total - 1 }); }}
          className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
          title="Skip to end"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" />
          </svg>
        </button>
      </div>

      {/* Timestamp */}
      <div className="text-xs text-slate-500 font-mono tabular-nums min-w-[80px]">
        {ts ? fmtTimestamp(ts) : `Step ${step}`}
      </div>

      {/* Scrubber */}
      <div className="flex-1 relative group">
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 rounded-full transition-[width] duration-75"
            style={{ width: `${pct}%` }}
          />
        </div>
        <input
          type="range"
          min={0}
          max={total - 1}
          value={step}
          onChange={e => dispatch({ type: 'SET_STEP', payload: parseInt(e.target.value) })}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
        />
      </div>

      {/* Step counter */}
      <div className="text-xs text-slate-500 font-mono tabular-nums min-w-[120px] text-right">
        Hour {step + 1} <span className="text-slate-300">/</span> {total}
      </div>

      {/* Speed control */}
      <div className="flex items-center gap-1.5 border-l border-slate-200 pl-4">
        <span className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">Speed</span>
        <div className="flex gap-0.5">
          {SPEEDS.map((s, i) => (
            <button
              key={s}
              onClick={() => dispatch({ type: 'SET_SPEED', payload: s })}
              className={`px-2 py-0.5 text-[11px] rounded-md font-medium transition-colors ${
                speed === s
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
              }`}
            >
              {SPEED_LABELS[i]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
