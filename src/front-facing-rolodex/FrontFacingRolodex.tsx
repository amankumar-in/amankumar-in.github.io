"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
} from "react";
import styles from "./FrontFacingRolodex.module.css";

export type RolodexProject = {
  id: string;
  title: string;
  image: string;
  href: string;
  eyebrow?: string;
  description?: string;
  tags?: string[];
};

type Props = {
  projects: RolodexProject[];
  heading?: string;
  className?: string;
  openInNewTab?: boolean;
};

const wrap = (n: number, length: number) =>
  ((n % length) + length) % length;

const shortestDistance = (from: number, to: number, length: number) => {
  let d = to - from;
  if (d > length / 2) d -= length;
  if (d < -length / 2) d += length;
  return d;
};

export default function FrontFacingRolodex({
  projects,
  heading = "Selected work",
  className = "",
  openInNewTab = false,
}: Props) {
  const count = projects.length;
  const stageRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const snapTimerRef = useRef<number | null>(null);
  const pointerRef = useRef<{
    id: number;
    startY: number;
    startPosition: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const [position, setPosition] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const activeIndex = count ? wrap(Math.round(position), count) : 0;
  const selected =
    selectedIndex !== null && count ? projects[selectedIndex] : null;

  const commitPosition = (value: number) => {
    positionRef.current = value;

    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setPosition(positionRef.current);
    });
  };

  const snapTo = (target: number) => {
    if (!count) return;

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const start = positionRef.current;
    const currentWrapped = wrap(start, count);
    const targetWrapped = wrap(target, count);
    const delta = shortestDistance(currentWrapped, targetWrapped, count);
    const end = start + delta;
    const duration = 340;
    const started = performance.now();

    const animate = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - t, 4);
      const value = start + (end - start) * eased;
      positionRef.current = value;
      setPosition(value);

      if (t < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        positionRef.current = end;
        setPosition(end);
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(animate);
  };

  const scheduleSnap = () => {
    if (snapTimerRef.current !== null) {
      window.clearTimeout(snapTimerRef.current);
    }

    snapTimerRef.current = window.setTimeout(() => {
      snapTo(Math.round(positionRef.current));
    }, 120);
  };

  useEffect(() => {
    const node = stageRef.current;
    if (!node || !count) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();

      const delta =
        Math.abs(event.deltaY) >= Math.abs(event.deltaX)
          ? event.deltaY
          : event.deltaX;

      // Trackpads produce many small deltas; mouse wheels produce fewer large ones.
      const step = Math.max(-0.55, Math.min(0.55, delta * 0.0026));
      commitPosition(positionRef.current + step);
      scheduleSnap();
    };

    node.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      node.removeEventListener("wheel", onWheel);
    };
  }, [count]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (snapTimerRef.current !== null)
        window.clearTimeout(snapTimerRef.current);
    };
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!count) return;

    suppressClickRef.current = false;
    pointerRef.current = {
      id: event.pointerId,
      startY: event.clientY,
      startPosition: positionRef.current,
      moved: false,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;

    const dy = event.clientY - pointer.startY;
    if (Math.abs(dy) > 5) pointer.moved = true;

    // Dragging upward advances to the next card.
    const pixelsPerCard = Math.max(
      130,
      Math.min(240, stageRef.current?.clientHeight
        ? stageRef.current.clientHeight * 0.24
        : 180)
    );

    commitPosition(pointer.startPosition - dy / pixelsPerCard);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;

    suppressClickRef.current = pointer.moved;
    pointerRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture can already be released; nothing to recover from.
    }

    snapTo(Math.round(positionRef.current));
  };

  const handleCardClick = (index: number) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }

    const currentWrapped = wrap(positionRef.current, count);
    const distance = shortestDistance(currentWrapped, index, count);

    // First click on a neighbouring card brings it to the centre.
    if (Math.abs(distance) > 0.35) {
      snapTo(positionRef.current + distance);
      return;
    }

    // Click on the centred card opens its details.
    setSelectedIndex(index);
    setDrawerOpen(true);
  };

  const cardTransforms = useMemo(() => {
    if (!count) return [];

    const anglePerCard = (Math.PI * 2) / Math.max(count, 6);

    return projects.map((_, index) => {
      let offset = index - position;
      while (offset > count / 2) offset -= count;
      while (offset < -count / 2) offset += count;

      const angle = offset * anglePerCard;

      // The orbit is vertical, like looking at a Rolodex from the side.
      const y = Math.sin(angle) * 46;
      const depth = (Math.cos(angle) - 1) * 290;

      // Cards NEVER rotate with the orbit. Their plane stays parallel
      // to the viewport, so every project image remains front-facing.
      const scale = Math.max(0.72, 1 + depth / 1100);
      const opacity = Math.max(0, Math.min(1, 1 + depth / 420));
      const zIndex = Math.round(1000 + depth);

      return {
        "--card-y": `${y}vh`,
        "--card-z": `${depth}px`,
        "--card-scale": scale,
        "--card-opacity": opacity,
        zIndex,
      } as CSSProperties;
    });
  }, [count, position, projects]);

  if (!count) {
    return (
      <section className={`${styles.shell} ${className}`}>
        <p className={styles.empty}>Add at least one project.</p>
      </section>
    );
  }

  return (
    <section className={`${styles.shell} ${className}`}>
      <div
        ref={stageRef}
        className={styles.stage}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <header className={styles.header}>
          <p className={styles.kicker}>Portfolio</p>
          <h1>{heading}</h1>
        </header>

        <div className={styles.axis} aria-hidden="true">
          <span />
          <span />
        </div>

        <div className={styles.viewport} aria-live="polite">
          {projects.map((project, index) => {
            const isActive = index === activeIndex;

            return (
              <button
                key={project.id}
                type="button"
                className={`${styles.card} ${
                  isActive ? styles.activeCard : ""
                }`}
                style={cardTransforms[index]}
                onClick={() => handleCardClick(index)}
                aria-label={`${project.title}${
                  isActive ? ", open project details" : ", bring to front"
                }`}
              >
                <img src={project.image} alt="" draggable={false} />
                <span className={styles.cardShade} aria-hidden="true" />
                <span className={styles.cardLabel}>
                  <small>{project.eyebrow ?? "Project"}</small>
                  <strong>{project.title}</strong>
                </span>
              </button>
            );
          })}
        </div>

        <div className={styles.hint} aria-hidden="true">
          <span>Scroll / swipe</span>
          <span className={styles.hintLine} />
          <span>{activeIndex + 1} / {count}</span>
        </div>
      </div>

      <aside
        className={`${styles.detailsPane} ${
          selected ? styles.detailsPaneVisible : ""
        }`}
        aria-hidden={!selected}
      >
        {selected ? (
          <ProjectDetails
            project={selected}
            openInNewTab={openInNewTab}
            onClose={() => {
              setSelectedIndex(null);
              setDrawerOpen(false);
            }}
          />
        ) : (
          <div className={styles.detailsPlaceholder}>
            <span>{String(activeIndex + 1).padStart(2, "0")}</span>
            <p>Tap the centred card to open the project.</p>
          </div>
        )}
      </aside>

      <div
        className={`${styles.mobileScrim} ${
          selected && drawerOpen ? styles.mobileScrimVisible : ""
        }`}
        onClick={() => setDrawerOpen(false)}
      />

      <section
        className={`${styles.mobileDrawer} ${
          selected && drawerOpen ? styles.mobileDrawerOpen : ""
        }`}
        aria-hidden={!(selected && drawerOpen)}
      >
        <button
          type="button"
          className={styles.drawerHandle}
          onClick={() => setDrawerOpen(false)}
          aria-label="Close project details"
        />
        {selected && (
          <ProjectDetails
            project={selected}
            openInNewTab={openInNewTab}
            onClose={() => setDrawerOpen(false)}
          />
        )}
      </section>
    </section>
  );
}

function ProjectDetails({
  project,
  openInNewTab,
  onClose,
}: {
  project: RolodexProject;
  openInNewTab: boolean;
  onClose: () => void;
}) {
  return (
    <div className={styles.detailsInner}>
      <button
        type="button"
        className={styles.close}
        onClick={onClose}
        aria-label="Close project details"
      >
        ×
      </button>

      <div className={styles.detailsImageWrap}>
        <img src={project.image} alt="" draggable={false} />
      </div>

      <div className={styles.detailsCopy}>
        {project.eyebrow && (
          <p className={styles.eyebrow}>{project.eyebrow}</p>
        )}

        <h2>{project.title}</h2>

        {project.description && (
          <p className={styles.description}>{project.description}</p>
        )}

        {!!project.tags?.length && (
          <div className={styles.tags}>
            {project.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        )}

        <a
          className={styles.openProject}
          href={project.href}
          target={openInNewTab ? "_blank" : undefined}
          rel={openInNewTab ? "noreferrer" : undefined}
        >
          Open project <span aria-hidden="true">↗</span>
        </a>
      </div>
    </div>
  );
}
