# Multi-Agent Reinforcement Learning for Smart District Energy Optimization

For this hackathon submission to **Smart Cities & Renewable Energy - AI, 5G & Digital Power**, the work is framed around renewable energy integration in cities through AI-driven district control that supports sustainable urban infrastructure, intelligent mobility, and digital public services.

## Executive Summary

This document presents the reinforcement learning (RL) approach used to optimize district-level energy behavior in CityLearn v2.  
The core idea is simple: each building acts as an intelligent agent that learns how to use storage (cooling, domestic hot water, battery) to reduce cost, reduce carbon, reduce peak demand, and improve renewable energy usage.

The study compares three levels of coordination:

- Independent SAC (self-interested control)
- Shared Policy SAC (single shared policy across buildings)
- MARLISA-style coordination (shared learning plus lightweight coordination signals)

A key principle of this evaluation is strict fairness: algorithms are compared **only under the same reward function**.

For the companion poster version of this work, see: **DOI: 10.13140/RG.2.2.20274.26562**.

---

## 1. Motivation: Why This Problem Matters

Smart cities now combine distributed solar generation, battery systems, and flexible loads.  
The challenge is that these components are highly coupled in time and across buildings:

- Solar production is intermittent.
- Building demand patterns are heterogeneous.
- Naive independent control can create district peaks and grid stress.

Traditional rule-based control often fails to handle this dynamic, high-dimensional decision process. RL is a natural fit because it learns operational policies directly from interaction with the environment and long-term feedback.

---

## 2. RL Fundamentals for This Project

At every simulation step:

1. The environment provides each building with an observation.
2. The agent outputs an action (charge/discharge decisions).
3. The environment simulates the physical and economic consequences.
4. A reward is returned.
5. The agent updates its policy to maximize long-term cumulative reward.

![Agent-Environment RL Loop](./assets/agent_env_loop.png)

In compact form, RL solves:

$$
\max_{\pi} \mathbb{E}_{\pi}\left[\sum_{t=0}^{T-1}\gamma^t r_t\right]
$$

where:

- $\pi$ is the policy (decision rule),
- $r_t$ is the reward at time $t$,
- $\gamma$ balances short-term and long-term outcomes.

---

## 3. How CityLearn Formulates the Energy Control Task

CityLearn is a realistic physics-based simulation platform that models a district as a set of buildings connected to a common grid.

Each building has:

- electric load and thermal demand profiles,
- PV generation,
- cooling storage,
- DHW storage,
- electrical battery storage.

![CityLearn Environment View](./assets/citylearn-env.jpg)

![CityLearn District Illustration](./assets/citylearn.png)

### Observation

Each agent receives local building and context information (for example storage state, demand context, and external signals).

### Action

Each building controls three continuous actuators:

- Cooling storage action
- DHW storage action
- Electrical battery action

Actions are continuous and bounded (charge/discharge behavior).

### Transition

CityLearn advances the physical simulation one step and updates building/district states.

### Reward

The reward function defines what behavior is encouraged.  
This is the most important design lever in multi-agent energy control.

### Evaluation

Performance is evaluated using district KPIs:

- Electricity Cost (lower is better)
- Peak Demand (lower is better)
- Renewable Utilization (higher is better target at concept level)
- Carbon Emissions (lower is better)

---

## 4. Algorithm Families Compared

## 4.1 Independent SAC

Independent SAC trains one policy per building agent.

Conceptually:

- each building optimizes its own decision process,
- no explicit information sharing between agents,
- serves as the baseline for fully decentralized behavior.

Strength:

- simple and robust baseline.

Weakness:

- often misses district-level coordination opportunities.

## 4.2 Shared Policy SAC

Shared Policy SAC uses one common policy across all agents.

Conceptually:

- all buildings share model parameters,
- learning is data-efficient due to shared experience,
- execution is still decentralized (each building acts from local input).

Strength:

- better sample efficiency than fully independent training.

Weakness:

- without coordination-aware reward signals, shared parameters alone do not guarantee cooperative district behavior.

## 4.3 MARLISA-Style Coordination

MARLISA-style control adds lightweight coordination context to each agent.

Conceptually:

- each agent receives local state plus compact coordination cues,
- these cues help agents anticipate district-level consequences of local actions,
- coordination emerges without requiring a heavy centralized controller.

Strength:

- improved cooperative decision quality with low extra complexity.

Weakness:

- still sensitive to reward design and scenario distribution.

---

## 5. Reward Engineering (Detailed)

