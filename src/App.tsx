import ThreeDRolodex from "./threejs-front-facing-rolodex/components/ThreeDRolodex/ThreeDRolodex";
import type { RolodexProject } from "./threejs-front-facing-rolodex/components/ThreeDRolodex/ThreeDRolodex";

// Placeholder art lives in public/projects/*.svg.
// Swap these paths for your own images, e.g. "/projects/intuition.jpg".
const projects: RolodexProject[] = [
  {
    id: "intuition",
    title: "Intuition Exchange",
    eyebrow: "Product / Finance",
    image: "/projects/intuition.svg",
    href: "/projects/intuition-exchange",
    description:
      "A simplified exchange experience combining student achievement, college planning and finance.",
    tags: ["Product", "Next.js", "UX"],
  },
  {
    id: "atlas",
    title: "Atlas",
    eyebrow: "Editorial",
    image: "/projects/atlas.svg",
    href: "/projects/atlas",
    description:
      "An editorial identity and interaction system built around visual exploration.",
    tags: ["Brand", "Web", "Motion"],
  },
  {
    id: "forge",
    title: "Forge",
    eyebrow: "Industrial",
    image: "/projects/forge.svg",
    href: "/projects/forge",
    description:
      "A digital product concept for rapid sheet-metal prototyping and manufacturing.",
    tags: ["Product", "3D", "Industrial"],
  },
  {
    id: "field",
    title: "Field Notes",
    eyebrow: "Photography",
    image: "/projects/field-notes.svg",
    href: "/projects/field-notes",
    description:
      "A photo-led archive with a restrained interface and tactile navigation.",
    tags: ["Photography", "Archive"],
  },
];

export default function App() {
  return (
    <main style={{ height: "100svh", overflow: "hidden" }}>
      <ThreeDRolodex projects={projects} heading="Selected work" />
    </main>
  );
}
