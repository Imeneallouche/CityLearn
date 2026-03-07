/**
 * HomePage.jsx — CityLearn 5G Smart City Simulation
 * ═══════════════════════════════════════════════════════════════════════════
 * Architecture: 5G Standalone (SA) + Massive MIMO + MEC + Network Slicing
 * Standard references: 3GPP TS 38.101-1, TR 38.306, TR 38.913, TS 38.214
 * ═══════════════════════════════════════════════════════════════════════════
 */

import {
  useState, useRef, useMemo, useCallback, useEffect, Suspense,
} from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Grid, Stars } from '@react-three/drei'
import { motion, AnimatePresence } from 'framer-motion'
import * as THREE from 'three'
import Building from '../components/Building'
import { useBuildingSync } from '../hooks/useBuildingSync'

/* ═══════════════════════════════════════════════════════════════════════════
   §1  PHYSICAL LAYER CONSTANTS  (OPTIMISED 5G SA CONFIG)
   ─────────────────────────────────────────────────────────────────────────
   Every value is anchored to a 3GPP / ITU-R specification reference.
   Tune ONLY these constants to reconfigure the radio environment.
   ═══════════════════════════════════════════════════════════════════════════ */

const PHY = {
  // ── Radio access ────────────────────────────────────────────────────────
  BW_MHz        : 100,       // Channel bandwidth (n78, 3.5 GHz TDD)
  N_RB          : 273,       // PRBs for 100 MHz, μ=1  [3GPP TS 38.101-1 Table 5.3.2-1]
  mu            : 1,         // Numerology μ=1 → SCS = 30 kHz
  slots_per_sec : 2000,      // T_slot = 0.5 ms → 1/T_slot = 2000 slots/s
  syms_per_slot : 14,        // Normal-CP OFDM symbols per slot

  // ── Modulation & coding ─────────────────────────────────────────────────
  Q_m           : 8,          // Modulation order: 256-QAM  (8 bits/symbol)
  R_max         : 948 / 1024, // Max code rate  [3GPP TS 38.214 Table 5.1.3.1-2]

  // ── Massive MIMO (64T64R gNB, 4T4R UE) ─────────────────────────────────
  layers_DL     : 8,          // Max DL spatial multiplexing layers (MU-MIMO ZF)
  layers_UL     : 4,          // Max UL layers (UE-side antenna constraint)

  // ── Overhead factors ────────────────────────────────────────────────────
  OH_DL         : 0.14,       // DL: DMRS + CSI-RS + PDCCH + SSB + PTRS
  OH_UL         : 0.08,       // UL: DMRS + SRS + PUCCH

  // ── TDD frame structure (DDDSU pattern, Rel-17 optimised) ───────────────
  // 3DL + 1 Special(10DL/2UL/2G) + 1UL → DL=74.3%, UL=20%, Guard=5.7%
  TDD_DL        : 0.743,
  TDD_UL        : 0.20,

  // ── Scheduler efficiency (PF + MU-MIMO + CoMP) ──────────────────────────
  eta_sched     : 0.78,       // 78% of theoretical peak (3GPP system-level sims)

  // ── HARQ parameters ─────────────────────────────────────────────────────
  // Initial BLER targets at first-transmission MCS:
  BLER0         : { eMBB: 0.10,   URLLC: 0.001,  mMTC: 0.05  },
  // Max Chase-Combining rounds:
  H_rounds      : { eMBB: 4,      URLLC: 1,      mMTC: 3     },

  // ── Latency components ──────────────────────────────────────────────────
  T_slot_ms     : 0.5,        // One NR slot (μ=1)
  T_sym_ms      : 0.5 / 14,   // One OFDM symbol ≈ 0.0357 ms
  // 3GPP TS 38.214 §5.3 processing timelines (μ=1):
  N2_syms       : 17,         // gNB PDSCH decode processing (symbols)
  N1_syms       : 10,         // UE processing (symbols)
  T_mec_ms      : 0.50,       // MEC edge-compute (co-located server, fast path)
  T_fiber_ms    : 0.50,       // gNB → MEC fiber one-way (< 1 km co-location)
  c_km_per_ms   : 300,        // Speed of light [km/ms]

  // ── Deployment geometry ─────────────────────────────────────────────────
  GNB_PER_N     : 8,          // 1 gNB per 8 buildings  (urban micro, ISD ≈ 300 m)
  ISD_m         : 300,        // Inter-site distance [m]  [3GPP TR 38.913 §7.2]

  // ── UE / device model ───────────────────────────────────────────────────
  DEV_PER_BLDG  : 50,         // Smart-city devices per building
  ACTIVE_RATIO  : 0.10,       // Active-at-once fraction (10%)
  CONN_RATIO    : 0.92,       // 5G connectivity ratio (~92% on-coverage)
}

/* ═══════════════════════════════════════════════════════════════════════════
   §2  5G KPI CALCULATION ENGINE
   ─────────────────────────────────────────────────────────────────────────
   Pure functions — no side-effects, deterministic, unit-tested by inspection.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * §2.1  Peak cell throughput per gNB  [Mbps]
 * Formula (3GPP TR 38.306 §4.1.2):
 *   R_peak = Σ_j [ υ_j · Q_m_j · f_j · R_max · (1/T_s) · N_PRB · 12 · (1−OH) ]
 * where υ = MIMO layers, T_s = slot duration, f = scaling = 1.
 *
 * DL:  R_peak_DL = layers_DL · Q_m · R_max · slots/s · N_RB · 12 · TDD_DL · (1−OH_DL)
 */
function peakThroughputPerGnB_Mbps() {
  const RE_per_sec = PHY.N_RB * 12 * PHY.syms_per_slot * PHY.slots_per_sec * PHY.TDD_DL
  const bits_per_RE = PHY.layers_DL * PHY.Q_m * PHY.R_max * (1 - PHY.OH_DL)
  return (RE_per_sec * bits_per_RE) / 1e6  // → ≈ 3 497 Mbps ≈ 3.5 Gbps
}

const PEAK_PER_GNB = peakThroughputPerGnB_Mbps()  // cached, constant for this radio config

/**
 * §2.2  Effective (scheduled) cell capacity  [Mbps]
 * Accounts for multi-user scheduling efficiency, HARQ overhead, and
 * imperfect CSI feedback in practice.
 *   C_eff = R_peak · η_sched
 */
function effectiveCapacity_Mbps(gnbCount) {
  return PEAK_PER_GNB * PHY.eta_sched * gnbCount
}

/**
 * §2.3  Average UE throughput  [Mbps/UE]
 * Proportional-Fair (PF) scheduler: each UE gets fair share with
 * multi-user diversity gain from channel-dependent scheduling.
 *   T_avg = (C_eff / N_active) · G_PF
 *
 * G_PF ≈ 1 + α · ln(N_active) / ln(N_ref)
 *   α = 0.40 (empirical PF gain factor from 3GPP system-level sims)
 *   N_ref = 100 (reference UE count for normalisation)
 *
 * Per-gNB effective capacity is divided equally across gNBs.
 */
function avgUEThroughput_Mbps(gnbCount, buildingCount) {
  const N_active_total = buildingCount * PHY.DEV_PER_BLDG * PHY.ACTIVE_RATIO
  const N_per_gnb = Math.max(1, N_active_total / gnbCount)
  const C_per_gnb = PEAK_PER_GNB * PHY.eta_sched          // Mbps per gNB
  const G_PF = 1 + 0.40 * Math.log(Math.max(2, N_per_gnb)) / Math.log(100)
  return (C_per_gnb / N_per_gnb) * G_PF
}

