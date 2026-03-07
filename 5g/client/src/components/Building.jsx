import { useRef, useState, useMemo, useCallback } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/* ─────────────────────────────────────────────
   SUB-COMPONENTS
───────────────────────────────────────────── */

/** Grid of window boxes across one facade */
function WindowGrid({ height, width, depth }) {
    const windows = useMemo(() => {
        const result = []
        const floorCount = Math.max(2, Math.floor(height / 0.5))
        const colCount = Math.max(2, Math.floor(width / 0.25))
        for (let f = 0; f < floorCount; f++) {
            for (let c = 0; c < colCount; c++) {
                const lit = Math.random() > 0.35
                const warm = Math.random() > 0.6
                result.push({
                    key: `${f}-${c}`,
                    x: -width / 2 + (width / colCount) * (c + 0.5),
                    y: -height / 2 + 0.3 + f * 0.5,
                    lit,
                    color: lit ? (warm ? '#ffe082' : '#e3f2fd') : '#0a1929',
                    emissive: lit ? (warm ? '#ff8f00' : '#1565c0') : '#000000',
                    intensity: lit ? 0.35 : 0,
                })
            }
        }
        return result
    }, [height, width])

    return (
        <group>
            {/* Front face windows */}
            {windows.map((w) => (
                <mesh key={`f-${w.key}`} position={[w.x, w.y, depth / 2 + 0.002]}>
                    <boxGeometry args={[width / (Math.floor(width / 0.25) * 1.8), 0.14, 0.005]} />
                    <meshStandardMaterial
                        color={w.color}
                        emissive={w.emissive}
                        emissiveIntensity={w.intensity}
                    />
                </mesh>
            ))}
            {/* Back face windows (mirrored) */}
            {windows.map((w) => (
                <mesh key={`b-${w.key}`} position={[w.x, w.y, -depth / 2 - 0.002]}>
                    <boxGeometry args={[width / (Math.floor(width / 0.25) * 1.8), 0.14, 0.005]} />
                    <meshStandardMaterial
                        color={w.color}
                        emissive={w.emissive}
                        emissiveIntensity={w.intensity}
                    />
                </mesh>
            ))}
        </group>
    )
}

/** Rooftop solar panel array — 3 tilted panels */
function SolarArray({ width, depth, solarOutput = 0.7 }) {
    const panelW = Math.max(0.12, width * 0.28)
    const panelD = Math.max(0.18, depth * 0.55)
    const outputColor = new THREE.Color()
        .setHSL(0.58 + solarOutput * 0.12, 0.8, 0.35 + solarOutput * 0.2)

    return (
        <group position={[0, 0.06, 0]}>
            {[-1, 0, 1].map((i) => (
                <mesh
                    key={i}
                    position={[i * (width * 0.3), 0.02, 0]}
                    rotation={[-0.35, 0, 0]}
                    castShadow
                >
                    <boxGeometry args={[panelW, 0.018, panelD]} />
                    <meshStandardMaterial
                        color={outputColor}
                        emissive={outputColor}
                        emissiveIntensity={solarOutput * 0.6}
                        metalness={0.9}
                        roughness={0.1}
                    />
                </mesh>
            ))}
            {/* Solar panel frame */}
            <mesh position={[0, 0.01, 0]}>
                <boxGeometry args={[width * 0.95, 0.01, depth * 0.6]} />
                <meshStandardMaterial color="#263238" metalness={0.6} roughness={0.4} />
            </mesh>
        </group>
    )
}