Reward design is the central experimental axis of this project.  
Three reward families are evaluated.

### Why reward engineering is critical in MARL

In multi-agent systems, each agent only controls a local actuator set, but the grid experiences the **sum** of all actions.  
Because of this, reward choice determines whether agents behave as:

- isolated optimizers, or
- cooperative contributors to district stability.

A small reward change can shift behavior from "locally good but globally harmful" to "locally acceptable and globally efficient."

## 5.1 Independent Reward (`indep`)

Behavior encouraged:

- each building minimizes its own net consumption objective.

In practice, each building is rewarded mainly from its own grid interaction, with no explicit district-level cooperation term.

Expected effect:

- stable local strategies,
- limited district-level cooperation.

Interpretation:

- this is the selfish baseline to test whether algorithmic sharing alone is enough.

Typical behavior pattern:

- the agent protects local storage for local needs,
- weak incentive to coordinate with neighboring buildings,
- district peaks may persist if many agents react similarly.

## 5.2 Solar Penalty Reward (`solar`)

Behavior encouraged:

- penalizes undesirable export behavior,
- pushes agents toward stronger local PV self-consumption.

This reward extends the independent objective by explicitly discouraging excessive export, so agents learn to retain and shift solar energy more effectively.

Expected effect:

- improved renewable usage patterns,
- potential improvement in cost and carbon if storage is used strategically.

Interpretation:

- introduces a stronger renewable-centric incentive while remaining decentralized.

Typical behavior pattern:

- midday PV is more likely to be stored locally instead of exported,
- batteries are used to shift solar energy to later high-demand periods,
- possible reduction in cost and carbon when storage timing is learned well.

## 5.3 MARL Reward (`marl`)

Behavior encouraged:

- explicit district-level coordination objectives (for example load smoothness/variance shaping).

This reward directly emphasizes district-level outcomes (for example smoother aggregate load, lower stress peaks, and better global energy behavior), so local actions are aligned with collective performance.

Expected effect:

- better collective behavior,
- lower district stress,
- stronger potential gains in district KPIs under cooperative policies.

Interpretation:

- this reward family is designed to align local actions with district outcomes.

Typical behavior pattern:

- agents avoid synchronized charge/discharge that creates demand spikes,
- storage actions are distributed over time to flatten aggregate load,
- district KPIs improve even if individual local actions look less greedy.

### Intuition across the three rewards

1. `indep`: "Help my own building."
2. `solar`: "Help my own building and avoid poor PV export behavior."
3. `marl`: "Act so the whole district behaves better."

### Why Reward-Isolated Comparison Is Mandatory

Comparing different algorithms under different rewards is not a fair test.  
This study therefore compares models only within reward-matched groups:

- `indep` group: Indep SAC vs Shared SAC
- `solar` group: Shared SAC vs MARLISA
- `marl` group: Shared SAC vs MARLISA

---

## 6. Experimental Design

Benchmarks:

- 3-building district: `citylearn_challenge_2023_phase_2_local_evaluation`
- 6-building district: `citylearn_challenge_2023_phase_3_3` (scalability test)

Run matrix:

| Algorithm | Reward | Buildings |
|---|---|---|
| Indep SAC | indep | 3 |
| Shared SAC | indep | 3 |
| Shared SAC | solar | 3 |
| Shared SAC | marl | 3 |
| MARLISA | solar | 3 |
| MARLISA | marl | 3 |
| MARLISA | marl | 6 |

Artifacts used:

- Training curves (TensorBoard reward traces)
- Final KPI snapshots (district-level CityLearn exports)

---

## 7. Results and Technical Interpretation

## 7.1 Section 1: Independent Reward

![Learning Curves - Independent Reward](./poster_plots/plot_1a_learning_indep.png)

![KPI Comparison - Independent Reward](./poster_plots/plot_1b_kpi_indep.png)

Interpretation:

- This section tests whether policy sharing alone helps when incentives remain selfish.
- Similar trends indicate that reward structure, not only parameter sharing, drives district behavior.

## 7.2 Section 2: Solar Penalty Reward

![Learning Curves - Solar Reward](./poster_plots/plot_2a_learning_solar.png)

![KPI Comparison - Solar Reward](./poster_plots/plot_2b_kpi_solar.png)

Interpretation:

- Under a solar-focused incentive, MARLISA-style coordination improves quality of control decisions.
- Gains appear in evaluation KPIs even when learning curves are close.

## 7.3 Section 3: MARL Reward