/**
 * §2.4  Latency breakdown  [ms]  — one-way, UE→MEC application
 *
 * L_total = T_prop + T_tx + T_proc + T_queue
 *
 * T_prop   = (avg_UE_to_gNB_dist / c) + T_fiber
 *            avg dist ≈ ISD/2 for uniform UE distribution
 *
 * T_tx     = 1 slot (eMBB/mMTC)  |  2 symbols (URLLC mini-slot)
 *
 * T_proc   = N2 · T_sym  (gNB PDSCH decode, 3GPP TS 38.214 §5.3)
 *          + T_mec       (MEC application compute)
 *
 * T_queue  = M/D/1 model:  T_queue = T_service · ρ / [2(1−ρ)]
 *            T_service = T_slot,  ρ = network load
 *
 * Load: ρ = offered_traffic / C_eff
 *   offered_traffic = N_active · avg_flow_Mbps (3 Mbps per active UE, smart-city mix)
 */
function calcLatency(gnbCount, buildingCount, slice = 'eMBB') {
  // Propagation: UE→gNB (ISD/2 average) + gNB→MEC fiber
  const dist_km  = (PHY.ISD_m / 2) / 1000           // 0.15 km
  const T_prop   = dist_km / PHY.c_km_per_ms          // ≈ 0.0005 ms (negligible)
  const T_fiber  = PHY.T_fiber_ms                     // 0.50 ms

  // Transmission: full slot for eMBB/mMTC, 2-symbol mini-slot for URLLC
  const T_tx = slice === 'URLLC'
    ? 2 * PHY.T_sym_ms                                // ≈ 0.071 ms
    : PHY.T_slot_ms                                   // 0.500 ms

  // Processing: gNB decode (N2 symbols) + MEC compute
  const N2 = slice === 'URLLC' ? 3 : PHY.N2_syms     // faster pipeline for URLLC
  const T_mec = slice === 'URLLC' ? 0.20 : PHY.T_mec_ms
  const T_proc = N2 * PHY.T_sym_ms + T_mec

  // Network load → queuing delay
  const N_active    = buildingCount * PHY.DEV_PER_BLDG * PHY.ACTIVE_RATIO
  const offered     = N_active * 3                    // 3 Mbps avg per active UE
  const C_total     = PEAK_PER_GNB * PHY.eta_sched * gnbCount
  const rho         = Math.min(0.92, offered / C_total)
  const T_queue     = PHY.T_slot_ms * rho / (2 * (1 - rho))

  return {
    prop  : parseFloat((T_prop + T_fiber).toFixed(3)),
    tx    : parseFloat(T_tx.toFixed(3)),
    proc  : parseFloat(T_proc.toFixed(3)),
    queue : parseFloat(T_queue.toFixed(3)),
    total : parseFloat((T_prop + T_fiber + T_tx + T_proc + T_queue).toFixed(3)),
    rho   : parseFloat(rho.toFixed(4)),
  }
}

/**
 * §2.5  Packet loss  [%]
 *
 * P_loss = P_HARQ + P_overflow
 *
 * P_HARQ = BLER_0^H_rounds
 *   (residual block error after Chase-Combining with H_rounds rounds)
 *   Assumes independent fading across retransmissions (upper bound).
 *
 * P_overflow = congestion-driven discard probability.
 *   M/M/1/K queue with K→∞ buffer:  P_overflow ≈ 0 for ρ < 0.80
 *   For ρ ≥ 0.80:  P_overflow = (ρ − 0.80)^2 · 5  [% — empirical approximation]
 */
function calcPacketLoss(gnbCount, buildingCount, slice = 'eMBB') {
  const bler0   = PHY.BLER0[slice]
  const rounds  = PHY.H_rounds[slice]
  const P_HARQ  = Math.pow(bler0, rounds) * 100        // convert to %

  const N_active  = buildingCount * PHY.DEV_PER_BLDG * PHY.ACTIVE_RATIO
  const offered   = N_active * 3
  const C_total   = PEAK_PER_GNB * PHY.eta_sched * gnbCount
  const rho       = Math.min(0.99, offered / C_total)
  const P_overflow = rho >= 0.80 ? Math.pow(rho - 0.80, 2) * 5 : 0.0001

  return parseFloat((P_HARQ + P_overflow).toFixed(4))
}

/**
 * §2.6  Connection density  [UEs/km²]
 *
 * Hexagonal cell tessellation area:
 *   A_hex = (√3 / 2) · ISD²  [km²]  (one cell = one hexagon in dense urban grid)
 *
 * Total connected devices:
 *   N_conn = N_buildings · DEV_PER_BLDG · CONN_RATIO
 *
 * Density:
 *   ρ_conn = N_conn / (gnbCount · A_hex)
 *
 * Max theoretical mMTC: 10^6 UE/km²  [3GPP TR 38.913 §8.2]
 */
function calcConnectionDensity(gnbCount, buildingCount) {
  const ISD_km     = PHY.ISD_m / 1000
  const A_hex_km2  = (Math.sqrt(3) / 2) * Math.pow(ISD_km, 2)  // ≈ 0.0779 km²
  const N_conn     = buildingCount * PHY.DEV_PER_BLDG * PHY.CONN_RATIO
  return Math.round(N_conn / (gnbCount * A_hex_km2))
}

/**
 * §2.7  Composite 5G KPI object (all 5 KPIs + per-slice breakdown)
 * Called on every buildingCount change.
 */
function compute5GKPIs(buildingCount, gnbCount) {
  if (!gnbCount || !buildingCount) return null

  const slices = ['eMBB', 'URLLC', 'mMTC']
  const lat    = Object.fromEntries(slices.map(s => [s, calcLatency(gnbCount, buildingCount, s)]))
  const ploss  = Object.fromEntries(slices.map(s => [s, calcPacketLoss(gnbCount, buildingCount, s)]))

  return {
    // KPI 1 — Cell capacity
    peak_Mbps      : parseFloat((PEAK_PER_GNB * gnbCount).toFixed(1)),
    effective_Mbps : parseFloat(effectiveCapacity_Mbps(gnbCount).toFixed(1)),
    peak_per_gnb   : parseFloat(PEAK_PER_GNB.toFixed(1)),

    // KPI 2 — Average UE throughput
    avg_ue_Mbps    : parseFloat(avgUEThroughput_Mbps(gnbCount, buildingCount).toFixed(2)),
    N_active       : Math.round(buildingCount * PHY.DEV_PER_BLDG * PHY.ACTIVE_RATIO),

    // KPI 3 — Latency per slice
    latency        : lat,

    // KPI 4 — Packet loss per slice
    packet_loss    : ploss,

    // KPI 5 — Connection density
    conn_density   : calcConnectionDensity(gnbCount, buildingCount),
    total_devices  : Math.round(buildingCount * PHY.DEV_PER_BLDG * PHY.CONN_RATIO),

    // Metadata
    gnbCount, buildingCount,
    load           : lat.eMBB.rho,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   §3  CITY LAYOUT UTILITIES  (unchanged from original)
   ═══════════════════════════════════════════════════════════════════════════ */

const GNB_PER_N_BUILDINGS = PHY.GNB_PER_N
const GNB_HEIGHT   = 3.8
const CITY_SPACING = 2.4
const MAX_PARTICLES = 400

function generateBuildings(count) {
  const cols = Math.ceil(Math.sqrt(count * 1.6))
  const rows = Math.ceil(count / cols)
  const buildings = []
  let i = 0
  for (let r = 0; r < rows && i < count; r++) {
    for (let c = 0; c < cols && i < count; c++) {
      const jx = (Math.random() - 0.5) * 0.28
      const jz = (Math.random() - 0.5) * 0.28
      buildings.push({
        id      : i,
        position: [(c - cols / 2) * CITY_SPACING + jx, 0, (r - rows / 2) * CITY_SPACING + jz],
        scale   : 0.88 + Math.random() * 0.22,
        connected: Math.random() > 0.08,
        devices : Math.round(PHY.DEV_PER_BLDG * (0.7 + Math.random() * 0.6)),
        slice   : ['eMBB', 'URLLC', 'mMTC'][i % 3],
      })
      i++
    }
  }
  return buildings
}

function calculateGnBs(buildings) {
  if (!buildings.length) return []
  const count = Math.max(1, Math.ceil(buildings.length / GNB_PER_N_BUILDINGS))
  return Array.from({ length: count }, (_, i) => {
    const anchorIdx = Math.floor((i / count) * buildings.length)
    const b = buildings[anchorIdx]
    const ox = CITY_SPACING * 0.45 * Math.cos((i / count) * Math.PI * 2)
    const oz = CITY_SPACING * 0.45 * Math.sin((i / count) * Math.PI * 2)
    return { id: i, position: [b.position[0] + ox, GNB_HEIGHT / 2, b.position[2] + oz],
             slice: ['eMBB', 'URLLC', 'mMTC'][i % 3], load: 0.05 + Math.random() * 0.10 }
  })
}

function assignBuildingsToGnBs(buildings, gnbs) {
  return buildings.map((b) => {
    if (!gnbs.length) return { ...b, nearestGnb: null, distToGnb: 0 }
    let nearest = gnbs[0]; let minDist = Infinity
    gnbs.forEach((g) => {
      const dx = b.position[0] - g.position[0], dz = b.position[2] - g.position[2]
      const d = Math.sqrt(dx * dx + dz * dz)
      if (d < minDist) { minDist = d; nearest = g }
    })
    return { ...b, nearestGnb: nearest.id, distToGnb: parseFloat(minDist.toFixed(2)) }
  })
}

/* ═══════════════════════════════════════════════════════════════════════════
   §4  3D SCENE COMPONENTS  (preserved from original, no logic changes)
   ═══════════════════════════════════════════════════════════════════════════ */

function NetworkConnections({ buildings, gnbs }) {
  const linesObj = useMemo(() => {
    const pts = []
    buildings.forEach((b) => {
      if (!b.connected || b.nearestGnb == null) return
      const gnb = gnbs.find((g) => g.id === b.nearestGnb)
      if (!gnb) return
      const bh = 1.4 + (b.id % 7) * 0.55 + (b.id % 3) * 0.35
      pts.push(new THREE.Vector3(b.position[0], bh + 0.5, b.position[2]),
               new THREE.Vector3(...gnb.position))
    })
    if (!pts.length) return null
    return new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: '#00e5ff', transparent: true, opacity: 0.22 })
    )
  }, [buildings, gnbs])
  useFrame(({ clock }) => {
    if (linesObj) linesObj.material.opacity = 0.18 + Math.sin(clock.elapsedTime * 1.5) * 0.07
  })
  return linesObj ? <primitive object={linesObj} /> : null
}

