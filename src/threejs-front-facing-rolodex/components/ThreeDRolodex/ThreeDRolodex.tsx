"use client";

import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import {
  ContactShadows,
  Image as DreiImage,
  RoundedBox,
} from "@react-three/drei";
import {
  Suspense,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ForwardedRef,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
} from "react";
import styles from "./ThreeDRolodex.module.css";

export type RolodexProject = {
  id: string;
  title: string;
  image: string;
  href: string;
  eyebrow?: string;
  description?: string;
  tags?: string[];
};

type ThreeDRolodexProps = {
  projects: RolodexProject[];
  heading?: string;
  className?: string;
  openInNewTab?: boolean;
};

/**
 * Geometry tuning.
 *
 * The wheel rotates around X.
 * The wheel itself is centred a little above the cards so each card can
 * remain upright while its mounting rail moves around the wheel.
 */
const WHEEL_RADIUS = 3.05;
const WHEEL_HALF_WIDTH = 3.22;
const WHEEL_Y = 1.42;

const CARD_WIDTH = 5.05;
const CARD_HEIGHT = 3.18;
const CARD_DEPTH = 0.09;

const TAU = Math.PI * 2;

const wrap = (value: number, length: number) =>
  ((value % length) + length) % length;

function nearestEquivalentAngle(angle: number, current: number) {
  return angle + Math.round((current - angle) / TAU) * TAU;
}