/** HVAC rooftop unit — box body + spinning fan cylinder */
function HVACUnit({ position }) {
    const fanRef = useRef()
    useFrame(() => {
        if (fanRef.current) fanRef.current.rotation.y += 0.06
    })
    return (
        <group position={position}>
            {/* Body */}
            <mesh castShadow>
                <boxGeometry args={[0.22, 0.13, 0.17]} />
                <meshStandardMaterial color="#546e7a" metalness={0.55} roughness={0.45} />
            </mesh>
            {/* Vent grille lines */}
            {[-0.05, 0, 0.05].map((z, i) => (
                <mesh key={i} position={[0, 0.065, z]}>
                    <boxGeometry args={[0.20, 0.008, 0.01]} />
                    <meshStandardMaterial color="#37474f" />
                </mesh>
            ))}
            {/* Fan disc on top */}
            <mesh ref={fanRef} position={[0, 0.095, 0]} castShadow>
                <cylinderGeometry args={[0.065, 0.065, 0.018, 8]} />
                <meshStandardMaterial color="#90a4ae" metalness={0.8} roughness={0.2} />
            </mesh>
            {/* Exhaust pipe */}
            <mesh position={[0.08, 0.02, 0]}>
                <cylinderGeometry args={[0.025, 0.025, 0.06, 6]} />
                <meshStandardMaterial color="#607d8b" metalness={0.7} roughness={0.3} />
            </mesh>
        </group>
    )
}

/** 5G building antenna — pole + glowing beacon + status light */
function Antenna5G({ position, connected }) {
    const beaconRef = useRef()
    const lightRef = useRef()

    useFrame(({ clock }) => {
        const t = clock.elapsedTime
        if (beaconRef.current) {
            // Pulse when connected, slow blink when offline
            beaconRef.current.material.emissiveIntensity = connected
                ? 0.6 + Math.sin(t * 4) * 0.4
                : 0.2 + Math.sin(t * 0.8) * 0.15
        }
        if (lightRef.current) {
            lightRef.current.intensity = connected
                ? 0.6 + Math.sin(t * 4) * 0.3
                : 0.1
        }
    })

    const statusColor = connected ? '#00e5ff' : '#ff5252'

    return (
        <group position={position}>
            {/* Mounting base */}
            <mesh position={[0, 0.03, 0]}>
                <cylinderGeometry args={[0.04, 0.05, 0.06, 8]} />
                <meshStandardMaterial color="#455a64" metalness={0.7} roughness={0.3} />
            </mesh>
            {/* Vertical pole */}
            <mesh position={[0, 0.22, 0]}>
                <cylinderGeometry args={[0.012, 0.015, 0.38, 6]} />
                <meshStandardMaterial color="#b0bec5" metalness={0.9} roughness={0.1} />
            </mesh>
            {/* Cross arm */}
            <mesh position={[0, 0.36, 0]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.008, 0.008, 0.18, 5]} />
                <meshStandardMaterial color="#b0bec5" metalness={0.9} roughness={0.1} />
            </mesh>
            {/* Antenna panel (main) */}
            <mesh position={[0, 0.30, 0.04]}>
                <boxGeometry args={[0.06, 0.16, 0.025]} />
                <meshStandardMaterial color="#37474f" metalness={0.6} roughness={0.4} />
            </mesh>
            {/* Signal beacon sphere */}
            <mesh ref={beaconRef} position={[0, 0.43, 0]}>
                <sphereGeometry args={[0.028, 12, 12]} />
                <meshStandardMaterial
                    color={statusColor}
                    emissive={statusColor}
                    emissiveIntensity={0.8}
                />
            </mesh>
            <pointLight ref={lightRef} position={[0, 0.43, 0]} color={statusColor} distance={2.5} decay={2} />
        </group>
    )
}

/** Battery energy storage unit — box + charge level strip */
function BatteryStorage({ position, batteryLevel = 0.6 }) {
    const levelColor =
        batteryLevel > 0.6 ? '#00e676' : batteryLevel > 0.25 ? '#ffab00' : '#ff5252'
    const levelEmissive =
        batteryLevel > 0.6 ? '#00c853' : batteryLevel > 0.25 ? '#ff6f00' : '#b71c1c'

    return (
        <group position={position}>
            {/* Housing */}
            <mesh castShadow>
                <boxGeometry args={[0.2, 0.12, 0.12]} />
                <meshStandardMaterial color="#1c313a" metalness={0.5} roughness={0.5} />
            </mesh>
            {/* Charge level bar (front face) */}
            <mesh
                position={[(-0.5 + batteryLevel / 2) * 0.18, 0, 0.062]}
                scale={[batteryLevel, 0.75, 1]}
            >
                <boxGeometry args={[0.18, 0.09, 0.006]} />
                <meshStandardMaterial
                    color={levelColor}
                    emissive={levelEmissive}
                    emissiveIntensity={0.45}
                />
            </mesh>
            {/* Terminal nubs */}
            {[-0.07, 0.07].map((x, i) => (
                <mesh key={i} position={[x, 0, -0.065]}>
                    <cylinderGeometry args={[0.012, 0.012, 0.02, 6]} rotation={[Math.PI / 2, 0, 0]} />
                    <meshStandardMaterial color="#78909c" metalness={0.8} roughness={0.2} />
                </mesh>
            ))}
        </group>
    )
}