![Learning Curves - MARL Reward](./poster_plots/plot_3a_learning_marl.png)

![KPI Comparison - MARL Reward](./poster_plots/plot_3b_kpi_marl.png)

Interpretation:

- Coordination-focused reward plus coordination-aware policy structure is the strongest combination in this study.
- This section captures the best-performing cooperative regime.

## 7.4 Section 4: Scalability (MARLISA, MARL Reward)

![Scalability - MARLISA 3 vs 6](./poster_plots/plot_4_scalability.png)

Interpretation:

- The best configuration is transferred from 3 to 6 buildings.
- Results suggest the approach scales without requiring a new control architecture.

---

## 8. Key Takeaways

1. Reward design is the dominant factor in district-level behavior quality.
2. Shared learning improves efficiency, but does not automatically produce cooperation.
3. Lightweight coordination signals can provide meaningful gains without full centralization.
4. The MARLISA + MARL reward setting is the strongest candidate for larger districts.


---

## 9. Virtual Agent Assistant

### 9.1 Role and Objectives

The platform includes a conversational AI assistant that serves as an expert analyst for the CityLearn RL system. Its role is to make trained models, KPI results, and algorithmic concepts accessible to non-expert users through natural language interaction.

The assistant is powered by **Google Gemini 2.5 Flash** via the **Agno agent framework**, and is equipped with 10 purpose-built tools that expose the full platform data layer. Rather than displaying raw data, it translates tool outputs into structured, human-readable prose — acting as a senior analyst who presents polished briefings.

Core objectives:

- **Model exploration**: List all trained models, inspect metadata (algorithm, reward variant, policy type, checkpoints), and explain training configurations.
- **Performance analysis**: Retrieve and interpret normalized KPI metrics for any episode, comparing RL agents against no-op and rule-based baselines.
- **Cross-model comparison**: Compare all models on the same dataset side by side, highlighting which algorithm–reward combination performs best.
- **Education**: Explain the CityLearn environment, SAC, MARLISA, and RBC algorithms, observation/action spaces, and reward functions on demand.
- **Building and dataset inspection**: Surface per-building equipment specs (PV capacity, battery size, cooling/DHW devices) and dataset configuration details.

### 9.2 Architecture and Interaction Flow

The assistant follows a **tool-augmented generation** pattern:

1. The user sends a natural language query via the chat panel.
2. The **FastAPI backend** (`POST /api/chat`) forwards the message to the Agno agent.
3. The agent's system prompt instructs it to call the appropriate tool(s) before answering — ensuring responses are always grounded in actual platform data.
4. Tool functions execute against the model discovery layer (`config.py`) and episode data loader (`data.py`), returning structured JSON internally.
5. The agent synthesizes tool outputs into narrative prose with headings, bullet points, and bold highlights, following strict formatting guidelines in its system prompt.
6. The response is returned to the frontend, which renders it with Markdown support and displays tool call badges (e.g., "Analyzed KPIs", "Compared models") so the user can see which data sources were consulted.

**Available tools:**

| Tool | Purpose |
|---|---|
| `list_trained_models` | Catalog all discovered models with algorithm, reward, episodes, checkpoints |
| `get_model_details` | Full metadata and training config for a specific model |
| `get_episode_kpis` | Normalized KPI metrics for a given episode |
| `get_episode_summary` | Timeseries summary statistics (consumption, solar, CO₂, cost, per-building battery usage) |
| `compare_models` | Cross-algorithm KPI comparison on the same dataset |
| `get_building_info` | Per-building equipment specs (PV, battery, cooling, DHW) |
| `get_dataset_info` | Dataset schema, building list, simulation parameters |
| `explain_citylearn` | Comprehensive explanation of the CityLearn environment |
| `explain_algorithm` | Detailed explanation of SAC, MARLISA, or RBC |
| `get_baseline_comparison` | Side-by-side KPI comparison of an RL model vs. a baseline agent |

### 9.3 Safety, Guardrails, and User Experience

**Data-grounded responses**: The system prompt mandates that the agent call tools to fetch actual numbers before answering performance questions, preventing hallucinated metrics.

**Clean output**: A post-processing pipeline strips raw JSON artifacts, tool-call noise (e.g., `Running: func_name(...)` lines), and excessive whitespace from agent responses before they reach the frontend, ensuring the user only sees polished prose.