export default function ThreeDRolodex({
  projects,
  heading = "Selected projects",
  className = "",
  openInNewTab = false,
}: ThreeDRolodexProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const targetRotationRef = useRef(0);
  const snapTimerRef = useRef<number | null>(null);
  const suppressCardClickRef = useRef(false);

  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    startRotation: number;
    moved: boolean;
  } | null>(null);

  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const count = projects.length;
  const step = count ? TAU / count : TAU;
  const activeProject = count ? projects[activeIndex] : null;
  const selectedProject =
    selectedIndex !== null && count ? projects[selectedIndex] : null;

  const syncActiveIndex = useCallback(
    (rotation: number) => {
      if (!count) return;
      const index = wrap(-Math.round(rotation / step), count);
      setActiveIndex((previous) => (previous === index ? previous : index));
    },
    [count, step]
  );

  const snapToNearest = useCallback(() => {
    if (!count) return;
    const snapped =
      Math.round(targetRotationRef.current / step) * step;
    targetRotationRef.current = snapped;
    syncActiveIndex(snapped);
  }, [count, step, syncActiveIndex]);

  const scheduleSnap = useCallback(() => {
    if (snapTimerRef.current !== null) {
      window.clearTimeout(snapTimerRef.current);
    }

    snapTimerRef.current = window.setTimeout(() => {
      snapToNearest();
    }, 130);
  }, [snapToNearest]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !count) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();

      const rawDelta =
        Math.abs(event.deltaY) >= Math.abs(event.deltaX)
          ? event.deltaY
          : event.deltaX;

      // Continuous enough for trackpads but capped so a mouse-wheel notch
      // cannot fling through half the wheel.
      const delta = THREE.MathUtils.clamp(
        rawDelta * 0.00155,
        -step * 0.72,
        step * 0.72
      );

      // Scroll down => next project rotates to the front.
      targetRotationRef.current -= delta;
      syncActiveIndex(targetRotationRef.current);
      scheduleSnap();
    };

    stage.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      stage.removeEventListener("wheel", onWheel);
    };
  }, [count, scheduleSnap, step, syncActiveIndex]);

  useEffect(() => {
    return () => {
      if (snapTimerRef.current !== null) {
        window.clearTimeout(snapTimerRef.current);
      }
    };
  }, []);

  // The project list is an external input: when it changes, every piece of
  // local state (wheel rotation, selection, drawer) has to reset together.
  // This is deliberate rather than derived state because the React Compiler
  // lint set also rejects adjusting state during render, and a key-based
  // remount would tear down and rebuild the WebGL context.  The effect body
  // only runs when `count` actually changes.
  useEffect(() => {
    targetRotationRef.current = 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveIndex(0);
    setSelectedIndex(null);
    setDrawerOpen(false);
  }, [count]);

  const onPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    if (!count) return;

    suppressCardClickRef.current = false;

    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startRotation: targetRotationRef.current,
      moved: false,
    };

  };

  const onPointerMove = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const dy = event.clientY - drag.startY;
    if (Math.abs(dy) > 7) drag.moved = true;

    // About 180 px / project, independent of the number of cards.
    const pixelsPerProject = 180;
    const rotation =
      drag.startRotation + (dy / pixelsPerProject) * step;

    targetRotationRef.current = rotation;
    syncActiveIndex(rotation);
  };

  const finishPointer = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    suppressCardClickRef.current = drag.moved;
    dragRef.current = null;

    snapToNearest();
  };

  const bringCardToFront = useCallback(
    (index: number) => {
      if (!count) return;

      const baseTarget = -index * step;
      targetRotationRef.current = nearestEquivalentAngle(
        baseTarget,
        targetRotationRef.current
      );
      setActiveIndex(index);
    },
    [count, step]
  );

  const handleCardClick = useCallback(
    (index: number) => {
      if (suppressCardClickRef.current) {
        suppressCardClickRef.current = false;
        return;
      }

      if (index !== activeIndex) {
        bringCardToFront(index);
        return;
      }

      setSelectedIndex(index);
      setDrawerOpen(true);
    },
    [activeIndex, bringCardToFront]
  );

  if (!count) {
    return (
      <section className={`${styles.shell} ${className}`}>
        <div className={styles.empty}>
          Add at least one project to the <code>projects</code> array.
        </div>
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
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
      >
        <header className={styles.stageHeader}>
          <p>Portfolio / archive</p>
          <h1>{heading}</h1>
        </header>

        <div className={styles.canvasWrap}>
          <Canvas
            shadows
            dpr={[1, 1.75]}
            camera={{
              position: [0, 0.15, 12.2],
              fov: 34,
              near: 0.1,
              far: 50,
            }}
            gl={{
              antialias: true,
              alpha: true,
              powerPreference: "high-performance",
            }}
          >
            <Suspense fallback={null}>
              <RolodexScene
                projects={projects}
                targetRotationRef={targetRotationRef}
                activeIndex={activeIndex}
                suppressCardClickRef={suppressCardClickRef}
                onCardClick={handleCardClick}
              />
            </Suspense>
          </Canvas>
        </div>

        <div className={styles.projectHud}>
          <div>
            <span className={styles.counter}>
              {String(activeIndex + 1).padStart(2, "0")} /{" "}
              {String(count).padStart(2, "0")}
            </span>
            <strong>{activeProject?.title}</strong>
          </div>

          <button
            type="button"
            onClick={() => {
              setSelectedIndex(activeIndex);
              setDrawerOpen(true);
            }}
          >
            View project
          </button>
        </div>

        <div className={styles.scrollHint} aria-hidden="true">
          <span className={styles.mouseIcon}>
            <i />
          </span>
          <span>Scroll or swipe vertically</span>
        </div>
      </div>

      <aside className={styles.desktopDetails}>
        {activeProject && (
          <ProjectDetails
            project={selectedProject ?? activeProject}
            openInNewTab={openInNewTab}
            passive={selectedProject === null}
            onClose={() => setSelectedIndex(null)}
          />
        )}
      </aside>

      <button
        type="button"
        aria-label="Close project drawer"
        className={`${styles.mobileScrim} ${
          drawerOpen ? styles.mobileScrimOpen : ""
        }`}
        onClick={() => setDrawerOpen(false)}
      />

      <aside
        className={`${styles.mobileDrawer} ${
          drawerOpen ? styles.mobileDrawerOpen : ""
        }`}
        aria-hidden={!drawerOpen}
      >
        <button
          type="button"
          aria-label="Close project drawer"
          className={styles.drawerHandle}
          onClick={() => setDrawerOpen(false)}
        >
          <span />
        </button>

        {selectedProject && (
          <ProjectDetails
            project={selectedProject}
            openInNewTab={openInNewTab}
            onClose={() => setDrawerOpen(false)}
          />
        )}
      </aside>
    </section>
  );
}

function RolodexScene({
  projects,
  targetRotationRef,
  activeIndex,
  suppressCardClickRef,
  onCardClick,
}: {
  projects: RolodexProject[];
  targetRotationRef: MutableRefObject<number>;
  activeIndex: number;
  suppressCardClickRef: MutableRefObject<boolean>;
  onCardClick: (index: number) => void;
}) {
  const mechanismRef = useRef<THREE.Group>(null);
  const actualRotationRef = useRef(0);
  const { viewport } = useThree();

  const responsiveScale = Math.min(
    1,
    Math.max(0.62, viewport.width / 7.4)
  );

  const step = TAU / projects.length;

  useFrame((_, delta) => {
    actualRotationRef.current = THREE.MathUtils.damp(
      actualRotationRef.current,
      targetRotationRef.current,
      10.5,
      delta
    );

    if (mechanismRef.current) {
      mechanismRef.current.rotation.x =
        -actualRotationRef.current;
    }
  });

  return (
    <>
      <color attach="background" args={["#e9e5dc"]} />

      <ambientLight intensity={1.35} />
      <hemisphereLight
        intensity={0.85}
        color="#fff8e8"
        groundColor="#817a6b"
      />
      <directionalLight
        castShadow
        position={[5, 8, 10]}
        intensity={2.25}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.1}
        shadow-camera-far={30}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
      />
      <pointLight
        position={[-6, -1, 6]}
        intensity={0.55}
        color="#cfd8ff"
      />

      <group scale={responsiveScale}>
        <Mechanism
          ref={mechanismRef}
          cardCount={projects.length}
        />

        {projects.map((project, index) => (
          <ProjectCard3D
            key={project.id}
            project={project}
            index={index}
            step={step}
            active={index === activeIndex}
            rotationRef={actualRotationRef}
            suppressCardClickRef={suppressCardClickRef}
            onClick={() => onCardClick(index)}
          />
        ))}

        <DeskBase />
      </group>

      <ContactShadows
        position={[0, -3.95 * responsiveScale, 0]}
        opacity={0.3}
        scale={13}
        blur={2.8}
        far={8}
      />
    </>
  );
}

