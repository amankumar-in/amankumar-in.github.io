import { Component, Suspense, lazy } from "react";
import type { ReactNode } from "react";
import { dismissBoot } from "./boot";
import type { RolodexProject } from "./threejs-front-facing-rolodex/components/ThreeDRolodex/ThreeDRolodex";

/**
 * The scene brings three, react-three-fiber, drei and the postprocessing stack
 * with it.  Importing it statically put all of that in the entry chunk, so
 * nothing could paint until ~443 KB of gzipped JavaScript had been downloaded
 * and parsed — the page was blank for the whole of it.
 *
 * Starting the import here, at module evaluation, gets the chunk onto the wire
 * while React is still booting, and leaves the scene in its own file instead of
 * in front of the page.  The splash in index.html covers the gap.
 */
const sceneModule = import(
  "./threejs-front-facing-rolodex/components/ThreeDRolodex/ThreeDRolodex"
).catch((error: unknown) => {
  // Without this the splash would stay up over an error with nothing behind it.
  dismissBoot();
  throw error;
});

const ThreeDRolodex = lazy(() => sceneModule);

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
  {
    id: "signal",
    title: "Signal",
    eyebrow: "Interface",
    image: "/projects/signal.svg",
    href: "/projects/signal",
    description:
      "A compact dashboard language for dense information, without the usual enterprise clutter.",
    tags: ["Interface", "Data"],
  },
];

/**
 * If the scene never arrives there is nothing behind the splash to reveal, so
 * the splash has to come down and say what happened rather than sitting there
 * over an empty page.
 */
class SceneErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    dismissBoot();
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div
        style={{
          display: "grid",
          placeItems: "center",
          height: "100%",
          padding: 40,
          color: "#141311",
          fontSize: 12,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        The interactive scene could not load.
      </div>
    );
  }
}

export default function App() {
  return (
    <main style={{ height: "100svh", overflow: "hidden" }}>
      <SceneErrorBoundary>
        {/* No fallback here: the splash in index.html already covers the
            viewport, and the scene takes it down itself once the first frame
            has been drawn. */}
        <Suspense fallback={null}>
          <ThreeDRolodex projects={projects} />
        </Suspense>
      </SceneErrorBoundary>
    </main>
  );
}
