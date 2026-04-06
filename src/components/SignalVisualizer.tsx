"use client";

import { useEffect, useRef, useState } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  alpha: number;
  life: number;
}

interface SignalVisualizerProps {
  active?: boolean;
  height?: number;
}

export default function SignalVisualizer({
  active = false,
  height = 200,
}: SignalVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resizeCanvas();

    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(canvas);

    const colors = ["#7c3aed", "#06b6d4", "#f59e0b", "#10b981"];

    const spawnParticle = () => {
      if (!active || particlesRef.current.length > 60) return;
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 2 + 1;
      particlesRef.current.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: Math.random() * 3 + 1,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 1,
        life: 1,
      });
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw grid
      ctx.strokeStyle = "rgba(124, 58, 237, 0.08)";
      ctx.lineWidth = 1;
      const gridSize = 30;
      for (let x = 0; x < canvas.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      const cx = canvas.width / 2;
      const cy = canvas.height / 2;

      // Draw signal rings
      if (active) {
        const time = Date.now() / 1000;
        for (let i = 0; i < 3; i++) {
          const phase = (time * 0.8 + i * 0.33) % 1;
          const maxR = Math.min(cx, cy) * 0.9;
          const r = phase * maxR;
          const alpha = 1 - phase;

          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(124, 58, 237, ${alpha * 0.7})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      // Center node
      const nodeColor = active ? "#7c3aed" : "#374151";
      const glowSize = active ? 20 : 8;

      ctx.beginPath();
      ctx.arc(cx, cy, glowSize, 0, Math.PI * 2);
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowSize);
      gradient.addColorStop(0, active ? "rgba(124,58,237,0.8)" : "rgba(55,65,81,0.4)");
      gradient.addColorStop(1, "transparent");
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fillStyle = nodeColor;
      ctx.fill();

      // Update + draw particles
      if (active) spawnParticle();

      particlesRef.current = particlesRef.current.filter((p) => p.alpha > 0.01);
      for (const p of particlesRef.current) {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.015;
        p.alpha = Math.max(0, p.life);
        p.vx *= 0.99;
        p.vy *= 0.99;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color + Math.floor(p.alpha * 255).toString(16).padStart(2, "0");
        ctx.fill();
      }

      // Label
      ctx.font = "10px monospace";
      ctx.fillStyle = active ? "rgba(124,58,237,0.8)" : "rgba(107,114,128,0.6)";
      ctx.textAlign = "center";
      ctx.fillText(active ? "HYDROGEN SIGNAL ACTIVE" : "SIGNAL STANDBY", cx, canvas.height - 10);

      setFrame((f) => f + 1);
      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      observer.disconnect();
    };
  }, [active]);

  // suppress unused var warning from frame
  void frame;

  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded-xl"
      style={{ height }}
      aria-label={active ? "Hydrogen signal visualizer — signal active" : "Hydrogen signal visualizer — standby"}
      role="img"
    />
  );
}
