"use client";

import ThreeDRolodex from "./components/ThreeDRolodex/ThreeDRolodex";
import type { RolodexProject } from "./components/ThreeDRolodex/ThreeDRolodex";

const projects: RolodexProject[] = [
  {
    id: "intuition",
    title: "Intuition Exchange",
    eyebrow: "Product / Finance",
    image: "/projects/intuition.jpg",
    href: "/projects/intuition-exchange",
    description:
      "A simplified exchange experience connecting achievement, college planning and finance.",
    tags: ["Product", "Next.js", "UX"],
  },
  {
    id: "forge",
    title: "Forge",
    eyebrow: "Industrial / Web",
    image: "/projects/forge.jpg",
    href: "/projects/forge",
    description:
      "A rapid sheet-metal prototyping concept built around short lead times and a clear quoting flow.",
    tags: ["Product", "3D", "Industrial"],
  },
  {
    id: "atlas",
    title: "Atlas",
    eyebrow: "Editorial",
    image: "/projects/atlas.jpg",
    href: "/projects/atlas",
    description:
      "An image-led editorial system with a restrained interface and tactile navigation.",
    tags: ["Brand", "Web", "Motion"],
  },
  {
    id: "field",
    title: "Field Notes",
    eyebrow: "Photography",
    image: "/projects/field-notes.jpg",
    href: "/projects/field-notes",
    description:
      "A photographic archive designed around quiet typography and large-format imagery.",
    tags: ["Photography", "Archive"],
  },
  {
    id: "signal",
    title: "Signal",
    eyebrow: "Interface",
    image: "/projects/signal.jpg",
    href: "/projects/signal",
    description:
      "A compact dashboard language for dense information without the usual enterprise visual clutter.",
    tags: ["Interface", "Data"],
  },
  {
    id: "north",
    title: "North",
    eyebrow: "Identity",
    image: "/projects/north.jpg",
    href: "/projects/north",
    description:
      "A visual identity built from a small set of flexible, deliberately imperfect graphic rules.",
    tags: ["Identity", "Art direction"],
  },
];

export default function Page() {
  return (
    <main style={{ height: "100svh", overflow: "hidden" }}>
      <ThreeDRolodex projects={projects} />
    </main>
  );
}
