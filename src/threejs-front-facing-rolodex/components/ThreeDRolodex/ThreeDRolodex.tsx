"use client";

import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import {
  ContactShadows,
  Environment,
  Image as DreiImage,
  Lightformer,
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
  ReactNode,
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

/** Radius of the rod each card hangs from. */
const RAIL_RADIUS = 0.028;

/**
 * The bearing collar at the heart of each hanger.
 *
 * Its axis is the rod's axis, so it goes *around* the rod rather than through
 * it: the bore is wider than the rod, the collar is centred on the same z, and
 * the two surfaces never touch, so nothing can depth-fight.
 */
const HINGE_HOLE_RADIUS = RAIL_RADIUS + 0.006;
const HINGE_TUBE = 0.032;
const HINGE_RADIUS = HINGE_HOLE_RADIUS + HINGE_TUBE;
const HINGE_OUTER_RADIUS = HINGE_RADIUS + HINGE_TUBE;

/**
 * How far the card's top edge sits below the rod's axis — and therefore how much
 * height the hanger's neck and plate have to work in.  The card hangs clear of
 * the rod: the rod passes over the top edge, never through the card.
 */
const HANGER_DROP = 0.26;
const CARD_TOP_EDGE = -HANGER_DROP;
const CARD_DROP = CARD_HEIGHT / 2 - CARD_TOP_EDGE;

const AXLE_LENGTH = 7.15;

/**
 * Extent of the assembled model, measured from the scene origin.
 *
 * The hangers orbit the origin at WHEEL_RADIUS and every card hangs CARD_DROP
 * below the rod it is clipped to, so the assembly is no longer symmetric about
 * y = 0: the highest point is the wheel's own ring and the lowest is the bottom
 * card's lower edge.  MODEL_CENTER_Y is the offset applied to the scene group
 * so that framed box ends up centred on the camera axis.
 */
const MODEL_TOP = Math.max(
  WHEEL_Y + WHEEL_RADIUS + 0.105, // the wheel's rings
  WHEEL_Y + WHEEL_RADIUS + HINGE_OUTER_RADIUS, // collar at the top of the orbit
  WHEEL_Y + WHEEL_RADIUS + CARD_TOP_EDGE // top card's top edge
);
const MODEL_BOTTOM = WHEEL_Y - WHEEL_RADIUS + CARD_TOP_EDGE - CARD_HEIGHT;
const MODEL_CENTER_Y = (MODEL_TOP + MODEL_BOTTOM) / 2;
const MODEL_HALF_HEIGHT = (MODEL_TOP - MODEL_BOTTOM) / 2;
const MODEL_HALF_WIDTH = AXLE_LENGTH / 2;

/**
 * Widest parts of the model, each paired with its own z.  The desk feet are
 * narrower than the axle but sit nearer the camera, so perspective magnifies
 * them more and they are the real horizontal limit on narrow viewports.
 */
const WIDTH_EXTENTS = [
  { halfWidth: MODEL_HALF_WIDTH, z: 0 },
  { halfWidth: WHEEL_HALF_WIDTH + 0.27, z: 0.8 },
];

/**
 * The floor sits at the lowest point of the whole assembly, so no card can sink
 * through it.  The stand therefore has to reach that floor: its feet rest on it
 * and its uprights run up to just under the axle.
 */
const GROUND_Y = MODEL_BOTTOM;
const DESK_FOOT_HEIGHT = 0.42;
const DESK_Y = GROUND_Y + DESK_FOOT_HEIGHT / 2;
const DESK_UPRIGHT_HEIGHT = WHEEL_Y - DESK_Y - 0.04;

/**
 * The room the assembly stands in: a veneer desk top under it and a wall behind.
 *
 * These are model units and live inside the same scaled group as the model, so
 * the setting stays proportional to it at every viewport size.  The desk's top
 * face is the ground the stand's feet rest on.
 */
const DESK_TOP = GROUND_Y;
const DESK_WIDTH = 26;
const DESK_DEPTH = 22;
const DESK_BACK_Z = -9;
const DESK_THICKNESS = 1.6;
const WALL_Z = -8;
const WALL_HEIGHT = 30;
const WALL_HALF_WIDTH = 15;

/** Share of the viewport the model is allowed to fill. */
const FRAMING_MARGIN = 0.9;

const TAU = Math.PI * 2;

const wrap = (value: number, length: number) =>
  ((value % length) + length) % length;

function nearestEquivalentAngle(angle: number, current: number) {
  return angle + Math.round((current - angle) / TAU) * TAU;
}

export default function ThreeDRolodex({
  projects,
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
        <div className={styles.canvasWrap}>
          <Canvas
            shadows
            dpr={[1, 1.75]}
            camera={{
              position: [0, 0, 12.2],
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
                suppressCardClickRef={suppressCardClickRef}
                onCardClick={handleCardClick}
              />
            </Suspense>
          </Canvas>
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
  suppressCardClickRef,
  onCardClick,
}: {
  projects: RolodexProject[];
  targetRotationRef: MutableRefObject<number>;
  suppressCardClickRef: MutableRefObject<boolean>;
  onCardClick: (index: number) => void;
}) {
  const mechanismRef = useRef<THREE.Group>(null);
  const cardsRef = useRef<THREE.Group>(null);
  const actualRotationRef = useRef(0);
  const { camera, size } = useThree();

  // Frame the whole assembly: scale it so its full height and width fit inside
  // the viewport, and let the scene group's offset put its centre on the camera
  // axis.  Each axis is a ratio of the visible half-size to the model's
  // half-size — with one correction: geometry nearer the camera is magnified,
  // so the widest parts are measured at their own depth instead of at z = 0.
  const halfFov =
    THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov) / 2;
  const aspect = size.width / Math.max(1, size.height);
  const cameraDistance = Math.abs(camera.position.z);
  const halfViewHeight = Math.tan(halfFov) * cameraDistance;
  const halfViewWidth = halfViewHeight * aspect;

  // The top and bottom cards are the vertical extremes, and they sit at z = 0
  // when they reach the highest and lowest points of the wheel.
  const scaleToFitHeight =
    (FRAMING_MARGIN * halfViewHeight) / MODEL_HALF_HEIGHT;
  const scaleToFitWidth = Math.min(
    ...WIDTH_EXTENTS.map(
      ({ halfWidth, z }) =>
        (FRAMING_MARGIN * halfViewWidth) /
        (halfWidth + (FRAMING_MARGIN * halfViewWidth * z) / cameraDistance)
    )
  );
  const fitScale = Math.min(scaleToFitHeight, scaleToFitWidth);

  // World-space height of the floor the whole assembly stands on.
  const floorY = (GROUND_Y - MODEL_CENTER_Y) * fitScale;

  const step = TAU / projects.length;

  useFrame((_, delta) => {
    const rotation = THREE.MathUtils.damp(
      actualRotationRef.current,
      targetRotationRef.current,
      10.5,
      delta
    );
    actualRotationRef.current = rotation;

    // The wheel and the cards are driven from this one number, in one pass.
    //
    // The cards live inside the rotating wheel, so the wheel's rotation is what
    // carries each card around its rail — the very same matrix that carries the
    // rod, which is why the eyelet and the rod can never drift apart or lag by a
    // frame.  Each card then applies the equal and opposite rotation about its
    // own rail axis to cancel the tumble and stay front-facing.
    if (mechanismRef.current) {
      mechanismRef.current.rotation.x = -rotation;
    }

    const cards = cardsRef.current;
    if (cards) {
      for (const card of cards.children) {
        card.rotation.x = rotation;
      }
    }
  });

  return (
    <>
      <color attach="background" args={["#f4f1ec"]} />

      {/* A soft studio rig.  The Environment below does most of the work through
          reflections and fill; the direct lights add shape, and the key light
          carries the cast shadow. */}
      <ambientLight intensity={0.45} />
      <hemisphereLight
        intensity={0.35}
        color="#ffffff"
        groundColor="#d8d8d8"
      />
      <directionalLight
        castShadow
        position={[5, 8, 10]}
        intensity={1.9}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.1}
        shadow-camera-far={40}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
      />
      <pointLight
        position={[-6, -1, 6]}
        intensity={0.3}
        color="#f2f5ff"
      />

      {/* White studio boxes, rendered into a cube map so the metal has something
          to reflect without loading an external HDRI. */}
      <Environment resolution={256}>
        <Lightformer
          form="rect"
          intensity={3}
          position={[0, 6, -9]}
          rotation-x={Math.PI / 4}
          scale={[12, 12, 1]}
        />
        <Lightformer
          form="rect"
          intensity={2}
          position={[-6, 2, 1]}
          rotation-y={Math.PI / 2}
          scale={[16, 6, 1]}
        />
        <Lightformer
          form="rect"
          intensity={2}
          position={[6, 2, 1]}
          rotation-y={-Math.PI / 2}
          scale={[16, 6, 1]}
        />
        <Lightformer
          form="ring"
          intensity={2.5}
          position={[0, 8, 2]}
          scale={3}
        />
      </Environment>

      {/* The room itself lives inside the scaled group, next to the model. */}
      <group
        position={[0, -MODEL_CENTER_Y * fitScale, 0]}
        scale={fitScale}
      >
        <Room />

        <Mechanism ref={mechanismRef} cardCount={projects.length}>
          {/* Cards ride inside the wheel, so the shared rotation above carries
              them around their rails together with the rods. */}
          <group ref={cardsRef}>
            {projects.map((project, index) => (
              <ProjectCard3D
                key={project.id}
                project={project}
                index={index}
                step={step}
                suppressCardClickRef={suppressCardClickRef}
                onClick={() => onCardClick(index)}
              />
            ))}
          </group>
        </Mechanism>

        <DeskBase />
      </group>

      <ContactShadows
        position={[0, floorY + 0.012, 0]}
        opacity={0.3}
        scale={13 * fitScale}
        blur={2.8}
        far={8}
      />
    </>
  );
}

const Mechanism = forwardRef<
  THREE.Group,
  { cardCount: number; children?: ReactNode }
>(function MechanismInner(
  {
    cardCount,
    children,
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
        <cylinderGeometry args={[0.095, 0.095, AXLE_LENGTH, 32]} />
        <meshStandardMaterial
          color="#d6d8dc"
          roughness={0.25}
          metalness={0.85}
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
              color="#e0e2e6"
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
              color="#cfd1d6"
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
                color="#e6e8ec"
                roughness={0.28}
                metalness={0.8}
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
              RAIL_RADIUS,
              RAIL_RADIUS,
              WHEEL_HALF_WIDTH * 2 + 0.16,
              18,
            ]}
          />
          <meshStandardMaterial
            color="#e8eaee"
            roughness={0.26}
            metalness={0.82}
          />
        </mesh>
      ))}

      {children}
    </group>
  );
});