**Structured formatting**: The system prompt enforces a strict response style — one-sentence summary lead, organized headings, bullet points, bold highlights for key numbers, and a closing takeaway. KPI values are always contextualized (e.g., "a cost KPI of **0.82** means an **18% reduction** vs. baseline").

**Tool call transparency**: Each tool invocation is surfaced in the chat UI as a labeled badge with a contextual icon (e.g., a bar-chart icon for "Analyzed KPIs", a flask icon for "Explained algorithm"), so users understand what data the assistant consulted.

**Graceful error handling**: If a model or episode is not found, tools return descriptive error messages listing available options, allowing the agent to guide the user to valid queries.

**Conversation modes**: The chat panel supports both a popup overlay (for quick questions while viewing the dashboard) and a fullscreen mode (for extended analytical conversations), togglable via a header button.

---

## 10. UI Screenshots and User Journey

### 10.1 Main Screenshots

**Screenshot 1 — Landing State: Model and Episode Selection**

![Landing State](./assets/ui_landing.png)

The initial view presented when the dashboard loads. The header bar shows the CityLearn branding, a model selector dropdown (listing all discovered models in `ALGORITHM / reward_variant / N buildings` format), an episode selector, and a Load button. The center area displays an empty-state prompt: *"Select a trained model and episode above, then click Load to visualize the RL agent's energy management decisions across a multi-building district."*

---

**Screenshot 2 — Main Dashboard: Three-Panel Layout**

![Main Dashboard](./assets/ui_dashboard.png)

The primary operational view after loading an episode. A three-column layout: the left sidebar shows environment controls (building selection, dataset info, available baselines); the center panel displays the energy flow Sankey diagram, the building grid with per-building state cards, and community-level consumption/solar timeseries charts; the right panel shows the KPI panel with six normalized metric cards and a bar chart, plus the agent information panel with policy type and training configuration.

---

**Screenshot 3 — Building Grid: Per-Building State Cards**

![Building Grid](./assets/ui_building_grid.png)

A grid of building cards within the center panel. Each card shows the building name, real-time battery state-of-charge (SOC), net consumption, and indoor temperature. Cards are color-coded based on metric values (e.g., green for healthy SOC, red for high consumption), giving a quick visual overview of the district state at the current timestep.

---

**Screenshot 4 — Energy Flow: Sankey Diagram**

![Energy Flow](./assets/ui_energy_flow.png)

A Sankey-style energy flow visualization showing how energy moves through the district at each timestep — from solar generation through battery storage to grid import/export. Displays per-building and community-level energy balances, making it easy to see which buildings are charging, discharging, or drawing from the grid.

---

**Screenshot 5 — Community Charts: District-Level Timeseries**

![Community Charts](./assets/ui_community_charts.png)

Line and area charts showing district-level timeseries data over the full episode. Includes net consumption over time, solar generation overlay, and peak demand indicators. These charts reveal the aggregate impact of the RL agents' coordinated (or uncoordinated) storage actions on district load shape.

---

**Screenshot 6 — KPI Panel: Performance Metrics**

![KPI Panel](./assets/ui_kpi_panel.png)

The right-sidebar KPI panel showing six normalized performance metrics: cost, carbon emissions, electricity consumption, peak demand, daily peak, load factor, and ramping. Each metric is displayed as a card with the normalized value and a color-coded interpretation (green when < 1.0, indicating the RL agent outperforms the no-op baseline). A bar chart below provides a visual comparison of all KPIs at a glance.

---

**Screenshot 7 — Playback Bar: Timeline Scrubber**

![Playback Bar](./assets/ui_playback.png)

A bottom-docked playback control bar for stepping through the episode timeline. Includes play/pause controls, a speed adjustment slider (milliseconds per timestep), a timeline scrubber showing the current timestep position, and a timestamp display. Enables animated replay of the full episode to observe how agent decisions evolve over time.

---

**Screenshot 8 — Comparison Mode: Model vs. Baseline**

![Comparison Mode](./assets/ui_comparison.png)

The comparison panel activated via the header toggle. The right sidebar expands to show side-by-side KPI tables comparing the loaded RL model against a baseline agent (no-op or RBC). Delta calculations highlight improvements or regressions for each metric. Users can also load a second trained model for agent-vs-agent comparison.

---

**Screenshot 9 — AI Assistant: Chat Panel (Popup Mode)**

![Chat Popup](./assets/ui_chat_popup.png)

The AI assistant chat panel in popup mode, floating over the main dashboard content. Shows a conversation with user/assistant message bubbles, Markdown-rendered responses with headings and bullet points, and tool call badges (e.g., "Analyzed KPIs", "Compared models") displayed as labeled pills with contextual icons. A text input field and send button are anchored at the bottom.

