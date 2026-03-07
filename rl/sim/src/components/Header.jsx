import { useSimulation } from '../context/SimulationContext';


export default function Header() {
  const { state, dispatch, loadEpisode } = useSimulation();
  const { catalog, selectedModelId, selectedEpisode, loading, compareMode, episode } = state;

  const selectedModel = catalog.find(m => m.model_id === selectedModelId);
  const episodes = selectedModel?.episodes || [];

  return (
    <header className="flex items-center gap-4 px-5 py-3 bg-white border-b border-slate-200 shadow-sm z-10">
      {/* Logo */}
      <div className="flex items-center gap-2.5 mr-4">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-emerald-500 flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        </div>
        <div>
          <h1 className="text-sm font-bold text-slate-900 leading-none tracking-tight">CityLearn</h1>
          <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">RL Dashboard</span>
        </div>
      </div>

      {/* Separator */}
      <div className="w-px h-8 bg-slate-200" />

      {/* Model select */}
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Model</label>
        <select
          className="text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 min-w-[200px]"
          value={selectedModelId || ''}
          onChange={e => dispatch({ type: 'SELECT_MODEL', payload: e.target.value })}
        >
          {catalog.map(m => (
            <option key={m.model_id} value={m.model_id}>
              {m.algorithm.toUpperCase()} / {m.reward_variant} / {m.dataset_size} buildings
            </option>
          ))}
        </select>
      </div>

      {/* Episode select */}
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Episode</label>
        <select
          className="text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 min-w-[180px]"
          value={selectedEpisode || ''}
          onChange={e => dispatch({ type: 'SELECT_EPISODE', payload: e.target.value })}
        >
          {episodes.map(ep => (
            <option key={ep} value={ep}>{ep.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>

      {/* Load button */}
      <button
        onClick={loadEpisode}
        disabled={loading || !selectedModelId || !selectedEpisode}
        className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? (
          <>
            <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading…
          </>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Load
          </>
        )}
      </button>

      {/* Model info badge */}
      {selectedModel && (
        <div className="ml-auto flex items-center gap-2">
          {episode && (
            <button
              onClick={() => dispatch({ type: 'TOGGLE_COMPARE' })}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all duration-200 ${
                compareMode
                  ? 'bg-indigo-50 border-indigo-300 text-indigo-700 shadow-sm'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              🔄 Compare
            </button>
          )}
          <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            {selectedModel.algorithm.toUpperCase()}
          </span>
          <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full bg-slate-100 text-slate-600 border border-slate-200">
            {selectedModel.dataset_size} buildings
          </span>
          {selectedModel.checkpoint && (
            <span className="text-[11px] text-slate-400 font-mono">
              {selectedModel.checkpoint.split('/').pop()}
            </span>
          )}
        </div>
      )}
    </header>
  );
}