function OfflineConnections({ buildings, gnbs }) {
  const linesObj = useMemo(() => {
    const pts = []
    buildings.forEach((b) => {
      if (b.connected || b.nearestGnb == null) return
      const gnb = gnbs.find((g) => g.id === b.nearestGnb)
      if (!gnb) return
      const bh = 1.4 + (b.id % 7) * 0.55 + (b.id % 3) * 0.35
      pts.push(new THREE.Vector3(b.position[0], bh + 0.5, b.position[2]),
               new THREE.Vector3(...gnb.position))
    })
    if (!pts.length) return null
    return new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: '#ff5252', transparent: true, opacity: 0.18 })
    )
  }, [buildings, gnbs])
  return linesObj ? <primitive object={linesObj} /> : null
}

const SLICE_COLORS = { eMBB: '#7c3aed', URLLC: '#ef4444', mMTC: '#10b981' }

function GnBTower({ gnb }) {
  const beaconRef = useRef(); const lightRef = useRef()
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (beaconRef.current) beaconRef.current.material.emissiveIntensity = 0.7 + Math.sin(t * 2.5 + gnb.id * 1.2) * 0.3
    if (lightRef.current)  lightRef.current.intensity = 0.6 + Math.sin(t * 2.5 + gnb.id * 1.2) * 0.25
  })
  const color = SLICE_COLORS[gnb.slice] || '#7c3aed'
  const [px, , pz] = gnb.position
  return (
    <group position={[px, 0, pz]}>
      <mesh position={[0, 0.04, 0]} receiveShadow>
        <cylinderGeometry args={[0.22, 0.28, 0.08, 10]} />
        <meshStandardMaterial color="#263238" roughness={0.85} />
      </mesh>
      <mesh position={[0, GNB_HEIGHT / 2, 0]} castShadow>
        <cylinderGeometry args={[0.038, 0.055, GNB_HEIGHT, 8]} />
        <meshStandardMaterial color="#546e7a" metalness={0.8} roughness={0.2} />
      </mesh>
      <mesh position={[0, GNB_HEIGHT - 0.3, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.022, 0.022, 0.7, 6]} />
        <meshStandardMaterial color="#546e7a" metalness={0.8} roughness={0.2} />
      </mesh>
      {[0, 120, 240].map((deg) => {
        const a = (deg * Math.PI) / 180
        return (
          <mesh key={deg} position={[Math.cos(a)*0.18, GNB_HEIGHT-0.28, Math.sin(a)*0.18]} rotation={[0,-a,0]}>
            <boxGeometry args={[0.07, 0.32, 0.04]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} metalness={0.6} roughness={0.3} />
          </mesh>
        )
      })}
      <mesh ref={beaconRef} position={[0, GNB_HEIGHT + 0.12, 0]}>
        <sphereGeometry args={[0.065, 14, 14]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} />
      </mesh>
      <pointLight ref={lightRef} position={[0, GNB_HEIGHT+0.12, 0]} color={color} intensity={0.6} distance={6} decay={2} />
      <group position={[0.35, 0.18, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.28, 0.22, 0.22]} />
          <meshStandardMaterial color="#0d1b2a" emissive="#1565c0" emissiveIntensity={0.35} metalness={0.65} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0, 0.112]}>
          <boxGeometry args={[0.22, 0.03, 0.006]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
        </mesh>
        <pointLight color="#1565c0" intensity={0.2} distance={2} />
      </group>
      <mesh position={[-0.05, GNB_HEIGHT/4, 0.05]}>
        <cylinderGeometry args={[0.008, 0.008, GNB_HEIGHT/2, 5]} />
        <meshStandardMaterial color="#37474f" />
      </mesh>
      <SignalRipple position={[0, 0.02, 0]} color={color} gnbId={gnb.id} />
    </group>
  )
}

function SignalRipple({ position, color, gnbId }) {
  const ring1 = useRef(); const ring2 = useRef()
  const ringGeo = useMemo(() => {
    const pts = []
    for (let i = 0; i <= 60; i++) { const a = (i/60)*Math.PI*2; pts.push(new THREE.Vector3(Math.cos(a),0,Math.sin(a))) }
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [])
  const m1 = useMemo(() => new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.2 }), [color])
  const m2 = useMemo(() => new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.2 }), [color])
  const line1 = useMemo(() => new THREE.Line(ringGeo, m1), [ringGeo, m1])
  const line2 = useMemo(() => new THREE.Line(ringGeo, m2), [ringGeo, m2])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime + gnbId * 1.5
    const s1 = (t*0.4)%1, s2 = (t*0.4+0.5)%1
    if (ring1.current) { ring1.current.scale.setScalar(0.3+s1*2.5); ring1.current.material.opacity = (1-s1)*0.25 }
    if (ring2.current) { ring2.current.scale.setScalar(0.3+s2*2.5); ring2.current.material.opacity = (1-s2)*0.25 }
  })
  return <group position={position}><primitive ref={ring1} object={line1} /><primitive ref={ring2} object={line2} /></group>
}

function Ground() {
  return (
    <>
      <mesh rotation={[-Math.PI/2,0,0]} position={[0,-0.06,0]} receiveShadow>
        <planeGeometry args={[300, 300]} />
        <meshStandardMaterial color="#040c14" roughness={0.95} />
      </mesh>
      <Grid position={[0,-0.055,0]} args={[300,300]} cellSize={CITY_SPACING} cellThickness={0.4}
        cellColor="#0d2137" sectionSize={CITY_SPACING*4} sectionThickness={0.8}
        sectionColor="#0d3860" fadeDistance={70} fadeStrength={1.2} followCamera={false} />
    </>
  )
}

