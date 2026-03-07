import { useState } from 'react';
import { useSimulation } from '../context/SimulationContext';
import Header from './Header';
import EnvironmentSidebar from './EnvironmentSidebar';
import EnergyFlow from './EnergyFlow';
import BuildingGrid from './BuildingGrid';
import CommunityCharts from './CommunityCharts';
import AgentPanel from './AgentPanel';
import KPIPanel from './KPIPanel';
import PlaybackBar from './PlaybackBar';
import ComparisonPanel from './ComparisonPanel';
import ChatPanel from './ChatPanel';

export default function Layout() {
  const { state } = useSimulation();
  const hasData = !!state.episode;
  const { compareMode } = state;

  // chatMode: null (closed), 'popup', 'fullscreen'
  const [chatMode, setChatMode] = useState(null);

  const openChat = (mode) => setChatMode(mode || null);
  const closeChat = () => setChatMode(null);
  const toggleMode = () => setChatMode(prev => {
    if (!prev) return 'popup';          // closed -> popup (from floating button)
    if (prev === 'popup') return 'fullscreen';
    return 'popup';                      // fullscreen -> popup
  });

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-900 overflow-hidden">
      <Header chatMode={chatMode} onOpenChat={openChat} />

      {/* Chat panel (popup floats over content, fullscreen replaces it) */}
      <ChatPanel mode={chatMode} onClose={closeChat} onToggleMode={toggleMode} />

      {chatMode === 'fullscreen' ? null : !hasData ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md space-y-4">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-indigo-100 flex items-center justify-center">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-slate-800">CityLearn RL Inference and Simulation Engine</h2>
            <p className="text-slate-500 text-sm leading-relaxed">
              Select a trained model and episode above, then click <strong>Load</strong> to visualize the RL agent's energy management decisions across a multi-building district.
            </p>
            {state.error && (
              <p className="text-red-600 text-sm bg-red-50 rounded-lg px-4 py-2">{state.error}</p>
            )}
            {state.loading && (
              <div className="flex items-center justify-center gap-2 text-indigo-600 text-sm">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Loading episode data…
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className={`flex-1 grid ${compareMode ? 'grid-cols-[300px_1fr_460px]' : 'grid-cols-[300px_1fr_370px]'} gap-0 overflow-hidden transition-all duration-300`}>
            {/* Left sidebar */}
            <EnvironmentSidebar />

            {/* Center content */}
            <div className="flex flex-col gap-4 p-4 overflow-y-auto">
              <EnergyFlow />
              <BuildingGrid />
              <CommunityCharts />
            </div>

            {/* Right sidebar */}
            <div className="flex flex-col gap-4 p-4 overflow-y-auto border-l border-slate-200 bg-white">
              {compareMode ? (
                <ComparisonPanel />
              ) : (
                <>
                  <AgentPanel />
                  <KPIPanel />
                </>
              )}
            </div>
          </div>

          <PlaybackBar />
        </>
      )}
    </div>
  );
}
