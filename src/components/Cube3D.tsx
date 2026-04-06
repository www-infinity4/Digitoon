"use client";

import { useRef, useEffect } from "react";

interface Cube3DProps {
  color1?: string;
  color2?: string;
  size?: number;
  label?: string;
}

export default function Cube3D({
  color1 = "#7c3aed",
  color2 = "#06b6d4",
  size = 200,
  label = "3D rotating cube visualization",
}: Cube3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const angleRef = useRef({ x: 0, y: 0, z: 0 });
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = size;
    canvas.height = size;
    const cx = size / 2;
    const cy = size / 2;
    const s = size * 0.28;

    // Cube vertices
    const vertices: [number, number, number][] = [
      [-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s],
      [-s, -s, s],  [s, -s, s],  [s, s, s],  [-s, s, s],
    ];

    const faces: [number, number, number, number][] = [
      [0, 1, 2, 3], // back
      [4, 5, 6, 7], // front
      [0, 4, 7, 3], // left
      [1, 5, 6, 2], // right
      [0, 1, 5, 4], // top
      [3, 2, 6, 7], // bottom
    ];

    const faceColors = [
      `${color1}80`, `${color2}80`,
      `${color1}60`, `${color2}60`,
      `${color1}40`, `${color2}40`,
    ];

    const project = (x: number, y: number, z: number): [number, number] => {
      const fov = size * 1.5;
      const scale = fov / (fov + z);
      return [cx + x * scale, cy + y * scale];
    };

    const rotatePoint = (
      px: number, py: number, pz: number,
      ax: number, ay: number, az: number
    ): [number, number, number] => {
      // Rotate X
      let [x, y, z] = [px, py, pz];
      let cos = Math.cos(ax); let sin = Math.sin(ax);
      [y, z] = [y * cos - z * sin, y * sin + z * cos];
      // Rotate Y
      cos = Math.cos(ay); sin = Math.sin(ay);
      [x, z] = [x * cos + z * sin, -x * sin + z * cos];
      // Rotate Z
      cos = Math.cos(az); sin = Math.sin(az);
      [x, y] = [x * cos - y * sin, x * sin + y * cos];
      return [x, y, z];
    };

    const draw = () => {
      ctx.clearRect(0, 0, size, size);

      // Background glow
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
      grad.addColorStop(0, "rgba(124,58,237,0.08)");
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);

      const { x: ax, y: ay, z: az } = angleRef.current;

      // Project all vertices
      const projected: [number, number][] = vertices.map(([px, py, pz]) => {
        const [rx, ry, rz] = rotatePoint(px, py, pz, ax, ay, az);
        return project(rx, ry, rz);
      });

      // Get Z depths for face sorting
      const facesWithDepth = faces.map((face, i) => {
        const zSum = face.reduce((acc, vi) => {
          const [, , pz] = rotatePoint(...vertices[vi], ax, ay, az);
          return acc + pz;
        }, 0);
        return { face, z: zSum / 4, i };
      });

      facesWithDepth.sort((a, b) => a.z - b.z);

      for (const { face, i } of facesWithDepth) {
        const pts = face.map((vi) => projected[vi]);
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let k = 1; k < pts.length; k++) {
          ctx.lineTo(pts[k][0], pts[k][1]);
        }
        ctx.closePath();
        ctx.fillStyle = faceColors[i];
        ctx.fill();
        ctx.strokeStyle = color1 + "cc";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Auto rotate (slow)
      if (!isDragging.current) {
        angleRef.current.x += 0.005;
        angleRef.current.y += 0.008;
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);

    const onMouseDown = (e: MouseEvent) => {
      isDragging.current = true;
      lastMouse.current = { x: e.clientX, y: e.clientY };
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      angleRef.current.y += dx * 0.01;
      angleRef.current.x += dy * 0.01;
      lastMouse.current = { x: e.clientX, y: e.clientY };
    };
    const onMouseUp = () => { isDragging.current = false; };

    const onTouchStart = (e: TouchEvent) => {
      isDragging.current = true;
      lastMouse.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!isDragging.current) return;
      const dx = e.touches[0].clientX - lastMouse.current.x;
      const dy = e.touches[0].clientY - lastMouse.current.y;
      angleRef.current.y += dx * 0.01;
      angleRef.current.x += dy * 0.01;
      lastMouse.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const onTouchEnd = () => { isDragging.current = false; };

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchmove", onTouchMove, { passive: true });
    canvas.addEventListener("touchend", onTouchEnd);

    return () => {
      cancelAnimationFrame(animRef.current);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
    };
  }, [color1, color2, size]);

  return (
    <canvas
      ref={canvasRef}
      className="cursor-grab active:cursor-grabbing rounded-xl"
      style={{ width: size, height: size }}
      aria-label={label}
      role="img"
      title="Drag to rotate"
    />
  );
}