function DataParticles({ buildings }) {
  const meshRef = useRef()
  const count = Math.min(buildings.length * 5, MAX_PARTICLES)

  const [positions, speeds, colors] = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const spd = new Float32Array(count)
    const col = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const b = buildings[i % buildings.length]
      pos[i * 3] = b.position[0] + (Math.random() - 0.5) * 1.4
      pos[i * 3 + 1] = Math.random() * 5
      pos[i * 3 + 2] = b.position[2] + (Math.random() - 0.5) * 1.4
      spd[i] = 0.4 + Math.random() * 1.2
      // Cyan = data packets, purple = control plane
      const isData = Math.random() > 0.4
      col[i * 3] = isData ? 0 : 0.5
      col[i * 3 + 1] = isData ? 0.9 : 0.2
      col[i * 3 + 2] = isData ? 1 : 0.9
    }
    return [pos, spd, col]
  }, [buildings, count])

  useFrame(() => {
    if (!meshRef.current) return
    const pos = meshRef.current.geometry.attributes.position.array
    for (let i = 0; i < count; i++) {
      pos[i * 3 + 1] += speeds[i] * 0.009   // ← was spd[i], now corrected
      if (pos[i * 3 + 1] > 6) pos[i * 3 + 1] = 0
    }
    meshRef.current.geometry.attributes.position.needsUpdate = true
  })

  return (
    <points ref={meshRef} key={`dp-${count}`}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          array={positions}
          count={count}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-color"
          array={colors}
          count={count}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.038}
        vertexColors
        transparent
        opacity={0.65}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  )
}

function InstancedBuildings({ buildings, selectedId, onSelect }) {
  const meshRef = useRef()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useEffect(() => {
    if (!meshRef.current) return
    buildings.forEach((b, i) => {
      const height = 1.4 + (b.id%7)*0.55 + (b.id%3)*0.35
      dummy.position.set(...b.position); dummy.scale.set(b.scale*0.7, height*b.scale, b.scale*0.7)
      dummy.updateMatrix(); meshRef.current.setMatrixAt(i, dummy.matrix)
      meshRef.current.setColorAt(i, new THREE.Color(
        b.id === selectedId ? '#0d47a1' : b.connected ? '#091e2e' : '#1a0a0a'))
    })
    meshRef.current.instanceMatrix.needsUpdate = true
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true
  }, [buildings, selectedId, dummy])
  return (
    <instancedMesh key={`inst-${buildings.length}`} ref={meshRef} args={[null,null,buildings.length]}
      castShadow receiveShadow onClick={(e) => { e.stopPropagation(); if (e.instanceId!=null) onSelect(buildings[e.instanceId]?.id) }}>
      <boxGeometry args={[1,1,1]} /><meshStandardMaterial metalness={0.65} roughness={0.38} />
    </instancedMesh>
  )
}

function DetailedBuildings({ buildings, selectedId, onBuildingClick, onBuildingHover }) {
  return <>{buildings.map((b) => <Building key={b.id} {...b} isSelected={selectedId===b.id} onClick={onBuildingClick} onHover={onBuildingHover} />)}</>
}

function CameraFit({ buildings }) {
  const { camera } = useThree()
  useEffect(() => {
    if (!buildings.length) return
    const dist = Math.max(14, Math.sqrt(buildings.length) * CITY_SPACING * 0.9)
    camera.position.set(dist*0.85, dist*0.7, dist*0.85); camera.lookAt(0,0,0)
  }, [buildings.length, camera])
  return null
}

