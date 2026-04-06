import type { Metadata } from "next";
import HydrogenHostClient from "./HydrogenHostClient";

export const metadata: Metadata = {
  title: "Hydrogen Host — Infinity OS",
  description:
    "Generate your free emoji-based 8-block device identifier for the Hydrogen Host P2P network. No phone number needed.",
};

export default function HydrogenHostPage() {
  return <HydrogenHostClient />;
}