/** Smart meter / EV charger at ground level */
function SmartMeter({ position, width }) {
    return (
        <group position={position}>
            <mesh>
                <boxGeometry args={[0.1, 0.28, 0.08]} />
                <meshStandardMaterial color="#263238" metalness={0.4} roughness={0.6} />
            </mesh>
            {/* Screen glow */}
            <mesh position={[0, 0.04, 0.041]}>
                <boxGeometry args={[0.065, 0.09, 0.005]} />
                <meshStandardMaterial color="#4dd0e1" emissive="#00acc1" emissiveIntensity={0.5} />
            </mesh>
            {/* Cable stub */}
            <mesh position={[0, -0.12, 0.04]} rotation={[0.3, 0, 0]}>
                <cylinderGeometry args={[0.008, 0.008, 0.06, 5]} />
                <meshStandardMaterial color="#37474f" />
            </mesh>
        </group>
    )
}

/** Animated selection/hover ring */
function SelectionRing({ radius }) {
    const ringRef = useRef()

    const curve = useMemo(() => {
        const pts = []
        for (let i = 0; i <= 80; i++) {
            const a = (i / 80) * Math.PI * 2
            pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius))
        }
        return pts
    }, [radius])

    const geo = useMemo(
        () => new THREE.BufferGeometry().setFromPoints(curve),
        [curve]
    )
    const mat = useMemo(
        () =>
            new THREE.LineBasicMaterial({
                color: '#00e5ff',
                transparent: true,
                opacity: 0.85,
            }),
        []
    )

    useFrame(({ clock }) => {
        if (ringRef.current) {
            ringRef.current.rotation.y += 0.015
            ringRef.current.scale.setScalar(
                1 + Math.sin(clock.elapsedTime * 2.5) * 0.04
            )
        }
    })

    return (
        <group ref={ringRef} position={[0, -0.05, 0]}>
            <primitive object={new THREE.Line(geo, mat)} />
        </group>
    )
}

/* ─────────────────────────────────────────────
   MAIN BUILDING COMPONENT
───────────────────────────────────────────── */

