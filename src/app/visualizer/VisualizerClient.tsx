"use client";

import { useState } from "react";
import Cube3D from "@/components/Cube3D";
import SignalVisualizer from "@/components/SignalVisualizer";

type VisualizerMode = "cube" | "signal" | "network" | "magnet";

const MODES: { id: VisualizerMode; label: string; emoji: string; desc: string }[] = [
  { id: "cube", label: "3D Cube", emoji: "🧊", desc: "Interactive 3D geometry — drag to rotate" },
  { id: "signal", label: "Signal Wave", emoji: "📡", desc: "Hydrogen signal propagation canvas" },
  { id: "network", label: "P2P Network", emoji: "🌐", desc: "Decentralized node topology" },
  { id: "magnet", label: "Magnet Field", emoji: "🧲", desc: "NdFeB rare earth field lines" },
];

const CUBE_CONFIGS: { label: string; color1: string; color2: string; size: number }[] = [
  { label: "Purple / Cyan", color1: "#7c3aed", color2: "#06b6d4", size: 220 },
  { label: "Gold / Green", color1: "#f59e0b", color2: "#10b981", size: 220 },
  { label: "Red / Blue", color1: "#ef4444", color2: "#3b82f6", size: 220 },
];

export default function VisualizerClient() {
  const [mode, setMode] = useState<VisualizerMode>("cube");
  const [signalActive, setSignalActive] = useState(false);
  const [cubeConfig, setCubeConfig] = useState(0);

  return (
    <div className="max-w-5xl mx-auto px-4 py-16">
      {/* Header */}
      <section aria-labelledby="viz-heading" className="mb-12 text-center">
        <h1
          id="viz-heading"
          className="text-4xl sm:text-5xl font-extrabold text-white mb-4"
        >
          3D Visualizer
        </h1>
        <p className="text-purple-200/60 text-lg max-w-2xl mx-auto">
          Interactive renderings of the technologies powering Infinity OS.
          Drag, click, and explore.
        </p>
      </section>

      {/* Mode selector */}
      <div
        className="flex flex-wrap gap-2 justify-center mb-10"
        role="tablist"
        aria-label="Visualizer modes"
      >
        {MODES.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={mode === m.id}
            aria-controls={`panel-${m.id}`}
            onClick={() => setMode(m.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              mode === m.id
                ? "bg-gradient-to-r from-purple-600 to-cyan-600 text-white"
                : "glass-card border border-purple-800/30 text-purple-300 hover:text-white"
            }`}
          >
            <span aria-hidden="true">{m.emoji}</span>
            {m.label}
          </button>
        ))}
      </div>

      {/* Panels */}
      <div className="glass-card rounded-2xl border border-purple-800/30 overflow-hidden">
        {/* Cube panel */}
        <div
          id="panel-cube"
          role="tabpanel"
          aria-labelledby="tab-cube"
          hidden={mode !== "cube"}
          className="p-8"
        >
          <h2 className="text-lg font-bold text-white mb-2">Interactive 3D Cube</h2>
          <p className="text-sm text-purple-300/60 mb-6">
            Click and drag the cube to rotate it. Represents the 3-dimensional signal
            propagation model used in Infinity OS nodes.
          </p>

          {/* Color selector */}
          <div className="flex gap-2 mb-6" role="group" aria-label="Cube color scheme">
            {CUBE_CONFIGS.map((cfg, i) => (
              <button
                key={cfg.label}
                onClick={() => setCubeConfig(i)}
                className={`px-3 py-1 rounded text-xs font-semibold border transition-all ${
                  cubeConfig === i
                    ? "border-purple-500 text-purple-300 bg-purple-900/40"
                    : "border-purple-800/30 text-purple-500 hover:border-purple-600"
                }`}
                aria-pressed={cubeConfig === i}
                aria-label={`${cfg.label} color scheme`}
              >
                {cfg.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap justify-center gap-8">
            <Cube3D
              color1={CUBE_CONFIGS[cubeConfig].color1}
              color2={CUBE_CONFIGS[cubeConfig].color2}
              size={CUBE_CONFIGS[cubeConfig].size}
              label="3D rotating signal cube — drag to interact"
            />
            <div className="max-w-xs">
              <h3 className="font-semibold text-white mb-3">Signal Geometry</h3>
              <ul className="space-y-2 text-sm text-purple-300/70">
                {[
                  "Each face represents a signal band",
                  "Rotation models orbital phase shifting",
                  "Color gradient maps to signal intensity",
                  "Drag to explore 3D topology",
                  "Used in antenna array optimization",
                ].map((item, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-cyan-500 font-bold">→</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Signal panel */}
        <div
          id="panel-signal"
          role="tabpanel"
          aria-labelledby="tab-signal"
          hidden={mode !== "signal"}
          className="p-8"
        >
          <h2 className="text-lg font-bold text-white mb-2">Hydrogen Signal Propagation</h2>
          <p className="text-sm text-purple-300/60 mb-6">
            Live visualization of the 1420.405 MHz hydrogen carrier wave. Toggle the
            signal to see P2P packet emission from the node center.
          </p>
          <SignalVisualizer active={signalActive} height={300} />
          <div className="mt-6 flex justify-center">
            <button
              onClick={() => setSignalActive((v) => !v)}
              className={`px-8 py-3 rounded-xl font-bold transition-all ${
                signalActive
                  ? "bg-red-600/80 hover:bg-red-600 text-white"
                  : "bg-gradient-to-r from-purple-600 to-cyan-600 text-white hover:from-purple-500 hover:to-cyan-500"
              }`}
              aria-pressed={signalActive}
              aria-label={signalActive ? "Stop signal emission" : "Start signal emission"}
            >
              {signalActive ? "⛔ Stop Signal" : "⚡ Start Signal"}
            </button>
          </div>
        </div>

        {/* Network panel */}
        <div
          id="panel-network"
          role="tabpanel"
          aria-labelledby="tab-network"
          hidden={mode !== "network"}
          className="p-8"
        >
          <h2 className="text-lg font-bold text-white mb-2">P2P Network Topology</h2>
          <p className="text-sm text-purple-300/60 mb-6">
            Visualizing how emoji identifiers map to DHT nodes in a decentralized network.
          </p>
          <div className="relative h-64 rounded-xl overflow-hidden border border-purple-800/30 bg-purple-950/30">
            {/* Static SVG network diagram */}
            <svg
              className="w-full h-full"
              viewBox="0 0 500 250"
              aria-label="P2P network topology diagram showing 7 interconnected nodes"
              role="img"
            >
              {/* Edges */}
              {[
                [250, 125, 100, 60], [250, 125, 400, 60],
                [250, 125, 80, 175], [250, 125, 420, 175],
                [250, 125, 160, 200], [250, 125, 340, 200],
                [100, 60, 400, 60], [80, 175, 160, 200],
              ].map(([x1, y1, x2, y2], i) => (
                <line
                  key={i}
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="rgba(124,58,237,0.3)"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                />
              ))}

              {/* Nodes */}
              {[
                { x: 250, y: 125, emoji: "😎🟦", label: "Central Node" },
                { x: 100, y: 60, emoji: "🛸🟦", label: "Node A" },
                { x: 400, y: 60, emoji: "🌻🟨", label: "Node B" },
                { x: 80, y: 175, emoji: "🔮🟥", label: "Node C" },
                { x: 420, y: 175, emoji: "⚡🟩", label: "Node D" },
                { x: 160, y: 200, emoji: "🎯🟦", label: "Node E" },
                { x: 340, y: 200, emoji: "🦊🟥", label: "Node F" },
              ].map((node) => (
                <g key={node.label} role="listitem" aria-label={`${node.label}: ${node.emoji}`}>
                  <circle
                    cx={node.x} cy={node.y} r="20"
                    fill="rgba(124,58,237,0.2)"
                    stroke="rgba(124,58,237,0.6)"
                    strokeWidth="1.5"
                  />
                  <text
                    x={node.x} y={node.y + 5}
                    textAnchor="middle"
                    fontSize="12"
                    fill="white"
                    aria-hidden="true"
                  >
                    {node.emoji.slice(0, 2)}
                  </text>
                </g>
              ))}
            </svg>
          </div>
          <p className="text-center text-xs text-purple-400/50 mt-3">
            Each node has a unique emoji ID — P2P routing via DHT
          </p>
        </div>

        {/* Magnet panel */}
        <div
          id="panel-magnet"
          role="tabpanel"
          aria-labelledby="tab-magnet"
          hidden={mode !== "magnet"}
          className="p-8"
        >
          <h2 className="text-lg font-bold text-white mb-2">NdFeB Magnetic Field Lines</h2>
          <p className="text-sm text-purple-300/60 mb-6">
            Visualization of the rare earth neodymium-iron-boron magnetic field used
            to stabilize hydrogen signal oscillators in Infinity OS nodes.
          </p>
          <div className="flex justify-center">
            <svg
              viewBox="0 0 400 300"
              className="w-full max-w-md rounded-xl border border-purple-800/30"
              aria-label="NdFeB rare earth magnet field line diagram"
              role="img"
            >
              <rect width="400" height="300" fill="rgba(10,10,26,0.8)" />

              {/* Field lines */}
              {Array.from({ length: 8 }, (_, i) => {
                const offset = (i - 3.5) * 18;
                return (
                  <path
                    key={i}
                    d={`M 200 150 C ${200 + offset * 3} ${80 - Math.abs(offset) * 0.5}, ${200 + offset * 5} ${40 - Math.abs(offset)}, ${200 + offset * 2} 20`}
                    fill="none"
                    stroke={`rgba(124,58,237,${0.3 + (1 - Math.abs(i - 3.5) / 4) * 0.5})`}
                    strokeWidth="1.5"
                    strokeDasharray="none"
                  />
                );
              })}
              {Array.from({ length: 8 }, (_, i) => {
                const offset = (i - 3.5) * 18;
                return (
                  <path
                    key={`bottom-${i}`}
                    d={`M 200 150 C ${200 + offset * 3} ${220 + Math.abs(offset) * 0.5}, ${200 + offset * 5} ${260 + Math.abs(offset)}, ${200 + offset * 2} 280`}
                    fill="none"
                    stroke={`rgba(6,182,212,${0.3 + (1 - Math.abs(i - 3.5) / 4) * 0.5})`}
                    strokeWidth="1.5"
                  />
                );
              })}

              {/* Magnet body */}
              <rect x="170" y="130" width="60" height="40" rx="4"
                fill="rgba(124,58,237,0.3)"
                stroke="rgba(124,58,237,0.8)"
                strokeWidth="2"
              />
              <text x="200" y="155" textAnchor="middle" fill="white" fontSize="11" fontWeight="bold">
                NdFeB
              </text>

              {/* Pole labels */}
              <text x="200" y="35" textAnchor="middle" fill="rgba(239,68,68,0.8)" fontSize="14" fontWeight="bold">N</text>
              <text x="200" y="290" textAnchor="middle" fill="rgba(59,130,246,0.8)" fontSize="14" fontWeight="bold">S</text>
            </svg>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
            <div className="glass-card rounded-xl p-4 border border-red-500/20">
              <p className="text-red-400 font-semibold mb-1">North Pole (N)</p>
              <p className="text-purple-300/60 text-xs">Field lines emerge, used for signal amplification in antenna arrays</p>
            </div>
            <div className="glass-card rounded-xl p-4 border border-blue-500/20">
              <p className="text-blue-400 font-semibold mb-1">South Pole (S)</p>
              <p className="text-purple-300/60 text-xs">Field lines enter, provides oscillator ground reference</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