const Mechanism = forwardRef<THREE.Group, { cardCount: number }>(function MechanismInner(
  {
    cardCount,
  },
  forwardedRef: ForwardedRef<THREE.Group>
) {
  const spokes = 8;
  const spokeAngles = useMemo(
    () =>
      Array.from(
        { length: spokes },
        (_, index) => (index / spokes) * TAU
      ),
    []
  );

  const railAngles = useMemo(
    () =>
      Array.from(
        { length: cardCount },
        (_, index) => (index / cardCount) * TAU
      ),
    [cardCount]
  );

  return (
    <group ref={forwardedRef} position={[0, WHEEL_Y, 0]}>
      {/* Main axle */}
      <mesh castShadow receiveShadow rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.095, 0.095, 7.15, 32]} />
        <meshStandardMaterial
          color="#6f706d"
          roughness={0.27}
          metalness={0.78}
        />
      </mesh>

      {/* Left + right wheel rings */}
      {[-WHEEL_HALF_WIDTH, WHEEL_HALF_WIDTH].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh
            castShadow
            receiveShadow
            rotation={[0, Math.PI / 2, 0]}
          >
            <torusGeometry
              args={[WHEEL_RADIUS, 0.105, 16, 112]}
            />
            <meshStandardMaterial
              color="#777872"
              roughness={0.3}
              metalness={0.74}
            />
          </mesh>

          {/* Hub */}
          <mesh
            castShadow
            receiveShadow
            rotation={[0, 0, Math.PI / 2]}
          >
            <cylinderGeometry args={[0.29, 0.29, 0.3, 40]} />
            <meshStandardMaterial
              color="#5f605c"
              roughness={0.24}
              metalness={0.82}
            />
          </mesh>

          {/* Spokes make the rotation physically legible. */}
          {spokeAngles.map((angle) => (
            <mesh
              key={angle}
              castShadow
              receiveShadow
              position={[
                0,
                Math.sin(angle) * WHEEL_RADIUS * 0.5,
                Math.cos(angle) * WHEEL_RADIUS * 0.5,
              ]}
              rotation={[
                Math.PI / 2 - angle,
                0,
                0,
              ]}
            >
              <boxGeometry
                args={[0.055, WHEEL_RADIUS, 0.055]}
              />
              <meshStandardMaterial
                color="#8a8a84"
                roughness={0.36}
                metalness={0.68}
              />
            </mesh>
          ))}
        </group>
      ))}

      {/* One real mounting rail for every card. */}
      {railAngles.map((angle) => (
        <mesh
          key={angle}
          castShadow
          receiveShadow
          position={[
            0,
            Math.sin(angle) * WHEEL_RADIUS,
            Math.cos(angle) * WHEEL_RADIUS,
          ]}
          rotation={[0, 0, Math.PI / 2]}
        >
          <cylinderGeometry
            args={[
              0.045,
              0.045,
              WHEEL_HALF_WIDTH * 2 + 0.16,
              18,
            ]}
          />
          <meshStandardMaterial
            color="#94948e"
            roughness={0.32}
            metalness={0.72}
          />
        </mesh>
      ))}
    </group>
  );
});

