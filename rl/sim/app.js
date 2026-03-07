/* ═══════════════════════════════════════════════
   CityLearn RL Dashboard — Application Logic
   ═══════════════════════════════════════════════ */

const API = "";

// ─── State ───
let catalog = [];
let episode = null;   // full episode data
let step = 0;         // current playback step
let playing = false;
let playTimer = null;
let selectedBuilding = null;

// ─── Charts ───
let chartCommunity = null;
let chartBuildingDetail = null;
let chartKPI = null;

// ─── DOM refs ───
const $model     = document.getElementById("model-select");
const $episode   = document.getElementById("episode-select");
const $btnLoad   = document.getElementById("btn-load");
const $btnPlay   = document.getElementById("btn-play");
const $btnPrev   = document.getElementById("btn-prev");
const $btnNext   = document.getElementById("btn-next");
const $speed     = document.getElementById("speed-select");
const $scrubber  = document.getElementById("time-scrubber");
const $timeLabel = document.getElementById("time-label");
const $stepLabel = document.getElementById("step-label");
const $loading   = document.getElementById("loading-overlay");

// ─── Boot ───
document.addEventListener("DOMContentLoaded", init);

async function init() {
    try {
        const res = await fetch(`${API}/api/catalog`);
        const data = await res.json();
        catalog = data.models;
        populateModelSelect();
        wireEvents();
    } catch (e) {
        console.error("Failed to load catalog:", e);
    }
}

function populateModelSelect() {
    $model.innerHTML = "";
    catalog.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m.model_id;
        opt.textContent = `${m.algorithm} / ${m.reward_variant} (${m.dataset_size} bldgs)`;
        $model.appendChild(opt);
    });
    if (catalog.length) onModelChange();
}

function onModelChange() {
    const m = catalog.find(c => c.model_id === $model.value);
    $episode.innerHTML = "";
    if (!m) return;
    m.episodes.forEach(ep => {
        const opt = document.createElement("option");
        opt.value = ep;
        opt.textContent = ep;
        $episode.appendChild(opt);
    });
    // Default to last episode (best trained)
    if (m.episodes.length) {
        $episode.value = m.episodes[m.episodes.length - 1];
    }
}

function wireEvents() {
    $model.addEventListener("change", onModelChange);
    $btnLoad.addEventListener("click", loadEpisode);
    $btnPlay.addEventListener("click", togglePlay);
    $btnPrev.addEventListener("click", () => goToStep(step - 1));
    $btnNext.addEventListener("click", () => goToStep(step + 1));
    $scrubber.addEventListener("input", () => goToStep(parseInt($scrubber.value)));
}

