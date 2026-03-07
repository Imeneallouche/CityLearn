import { createContext, useContext, useReducer, useCallback, useRef, useEffect } from 'react';
import { fetchCatalog, fetchEpisode, fetchBaseline, fetchComparison } from '../api/client';

const Ctx = createContext(null);

const initial = {
  catalog: [],
  selectedModelId: null,
  selectedEpisode: null,
  episode: null,         // loaded episode data
  step: 0,
  playing: false,
  speed: 100,            // ms per step
  loading: false,
  error: null,
  selectedBuilding: null,
  // Comparison state
  compareMode: false,
  compareBaseline: null,       // 'baseline' | 'rbc' | null
  baselineData: null,          // loaded baseline episode
  baselineLoading: false,
  comparisonData: null,        // cross-model KPI comparison
  compareAgentId: null,        // model_id of second agent for agent-vs-agent
  compareAgentData: null,      // loaded second agent episode
  compareAgentLoading: false,
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_CATALOG':
      return { ...state, catalog: action.payload };
    case 'SELECT_MODEL':
      return { ...state, selectedModelId: action.payload, selectedEpisode: null, episode: null, step: 0, baselineData: null, comparisonData: null, compareAgentId: null, compareAgentData: null };
    case 'SELECT_EPISODE':
      return { ...state, selectedEpisode: action.payload };
    case 'LOAD_START':
      return { ...state, loading: true, error: null };
    case 'LOAD_SUCCESS':
      return { ...state, loading: false, episode: action.payload, step: 0, selectedBuilding: action.payload.buildings[0] };
    case 'LOAD_ERROR':
      return { ...state, loading: false, error: action.payload };
    case 'SET_STEP':
      return { ...state, step: Math.max(0, Math.min(action.payload, (state.episode?.timesteps || 1) - 1)) };
    case 'TOGGLE_PLAY':
      return { ...state, playing: !state.playing };
    case 'STOP':
      return { ...state, playing: false };
    case 'SET_SPEED':
      return { ...state, speed: action.payload };
    case 'SELECT_BUILDING':
      return { ...state, selectedBuilding: action.payload };
    case 'TOGGLE_COMPARE':
      return { ...state, compareMode: !state.compareMode };
    case 'SET_COMPARE_BASELINE':
      return { ...state, compareBaseline: action.payload, baselineData: null };
    case 'BASELINE_LOADING':
      return { ...state, baselineLoading: true };
    case 'BASELINE_LOADED':
      return { ...state, baselineLoading: false, baselineData: action.payload };
    case 'BASELINE_ERROR':
      return { ...state, baselineLoading: false, error: action.payload };
    case 'COMPARISON_LOADED':
      return { ...state, comparisonData: action.payload };
    case 'SET_COMPARE_AGENT':
      return { ...state, compareAgentId: action.payload, compareAgentData: null };
    case 'COMPARE_AGENT_LOADING':
      return { ...state, compareAgentLoading: true };
    case 'COMPARE_AGENT_LOADED':
      return { ...state, compareAgentLoading: false, compareAgentData: action.payload };
    case 'COMPARE_AGENT_ERROR':
      return { ...state, compareAgentLoading: false, error: action.payload };
    default:
      return state;
  }
}

export function SimulationProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const timerRef = useRef(null);

  // Boot: load catalog
  useEffect(() => {
    fetchCatalog()
      .then(data => {
        dispatch({ type: 'SET_CATALOG', payload: data.models });
        if (data.models.length > 0) {
          dispatch({ type: 'SELECT_MODEL', payload: data.models[0].model_id });
          const first = data.models[0];
          if (first.episodes.length > 0) {
            dispatch({ type: 'SELECT_EPISODE', payload: first.episodes[first.episodes.length - 1] });
          }
        }
      })
      .catch(err => dispatch({ type: 'LOAD_ERROR', payload: err.message }));
  }, []);

  // Playback timer
  useEffect(() => {
    if (state.playing && state.episode) {
      timerRef.current = setInterval(() => {
        dispatch({ type: 'SET_STEP', payload: state.step + 1 });
      }, state.speed);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state.playing, state.speed, state.step, state.episode]);

  // Stop at end
  useEffect(() => {
    if (state.episode && state.step >= state.episode.timesteps - 1 && state.playing) {
      dispatch({ type: 'STOP' });
    }
  }, [state.step, state.episode, state.playing]);

  const loadEpisode = useCallback(async () => {
    if (!state.selectedModelId || !state.selectedEpisode) return;
    dispatch({ type: 'LOAD_START' });
    try {
      const data = await fetchEpisode(state.selectedModelId, state.selectedEpisode);
      dispatch({ type: 'LOAD_SUCCESS', payload: data });
    } catch (err) {
      dispatch({ type: 'LOAD_ERROR', payload: err.message });
    }
  }, [state.selectedModelId, state.selectedEpisode]);

  const loadBaseline = useCallback(async (agentType) => {
    if (!state.episode) return;
    dispatch({ type: 'SET_COMPARE_BASELINE', payload: agentType });
    dispatch({ type: 'BASELINE_LOADING' });
    try {
      const data = await fetchBaseline(String(state.episode.dataset_size), agentType);
      dispatch({ type: 'BASELINE_LOADED', payload: data });
    } catch (err) {
      dispatch({ type: 'BASELINE_ERROR', payload: err.message });
    }
  }, [state.episode]);

  const loadComparison = useCallback(async () => {
    if (!state.episode) return;
    try {
      const data = await fetchComparison(String(state.episode.dataset_size));
      dispatch({ type: 'COMPARISON_LOADED', payload: data });
    } catch (err) {
      // Non-critical — silently fail
    }
  }, [state.episode]);

  const loadCompareAgent = useCallback(async (modelId) => {
    if (!modelId || !state.episode) return;
    dispatch({ type: 'SET_COMPARE_AGENT', payload: modelId });
    dispatch({ type: 'COMPARE_AGENT_LOADING' });
    try {
      const model = state.catalog.find(m => m.model_id === modelId);
      if (!model || !model.episodes.length) throw new Error('No episodes for model');
      const ep = model.episodes[model.episodes.length - 1];
      const data = await fetchEpisode(modelId, ep);
      dispatch({ type: 'COMPARE_AGENT_LOADED', payload: data });
    } catch (err) {
      dispatch({ type: 'COMPARE_AGENT_ERROR', payload: err.message });
    }
  }, [state.episode, state.catalog]);

  return (
    <Ctx.Provider value={{ state, dispatch, loadEpisode, loadBaseline, loadComparison, loadCompareAgent }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSimulation() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSimulation must be used within SimulationProvider');
  return ctx;
}
