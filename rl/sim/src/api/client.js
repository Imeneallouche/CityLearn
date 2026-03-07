const BASE = '';

export async function fetchCatalog() {
  const res = await fetch(`${BASE}/api/catalog`);
  if (!res.ok) throw new Error(`Catalog fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchEpisode(modelId, episode) {
  const res = await fetch(`${BASE}/api/models/${modelId}/episodes/${encodeURIComponent(episode)}`);
  if (!res.ok) throw new Error(`Episode fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchSchema(datasetName) {
  const res = await fetch(`${BASE}/api/datasets/${encodeURIComponent(datasetName)}/schema`);
  if (!res.ok) throw new Error(`Schema fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchBaseline(datasetSize, agentType) {
  const res = await fetch(`${BASE}/api/baselines/${datasetSize}/${encodeURIComponent(agentType)}`);
  if (!res.ok) throw new Error(`Baseline fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchComparison(datasetSize) {
  const res = await fetch(`${BASE}/api/compare/${datasetSize}`);
  if (!res.ok) throw new Error(`Comparison fetch failed: ${res.status}`);
  return res.json();
}

export async function chatWithAssistant(messages) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: messages.map(m => ({ role: m.role, content: m.content })) }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Chat failed (${res.status}): ${text}`);
  }
  return res.json();
}