// ─── Load Episode ───
async function loadEpisode() {
    const modelId = $model.value;
    const ep = $episode.value;
    if (!modelId || !ep) return;

    stopPlayback();
    showLoading(true);

    try {
        const url = `${API}/api/models/${modelId}/episodes/${encodeURIComponent(ep)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        episode = await res.json();

        $scrubber.max = episode.timesteps - 1;
        goToStep(0);
        buildUI();
    } catch (e) {
        console.error("Failed to load episode:", e);
        alert("Failed to load episode data.");
    } finally {
        showLoading(false);
    }
}

function showLoading(on) {
    $loading.style.display = on ? "flex" : "none";
}

// ─── Playback ───
function togglePlay() {
    if (!episode) return;
    playing = !playing;
    $btnPlay.textContent = playing ? "⏸" : "▶";
    $btnPlay.classList.toggle("playing", playing);
    if (playing) startPlayback();
    else stopPlayback();
}

function startPlayback() {
    stopPlayback();
    const delay = parseInt($speed.value) || 100;
    playTimer = setInterval(() => {
        if (step >= episode.timesteps - 1) {
            stopPlayback();
            playing = false;
            $btnPlay.textContent = "▶";
            $btnPlay.classList.remove("playing");
            return;
        }
        goToStep(step + 1);
    }, delay);
}

function stopPlayback() {
    if (playTimer) {
        clearInterval(playTimer);
        playTimer = null;
    }
}

// Also restart timer when speed changes
document.getElementById("speed-select").addEventListener("change", () => {
    if (playing) startPlayback();
});

// ─── Step Navigation ───
function goToStep(s) {
    if (!episode) return;
    step = Math.max(0, Math.min(s, episode.timesteps - 1));
    $scrubber.value = step;
    updateDisplay();
}

// ─── Build UI ───
function buildUI() {
    buildBuildingCards();
    buildCommunityChart();
    buildKPIPanel();
    buildSpecsPanel();
    selectedBuilding = episode.buildings[0];
    selectBuilding(selectedBuilding);
    updateDisplay();
}

function buildBuildingCards() {
    const grid = document.getElementById("buildings-grid");
    grid.innerHTML = "";
    episode.buildings.forEach((bname, i) => {
        const card = document.createElement("div");
        card.className = "building-card";
        card.dataset.building = bname;
        card.innerHTML = `
            <h4><span class="bldg-icon">🏠</span>${bname}</h4>
            <div class="building-metrics">
                <div class="building-metric">
                    <span class="bm-label">Net Cons.</span>
                    <span class="bm-value" data-field="net_consumption">--</span>
                </div>
                <div class="building-metric">
                    <span class="bm-label">PV Gen.</span>
                    <span class="bm-value" data-field="pv_generation" style="color:var(--accent-green)">--</span>
                </div>
                <div class="building-metric">
                    <span class="bm-label">Battery</span>
                    <span class="bm-value" data-field="battery_soc" style="color:var(--accent-cyan)">--</span>
                </div>
                <div class="building-metric">
                    <span class="bm-label">Indoor T</span>
                    <span class="bm-value" data-field="indoor_temperature" style="color:var(--accent-amber)">--</span>
                </div>
            </div>
            <div class="soc-bar"><div class="soc-fill" data-soc="true" style="width:0%"></div></div>
        `;
        card.addEventListener("click", () => selectBuilding(bname));
        grid.appendChild(card);
    });
}

function selectBuilding(bname) {
    selectedBuilding = bname;
    document.querySelectorAll(".building-card").forEach(c => {
        c.classList.toggle("selected", c.dataset.building === bname);
    });
    buildBuildingDetailChart();
    updateBuildingDetailChart();

    // Update specs for selected building
    const specs = episode.building_specs[bname];
    const specsList = document.getElementById("building-specs-list");
    if (specs && specsList) {
        specsList.innerHTML = Object.entries(specs).map(([k, v]) => `
            <div class="spec-item">
                <span class="spec-label">${formatSpecName(k)}</span>
                <span class="spec-value">${typeof v === "number" ? v.toFixed(2) : v}</span>
            </div>
        `).join("");
    }
}

function formatSpecName(key) {
    return key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Charts ───
const CHART_DEFAULTS = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 },
    plugins: {
        legend: { labels: { color: "#94a3b8", boxWidth: 12, font: { size: 11 } } },
    },
    scales: {
        x: {
            ticks: { color: "#64748b", maxTicksLimit: 12, font: { size: 10 } },
            grid: { color: "rgba(51,65,85,0.3)" },
        },
        y: {
            ticks: { color: "#64748b", font: { size: 10 } },
            grid: { color: "rgba(51,65,85,0.3)" },
        },
    },
};

function buildCommunityChart() {
    if (chartCommunity) chartCommunity.destroy();

    const ctx = document.getElementById("chart-community").getContext("2d");
    const labels = episode.community.timestamps.map(formatTimestamp);

    chartCommunity = new Chart(ctx, {
        type: "line",
        data: {
            labels,
            datasets: [
                {
                    label: "Net Consumption (kWh)",
                    data: episode.community.net_consumption,
                    borderColor: "#06b6d4",
                    backgroundColor: "rgba(6,182,212,0.1)",
                    fill: true,
                    pointRadius: 0,
                    borderWidth: 1.5,
                    tension: 0.3,
                },
                {
                    label: "Solar Generation (kWh)",
                    data: episode.community.solar_generation.map(v => Math.abs(v)),
                    borderColor: "#22c55e",
                    backgroundColor: "rgba(34,197,94,0.1)",
                    fill: true,
                    pointRadius: 0,
                    borderWidth: 1.5,
                    tension: 0.3,
                },
                {
                    label: "CO₂ (kg)",
                    data: episode.community.co2,
                    borderColor: "#f43f5e",
                    pointRadius: 0,
                    borderWidth: 1,
                    tension: 0.3,
                    yAxisID: "y1",
                },
            ],
        },
        options: {
            ...CHART_DEFAULTS,
            plugins: {
                ...CHART_DEFAULTS.plugins,
                annotation: {},
            },
            scales: {
                ...CHART_DEFAULTS.scales,
                y1: {
                    position: "right",
                    ticks: { color: "#f43f5e", font: { size: 10 } },
                    grid: { display: false },
                },
            },
        },
    });
}

function buildBuildingDetailChart() {
    if (chartBuildingDetail) chartBuildingDetail.destroy();

    const card = document.getElementById("building-detail-card");
    card.style.display = "block";
    document.getElementById("building-detail-title").textContent = `${selectedBuilding} — Detail`;

    const ctx = document.getElementById("chart-building-detail").getContext("2d");
    const bd = episode.buildings_data[selectedBuilding];
    const labels = episode.community.timestamps.map(formatTimestamp);

    chartBuildingDetail = new Chart(ctx, {
        type: "line",
        data: {
            labels,
            datasets: [
                {
                    label: "Net Consumption (kWh)",
                    data: bd.net_consumption,
                    borderColor: "#06b6d4",
                    pointRadius: 0,
                    borderWidth: 1.5,
                    tension: 0.3,
                },
                {
                    label: "Non-shift Load (kWh)",
                    data: bd.non_shiftable_load,
                    borderColor: "#a855f7",
                    pointRadius: 0,
                    borderWidth: 1,
                    tension: 0.3,
                },
                {
                    label: "Battery SOC (%)",
                    data: bd.battery_soc.map(v => v * 100),
                    borderColor: "#22c55e",
                    pointRadius: 0,
                    borderWidth: 1.5,
                    tension: 0.3,
                    yAxisID: "y1",
                },
                {
                    label: "Indoor Temp (°C)",
                    data: bd.indoor_temperature,
                    borderColor: "#f59e0b",
                    pointRadius: 0,
                    borderWidth: 1,
                    tension: 0.3,
                    yAxisID: "y2",
                },
            ],
        },
        options: {
            ...CHART_DEFAULTS,
            scales: {
                ...CHART_DEFAULTS.scales,
                y1: {
                    position: "right",
                    min: 0,
                    max: 100,
                    ticks: { color: "#22c55e", font: { size: 10 } },
                    grid: { display: false },
                    title: { display: true, text: "SOC %", color: "#22c55e" },
                },
                y2: {
                    position: "right",
                    ticks: { color: "#f59e0b", font: { size: 10 } },
                    grid: { display: false },
                    title: { display: true, text: "°C", color: "#f59e0b" },
                },
            },
        },
    });
}

function buildKPIPanel() {
    const container = document.getElementById("kpi-district");
    container.innerHTML = "";

    const districtKPIs = episode.kpis["District"] || {};
    const keyKPIs = [
        "cost_total", "carbon_emissions_total", "electricity_consumption_total",
        "daily_peak_average", "discomfort_proportion", "zero_net_energy",
        "ramping_average", "annual_normalized_unserved_energy_total",
    ];

    keyKPIs.forEach(kpi => {
        const val = districtKPIs[kpi];
        if (val === undefined || val === "") return;
        const numVal = parseFloat(val);
        let cls = "kpi-warn";
        if (numVal < 0.7) cls = "kpi-good";
        else if (numVal > 1.0) cls = "kpi-bad";

        container.innerHTML += `
            <div class="kpi-row">
                <span class="kpi-name" title="${kpi}">${formatKPIName(kpi)}</span>
                <span class="kpi-value ${cls}">${isNaN(numVal) ? val : numVal.toFixed(3)}</span>
            </div>
        `;
    });

    // KPI comparison chart across buildings
    buildKPIChart();
}

function buildKPIChart() {
    if (chartKPI) chartKPI.destroy();
    const ctx = document.getElementById("chart-kpi").getContext("2d");

    const compareKPIs = ["cost_total", "carbon_emissions_total", "discomfort_proportion"];
    const colors = ["#06b6d4", "#f43f5e", "#f59e0b"];
    const datasets = compareKPIs.map((kpi, i) => ({
        label: formatKPIName(kpi),
        data: episode.buildings.map(b => parseFloat(episode.kpis[b]?.[kpi] || 0)),
        backgroundColor: colors[i] + "88",
        borderColor: colors[i],
        borderWidth: 1,
    }));

    chartKPI = new Chart(ctx, {
        type: "bar",
        data: { labels: episode.buildings, datasets },
        options: {
            ...CHART_DEFAULTS,
            plugins: {
                ...CHART_DEFAULTS.plugins,
                legend: { ...CHART_DEFAULTS.plugins.legend, position: "bottom" },
            },
        },
    });
}

function buildSpecsPanel() {
    // Will be updated when a building is selected
}

// ─── Update Display ───
function updateDisplay() {
    if (!episode) return;

    // Time info
    const ts = episode.community.timestamps[step] || "";
    $timeLabel.textContent = ts;
    $stepLabel.textContent = `Step ${step} / ${episode.timesteps - 1}`;

    // Parse hour from timestamp
    const hour = ts ? parseInt(ts.split("T")[1]?.split(":")[0] || "0") : 0;
    document.getElementById("val-hour").textContent = `${hour}:00`;
    document.getElementById("val-daytype").textContent = hour >= 6 && hour <= 22 ? "Day" : "Night";

    // Weather
    const w = episode.weather;
    setText("val-temp", `${(w.outdoor_temperature[step] || 0).toFixed(1)}°C`);
    setText("val-humidity", `${(w.outdoor_humidity[step] || 0).toFixed(0)}%`);
    setText("val-direct-irr", `${(w.direct_irradiance[step] || 0).toFixed(0)} W/m²`);
    setText("val-diffuse-irr", `${(w.diffuse_irradiance[step] || 0).toFixed(0)} W/m²`);

    // Pricing
    const p = episode.pricing;
    setText("val-price", `$${(p.electricity_price[step] || 0).toFixed(4)}/kWh`);
    const ci = episode.carbon_intensity || [];
    setText("val-carbon", `${(ci[step] || 0).toFixed(3)} kg/kWh`);

    // Community cumulative stats
    const c = episode.community;
    const cumNetCons = c.net_consumption.slice(0, step + 1).reduce((a, b) => a + b, 0);
    const cumSolar = c.solar_generation.slice(0, step + 1).reduce((a, b) => a + Math.abs(b), 0);
    const cumCO2 = c.co2.slice(0, step + 1).reduce((a, b) => a + b, 0);
    const cumCost = c.price_cost.slice(0, step + 1).reduce((a, b) => a + b, 0);

    setText("val-net-cons", `${cumNetCons.toFixed(1)} kWh`);
    setText("val-solar-gen", `${cumSolar.toFixed(1)} kWh`);
    setText("val-total-co2", `${cumCO2.toFixed(2)} kg`);
    setText("val-total-cost", `$${cumCost.toFixed(2)}`);

    // Building cards
    episode.buildings.forEach(bname => {
        const card = document.querySelector(`.building-card[data-building="${bname}"]`);
        if (!card) return;
        const bd = episode.buildings_data[bname];

        setCardVal(card, "net_consumption", `${(bd.net_consumption[step] || 0).toFixed(2)} kWh`);
        setCardVal(card, "pv_generation", `${Math.abs(bd.pv_generation[step] || 0).toFixed(2)} kWh`);
        setCardVal(card, "battery_soc", `${((bd.battery_soc[step] || 0) * 100).toFixed(1)}%`);
        setCardVal(card, "indoor_temperature", `${(bd.indoor_temperature[step] || 0).toFixed(1)}°C`);

        const fill = card.querySelector("[data-soc]");
        if (fill) fill.style.width = `${(bd.battery_soc[step] || 0) * 100}%`;
    });

    // Update chart playhead indicators
    updateChartPlayhead();
}

function updateChartPlayhead() {
    // Draw vertical line on community chart at current step
    if (chartCommunity) {
        // Use annotation-like approach: update point data
        // For performance, we just highlight by coloring the current point
        chartCommunity.data.datasets.forEach(ds => {
            const radius = new Array(episode.timesteps).fill(0);
            radius[step] = 4;
            ds.pointRadius = radius;
        });
        chartCommunity.update("none");
    }
}

function updateBuildingDetailChart() {
    if (!chartBuildingDetail || !selectedBuilding) return;
    const bd = episode.buildings_data[selectedBuilding];
    chartBuildingDetail.data.datasets[0].data = bd.net_consumption;
    chartBuildingDetail.data.datasets[1].data = bd.non_shiftable_load;
    chartBuildingDetail.data.datasets[2].data = bd.battery_soc.map(v => v * 100);
    chartBuildingDetail.data.datasets[3].data = bd.indoor_temperature;
    chartBuildingDetail.update("none");
}

// ─── Helpers ───
function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function setCardVal(card, field, val) {
    const el = card.querySelector(`[data-field="${field}"]`);
    if (el) el.textContent = val;
}

function formatTimestamp(ts) {
    if (!ts) return "";
    // e.g. "2024-06-01T14:00:00" → "Jun 01 14:00"
    const d = new Date(ts);
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${months[d.getMonth()]} ${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:00`;
}

function formatKPIName(kpi) {
    return kpi
        .replace(/_/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase())
        .replace("Total", "")
        .replace("Average", "Avg")
        .trim();
}
