import type { Metadata } from "next";
import VisualizerClient from "./VisualizerClient";

export const metadata: Metadata = {
  title: "3D Visualizer — Infinity OS",
  description:
    "Interactive 3D visualization of hydrogen signal propagation, magnetic field topology, and the Infinity OS network.",
};

export default function VisualizerPage() {
  return <VisualizerClient />;
}