function ProjectCard3D({
  project,
  index,
  step,
  active,
  rotationRef,
  suppressCardClickRef,
  onClick,
}: {
  project: RolodexProject;
  index: number;
  step: number;
  active: boolean;
  rotationRef: MutableRefObject<number>;
  suppressCardClickRef: MutableRefObject<boolean>;
  onClick: () => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const haloRef = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    const angle = index * step + rotationRef.current;
    const y = Math.sin(angle) * WHEEL_RADIUS;
    const z = Math.cos(angle) * WHEEL_RADIUS;

    if (groupRef.current) {
      // Position follows the physical mounting rail...
      groupRef.current.position.set(0, y, z);

      // ...but orientation is NOT inherited from the rotating wheel.
      // It stays parallel to the viewport at all times.
      groupRef.current.rotation.set(0, 0, 0);

    }

    if (haloRef.current) {
      const material =
        haloRef.current.material as THREE.MeshBasicMaterial;
      material.opacity = THREE.MathUtils.damp(
        material.opacity,
        active ? 0.11 : 0,
        10,
        delta
      );
    }
  });

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();

    if (suppressCardClickRef.current) {
      suppressCardClickRef.current = false;
      return;
    }

    onClick();
  };

  return (
    <group
      ref={groupRef}
      onClick={handleClick}
      onPointerOver={(event) => {
        event.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "";
      }}
    >
      {/* Soft selection halo behind the physical card. */}
      <mesh ref={haloRef} position={[0, 0, -0.055]}>
        <planeGeometry
          args={[CARD_WIDTH + 0.22, CARD_HEIGHT + 0.22]}
        />
        <meshBasicMaterial
          color="#11100e"
          transparent
          opacity={0}
          depthWrite={false}
        />
      </mesh>

      {/* Card stock */}
      <RoundedBox
        args={[CARD_WIDTH, CARD_HEIGHT, CARD_DEPTH]}
        radius={0.11}
        smoothness={5}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color="#f7f4ed"
          roughness={0.78}
          metalness={0}
        />
      </RoundedBox>

      {/* User-replaceable project image */}
      <DreiImage
        url={project.image}
        scale={[CARD_WIDTH - 0.18, CARD_HEIGHT - 0.18]}
        position={[0, 0, CARD_DEPTH / 2 + 0.006]}
        radius={0.08}
        transparent
        toneMapped={false}
      />

      {/* Two physical mounting clips.  The real rotating rail passes
          through this height while the card itself stays upright. */}
      {[-1.98, 1.98].map((x) => (
        <group key={x} position={[x, WHEEL_Y, 0.02]}>
          <RoundedBox
            args={[0.25, 0.28, 0.16]}
            radius={0.05}
            smoothness={3}
            castShadow
          >
            <meshStandardMaterial
              color="#777873"
              roughness={0.32}
              metalness={0.76}
            />
          </RoundedBox>

          <mesh
            position={[0, 0, 0.09]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <torusGeometry args={[0.075, 0.021, 10, 24]} />
            <meshStandardMaterial
              color="#5e5f5b"
              roughness={0.26}
              metalness={0.82}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function DeskBase() {
  return (
    <group position={[0, -3.4, -0.3]}>
      {/* Feet */}
      {[-WHEEL_HALF_WIDTH, WHEEL_HALF_WIDTH].map((x) => (
        <RoundedBox
          key={x}
          args={[0.54, 0.42, 2.2]}
          radius={0.13}
          smoothness={4}
          position={[x, 0, 0]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial
            color="#5e5d57"
            roughness={0.44}
            metalness={0.58}
          />
        </RoundedBox>
      ))}

      {/* Cross brace */}
      <RoundedBox
        args={[WHEEL_HALF_WIDTH * 2 + 0.52, 0.19, 0.5]}
        radius={0.08}
        smoothness={4}
        position={[0, 0.02, -0.66]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color="#71716b"
          roughness={0.4}
          metalness={0.6}
        />
      </RoundedBox>

      {/* Uprights to the wheel hub */}
      {[-WHEEL_HALF_WIDTH, WHEEL_HALF_WIDTH].map((x) => (
        <RoundedBox
          key={`upright-${x}`}
          args={[0.27, 4.78, 0.34]}
          radius={0.09}
          smoothness={4}
          position={[x, 2.39, -0.14]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial
            color="#6a6963"
            roughness={0.42}
            metalness={0.58}
          />
        </RoundedBox>
      ))}
    </group>
  );
}

function ProjectDetails({
  project,
  openInNewTab,
  passive = false,
  onClose,
}: {
  project: RolodexProject;
  openInNewTab: boolean;
  passive?: boolean;
  onClose: () => void;
}) {
  return (
    <div className={styles.detailsInner}>
      {!passive && (
        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          aria-label="Close project details"
        >
          ×
        </button>
      )}

      <div className={styles.detailNumber}>
        {project.eyebrow ?? "Selected project"}
      </div>

      <h2>{project.title}</h2>

      {project.description && (
        <p className={styles.description}>
          {project.description}
        </p>
      )}

      {!!project.tags?.length && (
        <div className={styles.tags}>
          {project.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      )}

      <div className={styles.detailSpacer} />

      <div className={styles.detailThumb}>
        <img src={project.image} alt="" />
      </div>

      <a
        href={project.href}
        className={styles.openProject}
        target={openInNewTab ? "_blank" : undefined}
        rel={openInNewTab ? "noreferrer" : undefined}
      >
        <span>Open project</span>
        <span aria-hidden="true">↗</span>
      </a>

      {passive && (
        <p className={styles.passiveNote}>
          Rotate the Rolodex, then click the front card to select it.
        </p>
      )}
    </div>
  );
}