/**
 * One card hanger, drawn at its own origin — the rod's axis.
 *
 * A bearing collar rides the rod, a neck drops from it, and a riveted plate
 * straddles the card's top edge.  Each joint overlaps its neighbour rather than
 * sitting flush, and every face that meets the card is offset from the card's
 * own faces, so no two surfaces are ever coplanar and nothing touches the rod.
 */
function Hanger() {
  const plateThickness = CARD_DEPTH + 0.045;

  return (
    <>
      {/* Bearing collar, riding the rod */}
      <mesh rotation={[0, Math.PI / 2, 0]} castShadow>
        <torusGeometry args={[HINGE_RADIUS, HINGE_TUBE, 20, 36]} />
        <meshStandardMaterial
          color="#eceef2"
          roughness={0.2}
          metalness={0.88}
        />
      </mesh>

      {/* Neck.  Its top stops short of the collar's bore, so it can never reach
          the rod. */}
      <RoundedBox
        args={[0.2, 0.14, 0.1]}
        radius={0.03}
        smoothness={4}
        position={[0, -0.12, 0]}
        castShadow
      >
        <meshStandardMaterial
          color="#e8eaee"
          roughness={0.3}
          metalness={0.75}
        />
      </RoundedBox>

      {/* Plate, riveted over the card's top edge.  It is thicker than the card,
          so it stands proud of both faces instead of sharing their planes. */}
      <RoundedBox
        args={[0.44, 0.26, plateThickness]}
        radius={0.05}
        smoothness={4}
        position={[0, -0.26, 0]}
        castShadow
      >
        <meshStandardMaterial
          color="#e8eaee"
          roughness={0.3}
          metalness={0.75}
        />
      </RoundedBox>

      {/* Rivet heads, set into the plate so they share no plane with it. */}
      {[1, -1].map((side) => (
        <mesh
          key={side}
          position={[0, -0.31, (side * plateThickness) / 2]}
          rotation={[Math.PI / 2, 0, 0]}
          castShadow
        >
          <cylinderGeometry args={[0.036, 0.036, 0.04, 14]} />
          <meshStandardMaterial
            color="#f4f6f8"
            roughness={0.24}
            metalness={0.85}
          />
        </mesh>
      ))}
    </>
  );
}