---

**Screenshot 10 — AI Assistant: Chat Panel (Fullscreen Mode)**

![Chat Fullscreen](./assets/ui_chat_fullscreen.png)

The AI assistant in fullscreen mode, replacing the main dashboard content for extended analytical conversations. The wider layout provides more reading space for detailed responses. A toggle button in the header switches between popup and fullscreen modes. The conversation thread, tool call badges, and Markdown formatting are identical to popup mode but scaled for the larger viewport.

### 10.2 User Flow Annotations

A typical user journey through the dashboard follows this sequence:

1. **Select model** — Choose an algorithm/reward/dataset combination from the header dropdown (e.g., `MARLISA / marl / 3 buildings`).
2. **Select episode** — Pick an evaluation episode from the episode dropdown (e.g., `marlisa_eval_ep_0200`).
3. **Load** — Click the Load button. The backend fetches and merges CSV data; the dashboard transitions from the landing state to the three-panel layout.
4. **Explore buildings** — Review per-building cards in the building grid. Click a building in the left sidebar to highlight it. Inspect battery SOC, consumption, and temperature.
5. **Analyze energy flows** — Examine the Sankey diagram to understand how solar energy is routed through storage to offset grid demand.
6. **Review district performance** — Scroll to the community charts to see aggregate consumption profiles and solar generation over the episode timeline.
7. **Check KPIs** — Review the right-panel KPI cards to see how the agent performs vs. the baseline across cost, carbon, peak demand, and other metrics.
8. **Playback** — Use the playback bar to animate the episode and watch how agent decisions evolve hour by hour across the simulation period.
9. **Compare** — Toggle comparison mode to load a baseline or competing model and view side-by-side KPI deltas.
10. **Ask the assistant** — Open the AI chat panel to ask natural language questions (e.g., "How does MARLISA compare to SAC on the 3-building dataset?" or "Which model has the lowest peak demand?").

### 10.3 Demo Script Notes

**Opening (30s)**: Start at the landing screen. Briefly explain the platform purpose — multi-agent RL for district energy optimization using CityLearn.

**Model loading (30s)**: Select `MARLISA / marl / 3 buildings`, pick the latest episode, and click Load. Point out the three-panel layout as it appears.

**Building exploration (45s)**: Walk through the building grid cards. Highlight how different buildings have different battery utilization patterns. Show the energy flow Sankey diagram to illustrate solar-to-battery-to-grid flows.

**District analysis (45s)**: Scroll to community charts. Point out how MARLISA's coordination smooths the aggregate load profile compared to uncoordinated baselines. Show the KPI panel — highlight that key metrics are below 1.0, confirming the agent outperforms the no-op baseline.

**Playback (30s)**: Hit play on the playback bar. Animate a few timesteps to show how building states, energy flows, and KPIs update in real time.

**Comparison (45s)**: Toggle comparison mode. Load the RBC baseline. Walk through the side-by-side KPI table, pointing out where MARLISA achieves the largest improvements (e.g., peak demand, cost).

**AI Assistant (60s)**: Open the chat panel. Ask: *"Compare all models on the 3-building dataset."* Show how the assistant calls `compare_models`, displays tool call badges, and returns a structured prose response with a clear verdict. Follow up with: *"Explain how MARLISA coordination works."* Show the `explain_algorithm` tool being invoked and the educational response.

**Closing (15s)**: Summarize key takeaway — reward design plus lightweight coordination (MARLISA + MARL reward) yields the strongest district-level performance, and the platform makes these results explorable and explainable.

---

## 11. References

1. Vazquez-Canteli et al. MARLISA: Multi-Agent RL with Iterative Sequential Action Selection. BuildSys, 2021.  
2. Vazquez-Canteli and Nagy. CityLearn v1.0: An OpenAI Gym Environment for Demand Response. BuildSys, 2019.  
3. Haarnoja et al. Soft Actor-Critic: Off-Policy Maximum Entropy Deep RL. ICML, 2018.  
4. Nweye et al. CityLearn 2022 Challenge: Citywide MARL for Demand Response. NeurIPS Competition, 2022.  
5. Nweye et al. CityLearn v2: A Multi-Agent Reinforcement Learning Environment for Home Energy Management and Demand Response. arXiv:2405.03848, 2024.  
6. CityLearn Documentation: https://www.citylearn.net/