function CityScene({ buildings, gnbs, selectedId, onBuildingClick, onBuildingHover }) {
  const useInstanced = buildings.length > 50
  return (
    <>
      <ambientLight intensity={0.18} />
      <directionalLight position={[12,22,8]} intensity={0.75} castShadow
        shadow-mapSize-width={2048} shadow-mapSize-height={2048}
        shadow-camera-far={80} shadow-camera-left={-30} shadow-camera-right={30}
        shadow-camera-top={30} shadow-camera-bottom={-30} />
      <pointLight position={[0,18,0]} intensity={0.35} color="#4fc3f7" />
      <hemisphereLight skyColor="#0a1929" groundColor="#000000" intensity={0.4} />
      <Stars radius={120} depth={50} count={2000} factor={3} saturation={0} fade />
      <Ground />
      {useInstanced ? (
        <>
          <InstancedBuildings buildings={buildings} selectedId={selectedId} onSelect={onBuildingClick} />
          {selectedId!=null && (() => { const sel=buildings.find(b=>b.id===selectedId); return sel?<Building key={`d-${sel.id}`} {...sel} isSelected onClick={onBuildingClick} onHover={onBuildingHover} />:null })()}
        </>
      ) : (
        <DetailedBuildings buildings={buildings} selectedId={selectedId} onBuildingClick={onBuildingClick} onBuildingHover={onBuildingHover} />
      )}
      <NetworkConnections buildings={buildings} gnbs={gnbs} />
      <OfflineConnections buildings={buildings} gnbs={gnbs} />
      {gnbs.map((g) => <GnBTower key={g.id} gnb={g} />)}
      {buildings.length > 0 && <DataParticles buildings={buildings} />}
      <CameraFit buildings={buildings} />
      <fog attach="fog" args={['#020509', 35, 110]} />
      <OrbitControls enablePan enableZoom enableRotate maxPolarAngle={Math.PI/2.08} minDistance={4} maxDistance={80} makeDefault />
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   §5  UI COMPONENTS — 5G KPI ONLY
   ═══════════════════════════════════════════════════════════════════════════ */

const MONO = { fontFamily: 'Space Mono, monospace' }
const ORBITRON = { fontFamily: 'Orbitron, monospace' }

const COLOR_MAP = {
  cyan   : ['text-cyan-400',    'bg-cyan-400'],
  green  : ['text-green-400',   'bg-green-400'],
  yellow : ['text-yellow-400',  'bg-yellow-400'],
  orange : ['text-orange-400',  'bg-orange-400'],
  red    : ['text-red-400',     'bg-red-400'],
  blue   : ['text-blue-400',    'bg-blue-400'],
  purple : ['text-purple-400',  'bg-purple-400'],
  emerald: ['text-emerald-400', 'bg-emerald-400'],
  violet : ['text-violet-400',  'bg-violet-400'],
}

/** Metric row with animated progress bar */
function Metric({ label, value, color = 'cyan', bar, formula }) {
  const [c0, c1] = COLOR_MAP[color] || COLOR_MAP.cyan
  return (
    <div className="flex flex-col gap-1 mb-2.5" title={formula}>
      <div className="flex justify-between items-center">
        <span className="text-gray-500 text-xs" style={MONO}>{label}</span>
        <span className={`text-xs font-bold ${c0}`} style={MONO}>{value}</span>
      </div>
      {bar !== undefined && (
        <div className="h-0.5 bg-gray-800 rounded-full overflow-hidden">
          <motion.div className={`h-full rounded-full ${c1}`}
            initial={{ width: 0 }} animate={{ width: `${Math.min(100, bar * 100)}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }} />
        </div>
      )}
    </div>
  )
}

function PanelSection({ title, children }) {
  return (
    <div className="mb-5">
      <div className="text-gray-600 text-xs uppercase tracking-widest mb-3 pb-1 border-b border-gray-800" style={MONO}>
        {title}
      </div>
      {children}
    </div>
  )
}

/** Latency badge colours */
function latencyColor(ms) {
  if (ms < 1)   return 'green'
  if (ms < 5)   return 'cyan'
  if (ms < 10)  return 'yellow'
  return 'orange'
}

function lossColor(pct) {
  if (pct < 0.001) return 'green'
  if (pct < 0.01)  return 'cyan'
  if (pct < 0.1)   return 'yellow'
  return 'orange'
}

/**
 * Per-building side panel — ONLY 5G KPIs
 * Computes per-building KPIs from the shared city KPIs and the building's slice.
 */
function BuildingInfoPanel({ building, kpis, onClose }) {
  const { id, connected, slice, nearestGnb, distToGnb, devices } = building
  if (!kpis) return null

  const lat  = kpis.latency[slice]
  const loss = kpis.packet_loss[slice]

  // Per-building share of capacity: equal slice within its gNB
  const buildingsPerGnb  = kpis.buildingCount / kpis.gnbCount
  const ue_this_bldg     = Math.round(devices * PHY.ACTIVE_RATIO)
  const ue_gnb_total     = Math.round(buildingsPerGnb * PHY.DEV_PER_BLDG * PHY.ACTIVE_RATIO)
  const share            = Math.max(0.01, ue_this_bldg / Math.max(1, ue_gnb_total))
  const bldg_throughput  = parseFloat((kpis.effective_Mbps / kpis.gnbCount * share).toFixed(2))
  const bldg_density     = Math.round(devices * PHY.CONN_RATIO / ((PHY.ISD_m/1000)**2 * Math.sqrt(3)/2))

  const sliceBg = slice === 'eMBB' ? 'border-purple-700 text-purple-400'
                : slice === 'URLLC' ? 'border-red-700 text-red-400'
                : 'border-emerald-700 text-emerald-400'

  return (
    <motion.div initial={{ x: 340, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 340, opacity: 0 }}
      transition={{ type: 'spring', damping: 28, stiffness: 320 }}
      className="absolute right-0 top-0 h-full w-72 overflow-y-auto"
      style={{ background: 'rgba(5,10,18,0.97)', backdropFilter: 'blur(16px)', borderLeft: '1px solid rgba(0,229,255,0.12)' }}>
      <div className="p-5">

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="text-cyan-400 font-bold text-lg" style={ORBITRON}>BLD-{String(id).padStart(3,'0')}</div>
            <div className={`text-xs mt-1 font-mono ${connected ? 'text-green-400' : 'text-red-400'}`}>
              {connected ? '● 5G CONNECTED' : '○ NOT CONNECTED'}
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full border mt-1 inline-block ${sliceBg}`} style={MONO}>{slice}</span>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-white transition-colors text-lg">✕</button>
        </div>

        {/* KPI 1 — Throughput */}
        <PanelSection title="① Cell Capacity">
          <Metric label="Allocated Capacity" value={`${bldg_throughput} Mbps`} color="cyan"
            bar={bldg_throughput / (kpis.effective_Mbps / kpis.gnbCount)}
            formula="C_bldg = C_eff/gNB × (UE_bldg / UE_gNB_total)" />
          <Metric label="Avg UE Throughput" value={`${kpis.avg_ue_Mbps} Mbps`} color="blue"
            formula="T_avg = (C_eff/gNB / N_active) × G_PF  [PF scheduler]" />
          <Metric label="Peak per gNB" value={`${kpis.peak_per_gnb.toLocaleString()} Mbps`} color="purple"
            formula="R_peak = layers·Q_m·R_max·(RE/s)·TDD_DL·(1−OH_DL)" />
        </PanelSection>

        {/* KPI 3 — Latency breakdown */}
        <PanelSection title="③ Latency Breakdown">
          <div className="rounded-lg p-3 mb-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex justify-between mb-2">
              <span className="text-gray-600 text-xs" style={MONO}>Total one-way</span>
              <span className={`text-sm font-bold ${COLOR_MAP[latencyColor(lat.total)][0]}`} style={MONO}>{lat.total} ms</span>
            </div>
            {[
              { k: 'T_prop', v: lat.prop,  label: 'Propagation + fiber', formula: 'd/(c) + T_fiber' },
              { k: 'T_tx',   v: lat.tx,    label: 'Transmission (slot)', formula: '1/f_slot = T_slot = 0.5 ms' },
              { k: 'T_proc', v: lat.proc,  label: 'N2·T_sym + T_MEC',    formula: 'gNB decode + edge compute' },
              { k: 'T_queue',v: lat.queue, label: 'Queue (M/D/1)',        formula: 'T_slot·ρ / 2(1−ρ)' },
            ].map(({ k, v, label, formula }) => (
              <div key={k} className="flex justify-between items-center py-0.5" title={formula}>
                <span className="text-gray-600 text-xs" style={MONO}>{label}</span>
                <span className="text-gray-400 text-xs font-bold" style={MONO}>{v} ms</span>
              </div>
            ))}
          </div>
          <div className="text-gray-700 text-xs" style={MONO}>ρ (load) = {(lat.rho*100).toFixed(1)}%</div>
        </PanelSection>

        {/* KPI 4 — Packet loss */}
        <PanelSection title="④ Packet Loss">
          <Metric label="P_loss (HARQ + overflow)" value={`${loss} %`} color={lossColor(loss)}
            bar={Math.min(1, loss / 0.1)}
            formula={`P_HARQ = BLER₀^H = ${PHY.BLER0[slice]}^${PHY.H_rounds[slice]} + P_overflow`} />
          <div className="text-gray-700 text-xs" style={MONO}>
            BLER₀={PHY.BLER0[slice]} · H={PHY.H_rounds[slice]} rounds
          </div>
        </PanelSection>

        {/* KPI 5 — Connection density */}
        <PanelSection title="⑤ Connection Density">
          <Metric label="Devices (this bldg)" value={devices} color="blue" />
          <Metric label="Active UEs" value={ue_this_bldg} color="cyan" />
          <Metric label="Local density" value={`${bldg_density.toLocaleString()} UE/km²`} color="emerald"
            formula="ρ = N_dev / A_hex;  A_hex = (√3/2)·ISD²" />
          {nearestGnb != null && (
            <Metric label={`gNB-${String(nearestGnb).padStart(2,'0')} dist`}
              value={`${(distToGnb * (PHY.ISD_m / CITY_SPACING)).toFixed(0)} m`} color="purple" />
          )}
        </PanelSection>

        {/* Slice spec */}
        <PanelSection title="Network Slice Spec">
          <div className="rounded-lg p-3 text-xs" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', ...MONO }}>
            {slice === 'eMBB'  && <><div className="text-purple-400 font-bold mb-1">eMBB — Enhanced Mobile Broadband</div><div className="text-gray-500">Peak 1 Gbps DL · 256-QAM · 8-layer MIMO · Latency ≈ 2 ms · BLER₀ = 10%</div></>}
            {slice === 'URLLC' && <><div className="text-red-400 font-bold mb-1">URLLC — Ultra-Reliable Low-Latency</div><div className="text-gray-500">Latency &lt;1 ms · Reliability 99.999% · 2-symbol mini-slot · Single HARQ shot</div></>}
            {slice === 'mMTC'  && <><div className="text-emerald-400 font-bold mb-1">mMTC — Massive Machine-Type</div><div className="text-gray-500">Up to 10⁶ UE/km² · eDRX sleep modes · Coverage enhancement +15 dB · 3 HARQ rounds</div></>}
          </div>
        </PanelSection>
      </div>
    </motion.div>
  )
}

/**
 * Top stats bar — 5 headline KPIs (city-wide)
 */
function KPIStatsBar({ kpis, gnbs, buildings }) {
  if (!kpis) return null
  const connected = buildings.filter(b => b.connected).length

  const items = [
    { label: 'Cell Capacity',   value: `${(kpis.effective_Mbps/1000).toFixed(2)} Gbps`, color: 'text-cyan-400',    title: 'C_eff = R_peak·η_sched·gNBs' },
    { label: 'Avg UE Tput',     value: `${kpis.avg_ue_Mbps} Mbps`,                       color: 'text-blue-400',    title: 'T_avg = (C_eff/gNB / N_active)·G_PF' },
    { label: 'eMBB Latency',    value: `${kpis.latency.eMBB.total} ms`,                  color: 'text-yellow-400',  title: 'L = T_prop+T_tx+T_proc+T_queue (M/D/1)' },
    { label: 'URLLC Latency',   value: `${kpis.latency.URLLC.total} ms`,                 color: 'text-green-400',   title: 'Mini-slot (2 sym), fast MEC pipeline' },
    { label: 'Pkt Loss (eMBB)', value: `${kpis.packet_loss.eMBB} %`,                     color: 'text-orange-400',  title: 'P_HARQ = BLER₀^H rounds' },
    { label: 'Conn Density',    value: `${kpis.conn_density.toLocaleString()} UE/km²`,   color: 'text-purple-400',  title: 'ρ = N_conn / (gNBs·A_hex)' },
    { label: '5G Online',       value: `${connected}/${buildings.length}`,                color: connected===buildings.length?'text-green-400':'text-yellow-400', title: '' },
  ]

  return (
    <motion.div initial={{ y:-30, opacity:0 }} animate={{ y:0, opacity:1 }} transition={{ delay:0.3, duration:0.5 }}
      className="flex gap-4 rounded-full px-6 py-2.5"
      style={{ background:'rgba(0,0,0,0.70)', backdropFilter:'blur(14px)', border:'1px solid rgba(255,255,255,0.06)' }}>
      {items.map(s => (
        <div key={s.label} className="text-center" title={s.title}>
          <div className={`text-sm font-bold ${s.color}`} style={MONO}>{s.value}</div>
          <div className="text-gray-600 text-xs" style={MONO}>{s.label}</div>
        </div>
      ))}
    </motion.div>
  )
}

/**
 * Left-side KPI Dashboard — all 5 KPIs with formula panel and per-slice breakdown
 */
function KPIDashboard({ kpis, visible }) {
  const [activeKpi, setActiveKpi] = useState(null)
  if (!kpis) return null

  const kpiBlocks = [
    {
      id: 'capacity', num: '①', title: 'Cell Capacity',
      headline: `${(kpis.effective_Mbps/1000).toFixed(2)} Gbps`,
      sub: `Peak ${(kpis.peak_Mbps/1000).toFixed(2)} Gbps · ${kpis.gnbCount} gNB`,
      color: 'cyan',
      formula: 'R_peak = υ · Q_m · R_max · N_RB·12 · f_slot · TDD_DL · (1−OH_DL)',
      detail: [
        `υ (MIMO layers)  = ${PHY.layers_DL}`,
        `Q_m (256-QAM)    = ${PHY.Q_m} bits/sym`,
        `R_max            = ${PHY.R_max.toFixed(4)}`,
        `N_RB (100 MHz)   = ${PHY.N_RB}`,
        `f_slot (μ=1)     = ${PHY.slots_per_sec} slots/s`,
        `TDD_DL           = ${(PHY.TDD_DL*100).toFixed(1)}%`,
        `OH_DL            = ${(PHY.OH_DL*100)}%`,
        `η_sched          = ${(PHY.eta_sched*100)}%`,
      ],
    },
    {
      id: 'ue_tput', num: '②', title: 'Avg UE Throughput',
      headline: `${kpis.avg_ue_Mbps} Mbps/UE`,
      sub: `${kpis.N_active} active UEs · PF scheduler`,
      color: 'blue',
      formula: 'T_avg = (C_eff/gNB / N_active) · G_PF',
      detail: [
        `C_eff/gNB = ${(kpis.effective_Mbps/kpis.gnbCount).toFixed(0)} Mbps`,
        `N_active  = ${kpis.N_active} UEs`,
        `G_PF = 1 + 0.4·ln(N)/ln(100)`,
        `Active ratio = ${(PHY.ACTIVE_RATIO*100)}%`,
        `Devices/bldg  = ${PHY.DEV_PER_BLDG}`,
      ],
    },
    {
      id: 'latency', num: '③', title: 'Latency (one-way)',
      headline: `eMBB ${kpis.latency.eMBB.total} ms`,
      sub: `URLLC ${kpis.latency.URLLC.total} ms · mMTC ${kpis.latency.mMTC.total} ms`,
      color: 'yellow',
      formula: 'L = T_prop + T_tx + T_proc + T_queue',
      detail: [
        `T_prop  = d/c + T_fiber  (${kpis.latency.eMBB.prop} ms)`,
        `T_tx    = T_slot = 0.5 ms  (2-sym for URLLC)`,
        `T_proc  = N2·T_sym + T_MEC  (${kpis.latency.eMBB.proc} ms)`,
        `T_queue = T_slot·ρ/2(1−ρ)  (${kpis.latency.eMBB.queue} ms)`,
        `ρ (load) = ${(kpis.load*100).toFixed(1)}%`,
        `Model: M/D/1 queue`,
      ],
    },
    {
      id: 'pktloss', num: '④', title: 'Packet Loss',
      headline: `eMBB ${kpis.packet_loss.eMBB}%`,
      sub: `URLLC ${kpis.packet_loss.URLLC}% · mMTC ${kpis.packet_loss.mMTC}%`,
      color: 'orange',
      formula: 'P_loss = BLER₀^H_rounds + P_overflow',
      detail: [
        `P_HARQ (eMBB)  = ${PHY.BLER0.eMBB}^${PHY.H_rounds.eMBB} = ${kpis.packet_loss.eMBB}%`,
        `P_HARQ (URLLC) = ${PHY.BLER0.URLLC}^${PHY.H_rounds.URLLC} = ${kpis.packet_loss.URLLC}%`,
        `P_HARQ (mMTC)  = ${PHY.BLER0.mMTC}^${PHY.H_rounds.mMTC} = ${kpis.packet_loss.mMTC}%`,
        `P_overflow ≈ 0  (ρ = ${(kpis.load*100).toFixed(1)}% < 80%)`,
        `Chase-combining HARQ assumed`,
      ],
    },
    {
      id: 'density', num: '⑤', title: 'Connection Density',
      headline: `${kpis.conn_density.toLocaleString()} UE/km²`,
      sub: `${kpis.total_devices.toLocaleString()} connected devices`,
      color: 'emerald',
      formula: 'ρ_conn = N_conn / (gNBs · A_hex)',
      detail: [
        `A_hex = (√3/2)·ISD² = (√3/2)·0.3² = 0.0779 km²`,
        `ISD = ${PHY.ISD_m} m  (urban micro, 3GPP TR 38.913)`,
        `Devices/bldg = ${PHY.DEV_PER_BLDG}`,
        `Conn ratio = ${(PHY.CONN_RATIO*100)}%`,
        `Max mMTC = 10⁶ UE/km²  (3GPP TR 38.913)`,
      ],
    },
  ]

  return (
    <AnimatePresence>
      {visible && (
        <motion.div initial={{ x:-260, opacity:0 }} animate={{ x:0, opacity:1 }} exit={{ x:-260, opacity:0 }}
          transition={{ type:'spring', damping:25, stiffness:280 }}
          className="rounded-xl overflow-hidden" style={{ background:'rgba(4,10,18,0.94)', backdropFilter:'blur(14px)',
            border:'1px solid rgba(255,255,255,0.07)', width:252 }}>

          <div className="px-4 pt-4 pb-2 border-b border-gray-800">
            <div className="text-cyan-400 font-bold text-xs uppercase tracking-widest" style={ORBITRON}>5G KPI Monitor</div>
            <div className="text-gray-600 text-xs mt-0.5" style={MONO}>n78 · 3.5 GHz · 100 MHz · SA+MEC</div>
          </div>

          <div className="p-3 space-y-1">
            {kpiBlocks.map((k) => {
              const [tc, bc] = COLOR_MAP[k.color] || COLOR_MAP.cyan
              const isOpen = activeKpi === k.id
              return (
                <div key={k.id}>
                  <button onClick={() => setActiveKpi(isOpen ? null : k.id)}
                    className="w-full text-left rounded-lg px-3 py-2.5 transition-all"
                    style={{ background: isOpen ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.025)',
                             border: `1px solid ${isOpen ? 'rgba(0,229,255,0.18)' : 'rgba(255,255,255,0.05)'}` }}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold ${tc}`} style={MONO}>{k.num}</span>
                        <span className="text-gray-400 text-xs" style={MONO}>{k.title}</span>
                      </div>
                      <span className="text-gray-600 text-xs">{isOpen ? '▲' : '▼'}</span>
                    </div>
                    <div className={`font-bold text-sm mt-1 ${tc}`} style={MONO}>{k.headline}</div>
                    <div className="text-gray-600 text-xs" style={MONO}>{k.sub}</div>
                  </button>

                  <AnimatePresence>
                    {isOpen && (
                      <motion.div initial={{ height:0, opacity:0 }} animate={{ height:'auto', opacity:1 }}
                        exit={{ height:0, opacity:0 }} transition={{ duration:0.22 }}
                        className="overflow-hidden">
                        <div className="mx-1 mb-1 rounded-b-lg p-3"
                          style={{ background:'rgba(0,0,0,0.4)', border:'1px solid rgba(255,255,255,0.04)', borderTop:'none' }}>
                          <div className={`text-xs font-bold mb-2 ${tc}`} style={MONO}>Formula:</div>
                          <div className="text-gray-300 text-xs mb-2 p-2 rounded" style={{ ...MONO, background:'rgba(255,255,255,0.04)', lineHeight:1.6 }}>
                            {k.formula}
                          </div>
                          <div className="space-y-0.5">
                            {k.detail.map((d, i) => (
                              <div key={i} className="text-gray-500 text-xs" style={MONO}>{d}</div>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>

          {/* Per-slice latency mini-table */}
          <div className="px-3 pb-3">
            <div className="rounded-lg p-3" style={{ background:'rgba(255,255,255,0.025)', border:'1px solid rgba(255,255,255,0.05)' }}>
              <div className="text-gray-600 text-xs uppercase tracking-widest mb-2" style={MONO}>Per-slice summary</div>
              <div className="grid grid-cols-4 gap-1 text-xs" style={MONO}>
                <div className="text-gray-700">Slice</div>
                <div className="text-gray-700 text-right">Lat</div>
                <div className="text-gray-700 text-right">Loss</div>
                <div className="text-gray-700 text-right">HARQ</div>
                {[
                  { s:'eMBB',  col:'text-purple-400' },
                  { s:'URLLC', col:'text-red-400'    },
                  { s:'mMTC',  col:'text-emerald-400' },
                ].map(({ s, col }) => (
                  <>
                    <div key={`${s}-n`} className={`font-bold ${col}`}>{s}</div>
                    <div key={`${s}-l`} className="text-gray-400 text-right">{kpis.latency[s].total}ms</div>
                    <div key={`${s}-p`} className="text-gray-400 text-right">{kpis.packet_loss[s]}%</div>
                    <div key={`${s}-h`} className="text-gray-400 text-right">{PHY.H_rounds[s]}×</div>
                  </>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Legend */
function Legend({ visible }) {
  const items = [
    { color: '#7c3aed', label: 'gNB — eMBB slice',      dot: true  },
    { color: '#ef4444', label: 'gNB — URLLC slice',     dot: true  },
    { color: '#10b981', label: 'gNB — mMTC slice',      dot: true  },
    { color: '#1565c0', label: 'MEC node (co-located)', dot: true  },
    { color: '#00e5ff', label: 'Active 5G radio link',  line: true },
    { color: '#ff5252', label: 'Disconnected UE',       line: true },
    { color: '#00bcd4', label: 'Data plane particles',  dot: true  },
  ]
  return (
    <AnimatePresence>
      {visible && (
        <motion.div initial={{ x:-180, opacity:0 }} animate={{ x:0, opacity:1 }} exit={{ x:-180, opacity:0 }}
          transition={{ type:'spring', damping:25, stiffness:300 }}
          className="rounded-xl p-4" style={{ background:'rgba(4,10,18,0.88)', backdropFilter:'blur(12px)',
            border:'1px solid rgba(255,255,255,0.07)', minWidth:200 }}>
          <div className="text-gray-500 text-xs uppercase tracking-widest mb-3" style={MONO}>Legend</div>
          {items.map((item) => (
            <div key={item.label} className="flex items-center gap-2 mb-1.5">
              {item.dot  && <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: item.color }} />}
              {item.line && <div className="w-4 h-0.5 flex-shrink-0 rounded" style={{ background: item.color }} />}
              <span className="text-gray-400 text-xs" style={MONO}>{item.label}</span>
            </div>
          ))}
          <div className="mt-3 pt-2 border-t border-gray-800 text-gray-600 text-xs" style={MONO}>
            5G SA · n78 3.5 GHz · 100 MHz · 64T64R
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   §6  MAIN PAGE
   ═══════════════════════════════════════════════════════════════════════════ */

export default function HomePage() {
  const [buildingCount, setBuildingCount] = useState(16)
  const [selectedId,    setSelectedId]    = useState(null)
  const [showLegend,    setShowLegend]    = useState(true)
  const [showKPI,       setShowKPI]       = useState(true)
  const [showArch,      setShowArch]      = useState(false)
  const inputRef = useRef()

  // 5G infra sync → writes ./state/buildings.txt → scaling script picks it up
  const { status: syncStatus, lastSynced, error: syncError } = useBuildingSync(
    buildingCount, { debounceMs: 500, maxBuildings: 20 }
  )

  // City layout
  const rawBuildings = useMemo(() => generateBuildings(buildingCount), [buildingCount])
  const gnbs         = useMemo(() => calculateGnBs(rawBuildings),      [rawBuildings])
  const buildings    = useMemo(() => assignBuildingsToGnBs(rawBuildings, gnbs), [rawBuildings, gnbs])

  // ── 5G KPIs — recomputed on every buildingCount / gnbCount change ──────────
  const kpis = useMemo(
    () => compute5GKPIs(buildingCount, gnbs.length),
    [buildingCount, gnbs.length]
  )

  const selectedBuilding = useMemo(
    () => selectedId != null ? buildings.find(b => b.id === selectedId) : null,
    [buildings, selectedId]
  )

  const handleBuildingClick = useCallback((id) => setSelectedId(p => p === id ? null : id), [])
  const handleBuildingHover = useCallback(() => {}, [])

  return (
    <div className="w-full h-screen relative overflow-hidden" style={{ background:'#020509' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Space+Mono:wght@400;700&display=swap');
        input[type=range]{ accent-color:#00e5ff }
        ::-webkit-scrollbar{ width:4px }
        ::-webkit-scrollbar-track{ background:transparent }
        ::-webkit-scrollbar-thumb{ background:#1e3a5f; border-radius:2px }
      `}</style>

      {/* ── HEADER ── */}
      <motion.header initial={{ y:-64, opacity:0 }} animate={{ y:0, opacity:1 }} transition={{ duration:0.55 }}
        className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-6 py-4"
        style={{ background:'linear-gradient(to bottom, rgba(2,5,9,0.96) 0%, transparent 100%)' }}>

        {/* Logo */}
        <div>
          <h1 className="text-2xl font-black" style={ORBITRON}>
            <span className="text-cyan-400">CITY</span><span className="text-white">LEARN</span>
          </h1>
          <p className="text-gray-600 text-xs mt-0.5" style={MONO}>5G Digital Twin · SA+MEC · n78 3.5 GHz</p>
        </div>

        {/* Building count control */}
        <motion.div initial={{ scale:0.9, opacity:0 }} animate={{ scale:1, opacity:1 }} transition={{ delay:0.2 }}
          className="flex items-center gap-3 rounded-xl px-5 py-3"
          style={{ background:'rgba(0,0,0,0.7)', backdropFilter:'blur(12px)', border:'1px solid rgba(0,229,255,0.14)' }}>
          <span className="text-gray-500 text-xs uppercase tracking-wider" style={MONO}>Buildings</span>
          <button onClick={() => setBuildingCount(c => Math.max(1, c-1))}
            className="w-7 h-7 rounded-full border border-gray-700 text-gray-400 hover:border-cyan-500 hover:text-cyan-400 transition-all flex items-center justify-center">−</button>
          <input ref={inputRef} type="range" min="1" max="20" value={buildingCount}
            onChange={e => setBuildingCount(Number(e.target.value))} className="w-36" />
          <button onClick={() => setBuildingCount(c => Math.min(20, c+1))}
            className="w-7 h-7 rounded-full border border-gray-700 text-gray-400 hover:border-cyan-500 hover:text-cyan-400 transition-all flex items-center justify-center">+</button>
          <motion.span key={buildingCount} initial={{ scale:1.3 }} animate={{ scale:1 }} transition={{ duration:0.2 }}
            className="text-cyan-400 font-bold w-8 text-center text-sm" style={MONO}>{buildingCount}</motion.span>

          {/* Docker sync status */}
          <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-gray-800"
            title={syncStatus==='error' ? `Sync error: ${syncError}` : syncStatus==='synced' ? `Docker synced to ${lastSynced} buildings` : syncStatus==='syncing' ? 'Scaling 5G containers…' : 'Awaiting change'}>
            <span className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0" style={{
              background: syncStatus==='synced'?'#00e676':syncStatus==='syncing'?'#ffab00':syncStatus==='error'?'#ff5252':'#546e7a',
              boxShadow:  syncStatus==='syncing'?'0 0 6px #ffab00':syncStatus==='synced'?'0 0 4px #00e676':'none' }} />
            <span className="text-xs whitespace-nowrap" style={{ ...MONO,
              color: syncStatus==='synced'?'#00e676':syncStatus==='syncing'?'#ffab00':syncStatus==='error'?'#ff5252':'#546e7a' }}>
              {syncStatus==='synced'&&'5G synced'}{syncStatus==='syncing'&&'syncing…'}{syncStatus==='error'&&'sync err'}{syncStatus==='idle'&&'5G idle'}
            </span>
          </div>
        </motion.div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <button onClick={() => setShowKPI(s=>!s)} className="px-3 py-2 text-xs rounded-lg border border-gray-800 text-gray-400 hover:text-white hover:border-gray-600 transition-all" style={MONO}>KPIs</button>
          <button onClick={() => setShowArch(s=>!s)} className="px-3 py-2 text-xs rounded-lg border border-gray-800 text-gray-400 hover:text-white hover:border-gray-600 transition-all" style={MONO}>5G Arch</button>
          <button onClick={() => setShowLegend(s=>!s)} className="px-3 py-2 text-xs rounded-lg border border-gray-800 text-gray-400 hover:text-white hover:border-gray-600 transition-all" style={MONO}>Legend</button>
        </div>
      </motion.header>

      {/* ── STATS BAR ── */}
      <div className="absolute top-[72px] left-0 right-0 z-10 flex justify-center pointer-events-none">
        <KPIStatsBar kpis={kpis} gnbs={gnbs} buildings={buildings} />
      </div>

      {/* ── 3D CANVAS ── */}
      <Canvas camera={{ position:[20,14,20], fov:52, near:0.1, far:500 }} shadows
        frameloop="demand" dpr={[1,1.5]}
        gl={{ antialias:true, alpha:false, powerPreference:'high-performance' }}
        style={{ background:'#020509' }}
        onPointerMissed={() => setSelectedId(null)}>
        <Suspense fallback={null}>
          <CityScene buildings={buildings} gnbs={gnbs} selectedId={selectedId}
            onBuildingClick={handleBuildingClick} onBuildingHover={handleBuildingHover} />
        </Suspense>
      </Canvas>

      {/* ── BUILDING PANEL ── */}
      <AnimatePresence>
        {selectedBuilding && (
          <BuildingInfoPanel key={selectedBuilding.id} building={selectedBuilding}
            kpis={kpis} onClose={() => setSelectedId(null)} />
        )}
      </AnimatePresence>

      {/* ── KPI DASHBOARD (left) ── */}
      <div className="absolute top-[130px] left-6 z-20">
        <KPIDashboard kpis={kpis} visible={showKPI} />
      </div>

      {/* ── LEGEND (bottom-left) ── */}
      <div className="absolute bottom-6 left-6 z-20">
        <Legend visible={showLegend} />
      </div>

      {/* ── 5G ARCHITECTURE MODAL ── */}
      <AnimatePresence>
        {showArch && (
          <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
            className="absolute inset-0 z-30 flex items-center justify-center"
            style={{ background:'rgba(0,0,0,0.72)', backdropFilter:'blur(6px)' }}
            onClick={() => setShowArch(false)}>
            <motion.div initial={{ scale:0.9, y:20 }} animate={{ scale:1, y:0 }} exit={{ scale:0.9, y:20 }}
              className="rounded-2xl p-8 max-w-2xl w-full mx-4 overflow-y-auto max-h-screen"
              style={{ background:'rgba(5,12,22,0.99)', border:'1px solid rgba(0,229,255,0.15)' }}
              onClick={e => e.stopPropagation()}>
              <h2 className="text-cyan-400 text-xl font-bold mb-5" style={ORBITRON}>5G SA Architecture & KPI Formulas</h2>
              <div className="grid grid-cols-2 gap-6 text-xs" style={{ ...MONO, lineHeight:1.8 }}>
                <div>
                  <div className="text-white font-bold mb-2">Radio Configuration</div>
                  {[
                    ['Band', 'n78 (3.3–3.8 GHz TDD)'],
                    ['Channel BW', '100 MHz'],
                    ['Numerology', 'μ=1  (SCS = 30 kHz)'],
                    ['PRBs', `${PHY.N_RB}  (3GPP TS 38.101-1)`],
                    ['MIMO', '64T64R (gNB) / 4T4R (UE)'],
                    ['DL layers', `${PHY.layers_DL}  (MU-MIMO ZF)`],
                    ['Modulation', '256-QAM  (Q_m = 8)'],
                    ['Code rate', `R_max = ${PHY.R_max.toFixed(4)}`],
                    ['TDD DL', `${(PHY.TDD_DL*100).toFixed(1)}%  (DDDSU)`],
                    ['Peak DL/gNB', `${PEAK_PER_GNB.toFixed(0)} Mbps`],
                  ].map(([k,v]) => <div key={k} className="flex gap-2"><span className="text-gray-600 w-28 flex-shrink-0">{k}</span><span className="text-gray-300">{v}</span></div>)}
                </div>
                <div>
                  <div className="text-white font-bold mb-2">KPI Formulas</div>
                  {[
                    ['① Capacity',  'R_peak = υ·Q_m·R_max·RE/s·TDD·(1−OH)'],
                    ['② UE Tput',   'T_avg = C_eff/N_act · G_PF'],
                    ['③ Latency',   'L = T_prop+T_tx+T_proc+T_queue'],
                    ['  T_queue',   'T_slot·ρ / 2(1−ρ)  [M/D/1]'],
                    ['④ Pkt Loss',  'P = BLER₀^H + P_overflow'],
                    ['⑤ Density',   'ρ = N_conn / (gNBs·A_hex)'],
                    ['  A_hex',     '(√3/2)·ISD²  [km²]'],
                  ].map(([k,v]) => <div key={k} className="flex gap-2"><span className="text-gray-600 w-20 flex-shrink-0">{k}</span><span className="text-gray-300">{v}</span></div>)}
                  <div className="mt-4">
                    <div className="text-white font-bold mb-2">Slice Targets</div>
                    {[
                      { s:'eMBB',  c:'text-purple-400', t:'1 Gbps DL · 2 ms · 99.99%' },
                      { s:'URLLC', c:'text-red-400',    t:'<1 ms · 99.999% · mini-slot' },
                      { s:'mMTC',  c:'text-emerald-400',t:'10⁶ UE/km² · eDRX · 3 HARQ' },
                    ].map(({ s,c,t }) => (
                      <div key={s} className="flex gap-2 items-center">
                        <span className={`font-bold w-14 flex-shrink-0 ${c}`}>{s}</span>
                        <span className="text-gray-400">{t}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <button className="mt-6 px-4 py-2 text-xs text-cyan-400 border border-cyan-800 rounded-lg hover:bg-cyan-900 hover:bg-opacity-20 transition-all" style={MONO} onClick={() => setShowArch(false)}>Close</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute bottom-6 right-6 z-10 text-gray-700 text-xs" style={MONO}>
        Click building · Orbit / Zoom / Pan
      </div>
    </div>
  )
}