export default function Building({
    id = 0,
    position = [0, 0, 0],
    scale = 1,
    energyProfile = { solarOutput: 0.7, batteryLevel: 0.6, consumption: 45 },
    connected = true,
    sensors = { temperature: 22, humidity: 55, co2: 400 },
    isSelected = false,
    onClick,
    onHover,
}) {
    const groupRef = useRef()
    const [hovered, setHovered] = useState(false)

    // Deterministic height/width variation per building id
    const height = useMemo(
        () => 1.4 + (id % 7) * 0.55 + (id % 3) * 0.35,
        [id]
    )
    const width = useMemo(() => 0.68 + (id % 4) * 0.09, [id])
    const depth = useMemo(() => 0.68 + ((id + 2) % 4) * 0.09, [id])

    // Smooth Y lift on hover / selection
    useFrame(() => {
        if (!groupRef.current) return
        const targetY = hovered || isSelected ? 0.18 : 0
        groupRef.current.position.y +=
            (targetY - groupRef.current.position.y) * 0.09
    })

    const isActive = hovered || isSelected

    const handleOver = useCallback(
        (e) => {
            e.stopPropagation()
            setHovered(true)
            onHover?.(id)
            document.body.style.cursor = 'pointer'
        },
        [id, onHover]
    )
    const handleOut = useCallback(() => {
        setHovered(false)
        onHover?.(null)
        document.body.style.cursor = 'default'
    }, [onHover])
    const handleClick = useCallback(
        (e) => {
            e.stopPropagation()
            onClick?.(id)
        },
        [id, onClick]
    )

    return (
        <group
            ref={groupRef}
            position={position}
            scale={[scale, scale, scale]}
            onClick={handleClick}
            onPointerOver={handleOver}
            onPointerOut={handleOut}
        >
            {/* ── Foundation slab ── */}
            <mesh position={[0, -height / 2 - 0.03, 0]} receiveShadow>
                <boxGeometry args={[width + 0.12, 0.06, depth + 0.12]} />
                <meshStandardMaterial color="#1a2a35" roughness={0.85} />
            </mesh>

            {/* ── Ground-level lobby (wider base) ── */}
            <mesh position={[0, -height / 2 + 0.18, 0]} castShadow receiveShadow>
                <boxGeometry args={[width + 0.08, 0.36, depth + 0.08]} />
                <meshStandardMaterial
                    color={isSelected ? '#0d3a6a' : '#102030'}
                    metalness={0.5}
                    roughness={0.5}
                />
            </mesh>

            {/* ── Lobby entrance accent ── */}
            <mesh position={[0, -height / 2 + 0.18, depth / 2 + 0.05]}>
                <boxGeometry args={[width * 0.35, 0.3, 0.01]} />
                <meshStandardMaterial
                    color="#00e5ff"
                    emissive="#00e5ff"
                    emissiveIntensity={0.4}
                    transparent
                    opacity={0.8}
                />
            </mesh>

            {/* ── Main tower body ── */}
            <mesh castShadow receiveShadow>
                <boxGeometry args={[width, height, depth]} />
                <meshStandardMaterial
                    color={isSelected ? '#0a3055' : isActive ? '#0d2a45' : '#091e2e'}
                    emissive={isSelected ? '#0d47a1' : isActive ? '#0a2a50' : '#040d18'}
                    emissiveIntensity={isActive ? 0.35 : 0.08}
                    metalness={0.65}
                    roughness={0.38}
                />
            </mesh>

            {/* ── Floor separator lines ── */}
            {Array.from({ length: Math.floor(height / 0.5) }).map((_, i) => (
                <mesh key={i} position={[0, -height / 2 + 0.5 + i * 0.5, 0]}>
                    <boxGeometry args={[width + 0.004, 0.018, depth + 0.004]} />
                    <meshStandardMaterial
                        color="#1e3a5f"
                        emissive="#1e3a5f"
                        emissiveIntensity={0.2}
                    />
                </mesh>
            ))}

            {/* ── Window facade ── */}
            <WindowGrid height={height} width={width} depth={depth} />

            {/* ── Rooftop parapet ledge ── */}
            <mesh position={[0, height / 2 + 0.04, 0]}>
                <boxGeometry args={[width + 0.06, 0.08, depth + 0.06]} />
                <meshStandardMaterial color="#1c313a" metalness={0.4} roughness={0.6} />
            </mesh>

            {/* ── Rooftop systems ── */}
            <group position={[0, height / 2 + 0.06, 0]}>
                {/* Solar panels — back half of roof */}
                <group position={[0, 0, -depth * 0.1]}>
                    <SolarArray
                        width={width}
                        depth={depth}
                        solarOutput={energyProfile.solarOutput}
                    />
                </group>

                {/* HVAC — front-right */}
                <HVACUnit position={[width * 0.28, 0, depth * 0.2]} />

                {/* 5G Antenna — front-left */}
                <Antenna5G
                    position={[-width * 0.28, 0, depth * 0.15]}
                    connected={connected}
                />

                {/* Battery storage — rear-right */}
                <BatteryStorage
                    position={[width * 0.18, 0.06, -depth * 0.28]}
                    batteryLevel={energyProfile.batteryLevel}
                />
            </group>

            {/* ── Smart meter / EV charger at ground level ── */}
            <SmartMeter
                position={[width / 2 + 0.05, -height / 2 + 0.14, 0]}
                width={width}
            />

            {/* ── Selection / hover ring ── */}
            {isActive && (
                <SelectionRing radius={Math.max(width, depth) * 0.85 + 0.12} />
            )}

            {/* ── Selected ambient glow ── */}
            {isSelected && (
                <pointLight
                    color="#00e5ff"
                    intensity={1.2}
                    distance={5}
                    decay={2}
                    position={[0, 0, 0]}
                />
            )}
        </group>
    )
}