function ProjectCard3D({
  project,
  index,
  step,
  suppressCardClickRef,
  onClick,
}: {
  project: RolodexProject;
  index: number;
  step: number;
  suppressCardClickRef: MutableRefObject<boolean>;
  onClick: () => void;
}) {
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
      position={[
        0,
        Math.sin(index * step) * WHEEL_RADIUS,
        Math.cos(index * step) * WHEEL_RADIUS,
      ]}
      onClick={handleClick}
      onPointerOver={(event) => {
        event.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "";
      }}
    >
      {/* This group sits on its rail's point of the circle, inside the wheel's
          own space, so the wheel's rotation carries the card and its eyelets
          around together with the rod.  The matching counter-rotation is applied
          to this same group by the scene, which is what keeps the card upright
          and front-facing at every angle. */}

      {/* The card body hangs below the rod. */}
      <group position={[0, -CARD_DROP, 0]}>
        {/* Card stock */}
        <RoundedBox
          args={[CARD_WIDTH, CARD_HEIGHT, CARD_DEPTH]}
          radius={0.11}
          smoothness={5}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial
            color="#ffffff"
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
      </group>

      {/* Two hangers, one either side of the card.  Each rides its own length
          of the rod that crosses the card. */}
      {[-1.98, 1.98].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <Hanger />
        </group>
      ))}
    </group>
  );
}

