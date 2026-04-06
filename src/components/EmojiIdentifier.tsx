"use client";

import { useState, useCallback } from "react";
import { RefreshCw, Copy, CheckCircle, Wifi, Phone } from "lucide-react";
import type { EmojiIdentifier } from "@/types";

const EMOJI_POOL = [
  "😎", "🟦", "👌", "🟥", "🎷", "🟨", "♣️", "⬜",
  "🌻", "💃", "🐴", "🟩", "🛸", "🎸", "🦋", "🌊",
  "🔮", "⚡", "🎯", "🦊", "🌙", "🔥", "💎", "👑",
  "🎪", "🌈", "🦄", "🎭", "🎨", "🏆", "🚀", "🌿",
  "🍀", "🎵", "🎺", "🦅", "🌺", "🎋", "🐉", "⭐",
];

const COLOR_BLOCKS = ["🟦", "🟥", "🟨", "🟩", "🟧", "🟪", "⬜", "⬛"];

function generateEmojiId(seed?: string): string[] {
  const blocks: string[] = [];
  const allEmojis = [...EMOJI_POOL];

  if (seed) {
    // Deterministic shuffle based on seed
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0;
    }
    const rng = (n: number) => Math.abs((hash * (n + 1) * 2654435761) % allEmojis.length);
    for (let i = 0; i < 8; i++) {
      const idx = rng(i) % allEmojis.length;
      blocks.push(allEmojis[idx]);
      if (i % 2 === 1) {
        blocks[i] = COLOR_BLOCKS[Math.abs((hash * (i + 3)) % COLOR_BLOCKS.length)];
      }
    }
  } else {
    for (let i = 0; i < 8; i++) {
      if (i % 2 === 1) {
        blocks.push(COLOR_BLOCKS[Math.floor(Math.random() * COLOR_BLOCKS.length)]);
      } else {
        const filtered = allEmojis.filter((e) => !COLOR_BLOCKS.includes(e));
        blocks.push(filtered[Math.floor(Math.random() * filtered.length)]);
      }
    }
  }

  return blocks;
}

interface EmojiIdentifierProps {
  initialId?: EmojiIdentifier;
  showControls?: boolean;
  size?: "sm" | "md" | "lg";
  label?: string;
}

export default function EmojiIdentifierDisplay({
  initialId,
  showControls = true,
  size = "md",
  label,
}: EmojiIdentifierProps) {
  const [blocks, setBlocks] = useState<string[]>(
    initialId?.blocks ?? generateEmojiId()
  );
  const [copied, setCopied] = useState(false);
  const [active, setActive] = useState(false);

  const regenerate = useCallback(() => {
    setBlocks(generateEmojiId());
  }, []);

  const copyToClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(blocks.join(""));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: no-op if clipboard API unavailable
    }
  }, [blocks]);

  const sizeClasses = {
    sm: "w-8 h-8 text-lg",
    md: "w-12 h-12 text-2xl",
    lg: "w-16 h-16 text-3xl",
  };

  return (
    <div className="glass-card rounded-2xl p-6" role="region" aria-label={label ?? "Emoji device identifier"}>
      {label && (
        <p className="text-xs text-purple-400 uppercase tracking-widest mb-3 font-semibold">
          {label}
        </p>
      )}

      {/* Signal status */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setActive((v) => !v)}
          className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold transition-all ${
            active
              ? "bg-green-500/20 text-green-400 border border-green-500/40"
              : "bg-gray-700/40 text-gray-400 border border-gray-600/40"
          }`}
          aria-pressed={active}
          aria-label={active ? "Signal active — click to deactivate" : "Signal inactive — click to activate"}
        >
          <Wifi className="w-3 h-3" aria-hidden="true" />
          {active ? "SIGNAL ACTIVE" : "SIGNAL OFF"}
        </button>
        <Phone className="w-4 h-4 text-purple-400" aria-hidden="true" />
        <span className="text-xs text-purple-300">Hydrogen P2P</span>
      </div>

      {/* 8-block display */}
      <div
        className="flex gap-2 flex-wrap"
        role="group"
        aria-label="8-block emoji device identifier"
      >
        {blocks.map((emoji, i) => (
          <div
            key={i}
            className={`emoji-block ${sizeClasses[size]} ${
              active ? "border-green-500/60 bg-green-900/20" : ""
            }`}
            title={`Block ${i + 1}`}
            aria-label={`Identifier block ${i + 1}: ${emoji}`}
          >
            {emoji}
          </div>
        ))}
      </div>

      {/* ID string */}
      <p className="mt-3 text-xs text-purple-300/60 font-mono truncate" aria-label="Identifier as text string">
        ID: {blocks.join("")}
      </p>

      {/* Controls */}
      {showControls && (
        <div className="flex gap-2 mt-4" role="group" aria-label="Identifier actions">
          <button
            onClick={regenerate}
            className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs bg-purple-800/30 hover:bg-purple-700/40 text-purple-200 transition-all"
            aria-label="Generate new random identifier"
          >
            <RefreshCw className="w-3 h-3" aria-hidden="true" />
            New ID
          </button>
          <button
            onClick={copyToClipboard}
            className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs bg-cyan-800/30 hover:bg-cyan-700/40 text-cyan-200 transition-all"
            aria-label={copied ? "Identifier copied" : "Copy identifier to clipboard"}
          >
            {copied ? (
              <CheckCircle className="w-3 h-3 text-green-400" aria-hidden="true" />
            ) : (
              <Copy className="w-3 h-3" aria-hidden="true" />
            )}
            {copied ? "Copied!" : "Copy ID"}
          </button>
        </div>
      )}
    </div>
  );
}