/**
 * Procedural veneer for the desk top: a warm base, long grain running the length
 * of the desk, and seams between laid leaves.  Drawn to a canvas, so the
 * component needs no image files.
 */
function makeVeneerTexture(): THREE.Texture | null {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#96663e";
  ctx.fillRect(0, 0, size, size);

  // Long grain.
  for (let i = 0; i < 1600; i++) {
    const alpha = 0.03 + Math.random() * 0.05;
    ctx.fillStyle =
      Math.random() > 0.45
        ? `rgba(255, 223, 183, ${alpha})`
        : `rgba(64, 34, 16, ${alpha})`;
    ctx.fillRect(0, Math.random() * size, size, 0.5 + Math.random() * 2.5);
  }

  // Figure in the veneer.
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = `rgba(84, 46, 22, ${0.05 + Math.random() * 0.06})`;
    ctx.fillRect(0, Math.random() * size, size, 2 + Math.random() * 10);
  }

  // Seams between leaves of veneer.
  ctx.fillStyle = "rgba(48, 25, 11, 0.5)";
  for (const x of [0.34, 0.67]) {
    ctx.fillRect(x * size - 1.5, 0, 3, size);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A soft vertical wash, so the wall reads as a surface rather than a void. */
function makeWallTexture(): THREE.Texture | null {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 256;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const wash = ctx.createLinearGradient(0, 0, 0, 256);
  wash.addColorStop(0, "#ffffff");
  wash.addColorStop(0.6, "#f2eee7");
  wash.addColorStop(1, "#ded6c9");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, 4, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The room the assembly stands in: a veneer desk top at the height the stand
 * rests on, and a wall rising behind it.  Both live inside the model's own
 * scaled group, so the setting stays in proportion at every viewport size.
 */
function Room() {
  const veneer = useMemo(() => makeVeneerTexture(), []);
  const wallWash = useMemo(() => makeWallTexture(), []);

  return (
    <group>
      {/* Desk top.  Its upper face is exactly the ground the feet rest on. */}
      <mesh
        position={[
          0,
          DESK_TOP - DESK_THICKNESS / 2,
          DESK_BACK_Z + DESK_DEPTH / 2,
        ]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[DESK_WIDTH, DESK_THICKNESS, DESK_DEPTH]} />
        <meshStandardMaterial map={veneer} roughness={0.44} metalness={0} />
      </mesh>

      {/* Wall behind, rising from the desk's back edge. */}
      <mesh position={[0, DESK_TOP + WALL_HEIGHT / 2, WALL_Z]} receiveShadow>
        <planeGeometry args={[WALL_HALF_WIDTH * 2, WALL_HEIGHT]} />
        <meshStandardMaterial map={wallWash} roughness={0.95} metalness={0} />
      </mesh>
    </group>
  );
}

function DeskBase() {
  return (
    <group position={[0, DESK_Y, -0.3]}>
      {/* Feet */}
      {[-WHEEL_HALF_WIDTH, WHEEL_HALF_WIDTH].map((x) => (
        <RoundedBox
          key={x}
          args={[0.54, DESK_FOOT_HEIGHT, 2.2]}
          radius={0.13}
          smoothness={4}
          position={[x, 0, 0]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial
            color="#dfe1e5"
            roughness={0.35}
            metalness={0.7}
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
          color="#e4e6ea"
          roughness={0.34}
          metalness={0.7}
        />
      </RoundedBox>

      {/* Uprights to the wheel hub */}
      {[-WHEEL_HALF_WIDTH, WHEEL_HALF_WIDTH].map((x) => (
        <RoundedBox
          key={`upright-${x}`}
          args={[0.27, DESK_UPRIGHT_HEIGHT, 0.34]}
          radius={0.09}
          smoothness={4}
          position={[x, DESK_UPRIGHT_HEIGHT / 2, -0.14]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial
            color="#e2e4e8"
            roughness={0.34}
            metalness={0.72}
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

    </div>
  );
}
