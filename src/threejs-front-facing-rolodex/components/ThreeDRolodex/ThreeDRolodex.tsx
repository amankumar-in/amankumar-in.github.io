"use client";

import * as THREE from "three";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import {
  ContactShadows,
  Environment,
  Image as DreiImage,
  RoundedBox,
  SoftShadows,
  useGLTF,
} from "@react-three/drei";
import {
  EffectComposer,
  N8AO,
  Vignette,
} from "@react-three/postprocessing";
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
import { dismissBoot } from "../../../boot";
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

/**
 * The stand's uprights.  They used to sit on the same x as the rims, so the rims
 * passed straight through them: a rim's outer edge is WHEEL_HALF_WIDTH + 0.105
 * and an upright is 0.27 across, so its centre has to be at least 0.24 further
 * out.  At 0.33 further out there is a clear gap, and the axle — which ends at
 * 3.575 — still lands inside the upright, so the stand goes on carrying the
 * wheel rather than just standing beside it.
 */
const STAND_X = WHEEL_HALF_WIDTH + 0.33;
const STAND_FOOT_WIDTH = 0.54;
const STAND_HALF_WIDTH = STAND_X + STAND_FOOT_WIDTH / 2;

/**
 * Card size.  These are the original proportions, restored.
 *
 * The height is not capped by the axle, and it cannot be.  The card reaches
 * CARD_HEIGHT - CARD_TOP_EDGE = 3.25 from its hinge while the hinge always sits
 * 3.05 from the axle, so the card runs 0.20 past the wheel's centre.  Its swept
 * envelope therefore contains the axle at *every* sway angle — the overlap is on
 * the swept path, not on the swing path — so no contact response can nudge it
 * clear; only a jam could, and that would break the free rotation.  The two
 * honest fixes are a card under 2.84 (reach < WHEEL_RADIUS - 0.14) or a wheel
 * radius above 3.39, and neither is free: the auto-framing fits the whole
 * assembly, so a bigger wheel gives back the very size the card gained.
 */
const CARD_WIDTH = 5.05;
const CARD_HEIGHT = 3.18;
const CARD_DEPTH = 0.09;

/** Radius of the rod each card hangs from. */
const RAIL_RADIUS = 0.028;

/** Radius of the axle through the middle of the wheel. */
const AXLE_RADIUS = 0.095;

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

/**
 * Sway physics.  Everything here is in model units, and one unit is 2.51 cm, so
 * real gravity is 9.81 / 0.0251 = 390.8 units/s².  A hanging card is a pendulum
 * about its rod's axis, so its period comes from g and the hinge-to-centre
 * distance — a 3.6 cm pendulum, which is what a card this size gives, rings at
 * about 2.6 Hz.  Raising SWAY_LENGTH slows the swing without changing how far it
 * swings, because the amplitude comes from the acceleration, not the length.
 */
const GRAVITY = 9.81 / 0.0251;
const SWAY_LENGTH = CARD_DROP;
const SWAY_STIFFNESS = GRAVITY / SWAY_LENGTH;
const SWAY_DAMPING = 2 * 0.22 * Math.sqrt(SWAY_STIFFNESS);
/** Hard stop, so nothing can ever swing into the axle. */
const SWAY_LIMIT = 0.28;

/**
 * Sway exaggeration.  1 is physically exact, and at the speeds a mouse wheel
 * actually produces that is a 4.7° swing — real, but too small to read.  3 makes
 * it about 14°, and a fast spin put the front and back cards on the stop.  The
 * shape of the motion is untouched: only the driving acceleration is scaled.
 */
const SWAY_GAIN = 3;

/**
 * The longest step the sway integrator may take, in seconds.
 *
 * `useFrame` hands the physics whatever delta the frame loop produced.  While
 * the wheel is settling that is a normal frame — 16 ms — but the clock asks for
 * a frame of its own once a second, and that frame arrives with a delta of 1.0.
 * A step that long is past the integrator's stability limit: with SWAY_DAMPING
 * at 6.4 it multiplies a card's velocity by about 6.4 instead of damping it, so
 * every clock tick threw the cards back into motion.  The settle test in the
 * frame loop could then never be satisfied, and the scene rendered at 60 fps
 * forever — a still image with a still wheel, holding the GPU at ~80%.
 *
 * Clamped, the impulse a clock tick can inject is proportional to the sway that
 * is already there, so a card that has come to rest stays at rest.
 */
const MAX_FRAME_STEP = 1 / 30;

const AXLE_LENGTH = 7.15;

/**
 * Extent of the assembled model, measured from the scene origin.
 *
 * The hangers orbit the origin at WHEEL_RADIUS and every card hangs CARD_DROP
 * below the rod it is clipped to, so the assembly is no longer symmetric about
 * y = 0: the highest point is the wheel's own ring and the lowest is the bottom
 * card's lower edge.  The widest is the stand's feet.  MODEL_CENTER_Y is the
 * offset applied to the scene group so that framed box ends up centred on the
 * camera axis.
 */
const MODEL_TOP = Math.max(
  WHEEL_Y + WHEEL_RADIUS + 0.105, // the wheel's rings
  WHEEL_Y + WHEEL_RADIUS + HINGE_OUTER_RADIUS, // collar at the top of the orbit
  WHEEL_Y + WHEEL_RADIUS + CARD_TOP_EDGE // top card's top edge
);
const MODEL_BOTTOM = WHEEL_Y - WHEEL_RADIUS + CARD_TOP_EDGE - CARD_HEIGHT;
const MODEL_CENTER_Y = (MODEL_TOP + MODEL_BOTTOM) / 2;
const MODEL_HALF_HEIGHT = (MODEL_TOP - MODEL_BOTTOM) / 2;

/**
 * Widest parts of the model, each paired with its own z.  The desk feet are
 * narrower than the axle but sit nearer the camera, so perspective magnifies
 * them more and they are the real horizontal limit on narrow viewports.
 */
const WIDTH_EXTENTS = [
  { halfWidth: AXLE_LENGTH / 2, z: 0 },
  { halfWidth: STAND_HALF_WIDTH, z: 0.8 },
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
 * The scene is built at real scale.  A rolodex card is 5 inches wide — 0.127 m —
 * and the model's card is CARD_WIDTH units, so that ratio is how many units make
 * a metre.  Every real-world measurement (the desk, the lighting rig, the depth
 * of field) follows from it instead of being eyeballed.
 */
const UNITS_PER_METRE = CARD_WIDTH / 0.127;

/** A real wooden table, modelled in metres, standing in for the desk. */
const DESK_URL = "/models/woodentable01/WoodenTable_01_1k.gltf";

/**
 * A photographed studio room, used for the light, the reflections and the
 * blurred backdrop.
 *
 * Held at 512x256.  It is only ever sampled for lighting and for a blurred
 * reflection, so the extra octaves in the 1k original cost 1.3 MB and bought
 * nothing visible — the peak highlight survives the downscale at 90.5 against
 * the original's 91.5.
 */
const ROOM_HDRI = "/hdri/art_studio_512.hdr";

/**
 * The office the desk stands in.
 *
 * The wall is a real plane, not a background image: a background sits at
 * infinity, so it has no parallax and reads flat at any distance.  Both
 * textures publish their physical size (beige_wall_001 is a 3 m scan,
 * concrete_floor_painted a 2 m one), so the repeats are set in metres instead of
 * being eyeballed.
 *
 * The maps are WebP re-encodes of the original JPEG scans — normal maps at
 * quality 90, the rest at 85, which halved the room's texture weight.  The
 * untouched 1k JPEGs are in git history if they ever need redoing at a
 * different quality.
 */
const WALL_MAPS = [
  "/textures/wall/beige_wall_001_diff_1k.webp",
  "/textures/wall/beige_wall_001_nor_gl_1k.webp",
  "/textures/wall/beige_wall_001_rough_1k.webp",
];
const FLOOR_MAPS = [
  "/textures/floor/concrete_floor_painted_diff_1k.webp",
  "/textures/floor/concrete_floor_painted_nor_gl_1k.webp",
  "/textures/floor/concrete_floor_painted_arm_1k.webp",
];

const WALL_TEXTURE_METRES = 3;
const FLOOR_TEXTURE_METRES = 2;

/**
 * The desk's own footprint, measured from its glTF: 1.8 × 0.549 × 0.657 m.  Its
 * height sets where the office floor is, and its depth sets how far the wall
 * stands behind it.
 */
const DESK_HEIGHT_METRES = 0.549;
const DESK_DEPTH_METRES = 0.657;

const ROOM_WIDTH_METRES = 12;
const WALL_HEIGHT_METRES = 7;
/** How far the wall stands behind the desk. */
const ROOM_DEPTH_METRES = 6;
const SKIRTING_HEIGHT_METRES = 0.1;
const SKIRTING_DEPTH_METRES = 0.02;

const DOOR_WIDTH_METRES = 0.9;
const DOOR_HEIGHT_METRES = 2.05;
const DOOR_THICKNESS_METRES = 0.045;
const DOOR_CASING_METRES = 0.08;
const DOOR_CASING_DEPTH_METRES = 0.06;
/** Offset from the centre of the shot, so the doorway sits off to the left and
 *  clear of the piece's own silhouette (which projects to about ±0.96 m on the
 *  wall). */
const DOOR_OFFSET_METRES = -1.55;
const HANDLE_HEIGHT_METRES = 1.05;

/** The office floor: the level the desk's legs stand on. */
const FLOOR_LEVEL = GROUND_Y - DESK_HEIGHT_METRES * UNITS_PER_METRE;
const WALL_Z = -(DESK_DEPTH_METRES / 2 + ROOM_DEPTH_METRES) * UNITS_PER_METRE;

const FLOOR_FRONT_METRES = 4;
const FLOOR_BACK_METRES = ROOM_DEPTH_METRES + DESK_DEPTH_METRES;
const FLOOR_DEPTH_METRES = FLOOR_FRONT_METRES + FLOOR_BACK_METRES;
const FLOOR_CENTRE_Z =
  ((FLOOR_FRONT_METRES - FLOOR_BACK_METRES) / 2) * UNITS_PER_METRE;

/** The same dimensions in model units, so the JSX stays readable. */
const ROOM_WIDTH = ROOM_WIDTH_METRES * UNITS_PER_METRE;
const WALL_HEIGHT = WALL_HEIGHT_METRES * UNITS_PER_METRE;
const FLOOR_DEPTH = FLOOR_DEPTH_METRES * UNITS_PER_METRE;
const SKIRTING_HEIGHT = SKIRTING_HEIGHT_METRES * UNITS_PER_METRE;
const SKIRTING_DEPTH = SKIRTING_DEPTH_METRES * UNITS_PER_METRE;
const DOOR_WIDTH = DOOR_WIDTH_METRES * UNITS_PER_METRE;
const DOOR_HEIGHT = DOOR_HEIGHT_METRES * UNITS_PER_METRE;
const DOOR_THICKNESS = DOOR_THICKNESS_METRES * UNITS_PER_METRE;
const DOOR_STILE = 0.08 * UNITS_PER_METRE;
const DOOR_RAIL = 0.1 * UNITS_PER_METRE;
const DOOR_GLASS = 0.02 * UNITS_PER_METRE;
const DOOR_CASING = DOOR_CASING_METRES * UNITS_PER_METRE;
const DOOR_CASING_DEPTH = DOOR_CASING_DEPTH_METRES * UNITS_PER_METRE;
const DOOR_X = DOOR_OFFSET_METRES * UNITS_PER_METRE;
const HANDLE_HEIGHT = HANDLE_HEIGHT_METRES * UNITS_PER_METRE;

/** A small analogue clock, high on the wall, reading the real time. */
const CLOCK_X = 1.15 * UNITS_PER_METRE;
const CLOCK_Y = 1.9 * UNITS_PER_METRE;
const CLOCK_RADIUS = (0.25 / 2) * UNITS_PER_METRE;

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
  // Frames are rendered on demand, so anything that changes the scene has to ask
  // for one.  The canvas hands us its invalidate() once it has been created.
  const invalidateRef = useRef<(() => void) | null>(null);
  const targetRotationRef = useRef(0);
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

      // Scroll down => next project rotates to the front.  The wheel is left
      // exactly where it is put: a real one does not drift to the nearest card.
      targetRotationRef.current -= delta;
      syncActiveIndex(targetRotationRef.current);
      invalidateRef.current?.();
    };

    stage.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      stage.removeEventListener("wheel", onWheel);
    };
  }, [count, step, syncActiveIndex]);

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
    invalidateRef.current?.();
  };

  const finishPointer = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    suppressCardClickRef.current = drag.moved;
    dragRef.current = null;
  };

  const bringCardToFront = useCallback(
    (index: number) => {
      if (!count) return;

      const baseTarget = -index * step;
      targetRotationRef.current = nearestEquivalentAngle(
        baseTarget,
        targetRotationRef.current
      );
      invalidateRef.current?.();
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
          {/* Render on demand.  A still scene should cost nothing, so frames are
              produced only when something actually changes: the wheel settling,
              a drag, the clock's next second, or a resize. */}
          <Canvas
            shadows
            frameloop="demand"
            dpr={[1, 1.5]}
            onCreated={(state) => {
              invalidateRef.current = state.invalidate;
            }}
            camera={{
              position: [0, 0, 12.2],
              fov: 34,
              near: 0.5,
              far: 400,
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
              <BootHandoff />
            </Suspense>

            {/* Post: ambient occlusion seats the parts against the desk, and the
                vignette closes the frame.  No blur passes — every surface,
                including the front card, is drawn at full resolution. */}
            <EffectComposer multisampling={4}>
              <N8AO
                halfRes={false}
                aoRadius={1.6}
                intensity={2.2}
                distanceFalloff={1}
              />
              <Vignette offset={0.2} darkness={0.42} />
            </EffectComposer>
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

/**
 * Takes the splash away.
 *
 * It sits inside the same Suspense boundary as the scene, so it does not mount
 * until every asset has resolved, and `useFrame` only runs on a frame that is
 * about to be drawn — so the first call here means the scene is on screen and
 * the splash's cross-fade has something real to reveal.
 */
function BootHandoff() {
  const handedOver = useRef(false);

  useFrame(() => {
    if (handedOver.current) return;
    handedOver.current = true;
    dismissBoot();
  });

  return null;
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
  const swayRef = useRef<number[]>([]);
  const swayVelocityRef = useRef<number[]>([]);
  const previousRotationRef = useRef(0);
  const previousVelocityRef = useRef(0);
  // Selectors rather than the whole store: a bare useThree() re-renders this
  // component on every store change, including each pointer move.
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);

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
    // The frame loop's delta is the real time since the last frame, which is
    // not the same thing as a simulation step: the clock's once-a-second
    // invalidate produces a 1.0 second gap on an otherwise idle scene.  The
    // rotation may take that step — damp is exponential and stable at any
    // delta — but the sway integrator may not.  See MAX_FRAME_STEP.
    const dt = Math.min(delta, MAX_FRAME_STEP);
    const sparse = delta > MAX_FRAME_STEP;

    const rotation = THREE.MathUtils.damp(
      actualRotationRef.current,
      targetRotationRef.current,
      10.5,
      delta
    );
    const previousRotation = previousRotationRef.current;
    // A frame that arrives after a gap says nothing trustworthy about how the
    // cards are accelerating — nobody watched the interval it covers — so it
    // excites nothing and only carries the rotation on.
    const angularVelocity =
      !sparse && delta > 0 ? (rotation - previousRotation) / delta : 0;
    const angularAcceleration =
      !sparse && delta > 0
        ? (angularVelocity - previousVelocityRef.current) / delta
        : 0;
    previousRotationRef.current = rotation;
    previousVelocityRef.current = angularVelocity;
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

    // Sway.  Each card is a pendulum hanging from its own rod, and what swings it
    // is the acceleration of its hinge along z — the direction through the
    // screen.  That acceleration has two parts, and which card feels which is the
    // whole story:
    //
    //   tangential     -WHEEL_RADIUS * sin(theta) * alpha    top and bottom
    //   centripetal    -WHEEL_RADIUS * cos(theta) * omega^2   front and back
    //
    // So a wheel notch — a sharp alpha at low omega — kicks the top and bottom
    // cards into a visible ring, while a fast spin keeps a lean on the front and
    // back cards that grows with the square of the speed.  That is what a card on
    // a hinge actually does, and it is why driving this from velocity alone
    // (as it was) only ever moved one card.
    //
    // Every card integrates its own pendulum, so they ring out of phase with one
    // another instead of moving as a single object.
    const cards = cardsRef.current;
    if (cards) {
      const cardCount = cards.children.length;
      if (swayRef.current.length !== cardCount) {
        swayRef.current = new Array<number>(cardCount).fill(0);
        swayVelocityRef.current = new Array<number>(cardCount).fill(0);
      }

      cards.children.forEach((card, index) => {
        const theta = index * step + rotation;
        const hingeAccelerationZ =
          -WHEEL_RADIUS *
          (Math.cos(theta) * angularVelocity * angularVelocity +
            Math.sin(theta) * angularAcceleration);
        const equilibrium = THREE.MathUtils.clamp(
          (hingeAccelerationZ / GRAVITY) * SWAY_GAIN,
          -0.5,
          0.5
        );

        // The cards are only integrated on frames that actually observed the
        // interval.  A sparse frame — the clock's tick — is not evidence of
        // anything having moved, and integrating it would inject a force
        // proportional to the sway it found, which is the mechanism that used
        // to keep the loop alive.  The rotation is still written, because the
        // wheel really did advance.
        if (!sparse) {
          const restoring =
            (equilibrium - swayRef.current[index]) * SWAY_STIFFNESS -
            swayVelocityRef.current[index] * SWAY_DAMPING;
          swayVelocityRef.current[index] += restoring * dt;
          swayRef.current[index] = THREE.MathUtils.clamp(
            swayRef.current[index] + swayVelocityRef.current[index] * dt,
            -SWAY_LIMIT,
            SWAY_LIMIT
          );
        }

        card.rotation.x = rotation + swayRef.current[index];
      });
    }

    // Keep frames coming while the wheel is settling or any card is still
    // swinging, then let the loop go quiet.  This is what makes an idle scene
    // cost nothing — and it only holds because the integrator above is stepped
    // with a clamped dt: an unclamped 1-second frame would re-excite the cards
    // on every clock tick and this test would never pass.
    const swayPeak = Math.max(0, ...swayRef.current.map(Math.abs));
    const swayVelocityPeak = Math.max(
      0,
      ...swayVelocityRef.current.map(Math.abs)
    );

    const settled =
      Math.abs(rotation - targetRotationRef.current) <= 0.0005 &&
      swayPeak <= 0.0005 &&
      swayVelocityPeak <= 0.0005;

    // At rest means at rest.  The loop stops on the first frame whose peak is
    // under the threshold, which can leave a residue well below a hundredth of
    // a degree — invisible, but it would park the cards off plumb, and since
    // sparse frames no longer integrate it would never decay away.  Zeroing it
    // also means every later frame has nothing to compute.
    if (settled && (swayPeak > 0 || swayVelocityPeak > 0)) {
      swayRef.current.fill(0);
      swayVelocityRef.current.fill(0);
    }

    if (!settled) {
      invalidate();
    }
  });

  return (
    <>
      {/* Fallback clear colour; the office wall covers it. */}
      <color attach="background" args={["#e8e4dd"]} />

      {/* The room's light: a photographed studio, used for the environment and
          reflections.  Its own backdrop is deliberately not used — see the Room
          component for why — and no blur is applied to what it lights. */}
      <Environment files={ROOM_HDRI} environmentIntensity={1} />

      {/* Widens the shadow penumbra so the cast shadow reads as diffuse daylight
          rather than a hard-edged stencil. */}
      <SoftShadows size={20} samples={8} focus={0.6} />

      {/* The HDRI carries the fill and the reflections; one key light adds a
          definite shadow across the desk. */}
      <directionalLight
        castShadow
        position={[4, 7, 9]}
        intensity={1.15}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={0.1}
        shadow-camera-far={40}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
      />

      {/* The room itself lives inside the scaled group, next to the model. */}
      <group
        position={[0, -MODEL_CENTER_Y * fitScale, 0]}
        scale={fitScale}
      >
        <Room />

        <Clock fitScale={fitScale} />

        <Desk />

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
        opacity={0.24}
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
        <cylinderGeometry args={[AXLE_RADIUS, AXLE_RADIUS, AXLE_LENGTH, 32]} />
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

      {/* One real mounting rail for every card.
          They cast onto the cards but deliberately do not receive: a rod is
          0.056 units across, so it covers only about five texels of the shadow
          map — too few to self-shadow cleanly, which shows up as speckle. */}
      {railAngles.map((angle) => (
        <mesh
          key={angle}
          castShadow
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
 * A small analogue clock on the wall, reading the actual time.
 *
 * The hands are driven from Date every frame, so it always shows the current
 * time.  It also earns its place as a scale reference: everyone knows roughly
 * how big a wall clock is, which is exactly the kind of anchor a plain wall
 * lacks.
 */
function Clock({ fitScale }: { fitScale: number }) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const hourRef = useRef<THREE.Group>(null);
  const minuteRef = useRef<THREE.Group>(null);
  const secondRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const now = new Date();
    const seconds = now.getSeconds() + now.getMilliseconds() / 1000;
    const minutes = now.getMinutes() + seconds / 60;
    const hours = (now.getHours() % 12) + minutes / 60;

    if (hourRef.current) {
      hourRef.current.rotation.z = -(hours / 12) * TAU;
    }
    if (minuteRef.current) {
      minuteRef.current.rotation.z = -(minutes / 60) * TAU;
    }
    if (secondRef.current) {
      secondRef.current.rotation.z = -(seconds / 60) * TAU;
    }
  });

  // On-demand rendering means the clock asks for its own frames: one per second.
  // A tick rather than a sweep is also what a real analogue clock does, so the
  // hands stepping is correct rather than a compromise.
  useEffect(() => {
    const id = window.setInterval(() => invalidate(), 1000);
    return () => window.clearInterval(id);
  }, [invalidate]);

  const marks = useMemo(
    () => Array.from({ length: 12 }, (_, index) => (index / 12) * TAU),
    []
  );

  // The clock is positioned in screen pixels, so the offset is converted at the
  // clock's own depth.  An offset written in world units would drift as the model
  // is reframed for a different viewport; this stays exactly 150 px / 200 px.
  const offset = useMemo(() => {
    const perspective = camera as THREE.PerspectiveCamera;
    const halfFov = THREE.MathUtils.degToRad(perspective.fov) / 2;
    const aspect = size.width / Math.max(1, size.height);
    const distance = Math.abs(perspective.position.z) - (WALL_Z + 1) * fitScale;
    const worldHalfHeight = Math.tan(halfFov) * distance;
    const worldHalfWidth = worldHalfHeight * aspect;
    const localPerPixel =
      (worldHalfHeight * 2) / Math.max(1, size.height) / fitScale;

    // The same breakpoint the stylesheet uses to switch to the phone layout.
    // It has to come from the viewport, not the canvas: on a desktop window the
    // canvas is only the left column, so it measures well under 860 px while the
    // page is still in its desktop layout.
    if (window.matchMedia("(max-width: 860px)").matches) {
      const centreNdcY =
        ((FLOOR_LEVEL + CLOCK_Y - MODEL_CENTER_Y) * fitScale) / worldHalfHeight;
      const radiusNdcY = (CLOCK_RADIUS * fitScale) / worldHalfHeight;
      const room = Math.max(0, 1 - radiusNdcY - centreNdcY);
      return {
        x: 0,
        y: Math.min(150 * localPerPixel, (room * worldHalfHeight) / fitScale),
      };
    }

    const centreNdcX = (CLOCK_X * fitScale) / worldHalfWidth;
    const radiusNdcX = (CLOCK_RADIUS * fitScale) / worldHalfWidth;
    const room = Math.max(0, 1 - radiusNdcX - centreNdcX);
    return {
      x: Math.min(200 * localPerPixel, (room * worldHalfWidth) / fitScale),
      y: 0,
    };
  }, [camera, size.width, size.height, fitScale]);

  return (
    <group
      position={[
        CLOCK_X + offset.x,
        FLOOR_LEVEL + CLOCK_Y + offset.y,
        WALL_Z + 1,
      ]}
    >
      {/* Case */}
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[CLOCK_RADIUS, CLOCK_RADIUS, 1.6, 40]} />
        <meshStandardMaterial color="#c8cacd" roughness={0.34} metalness={0.72} />
      </mesh>

      {/* Dial */}
      <mesh position={[0, 0, 0.85]}>
        <circleGeometry args={[CLOCK_RADIUS * 0.93, 40]} />
        <meshStandardMaterial color="#fbfaf7" roughness={0.62} metalness={0} />
      </mesh>

      {/* Hour marks */}
      {marks.map((angle) => (
        <mesh
          key={angle}
          position={[
            Math.sin(angle) * CLOCK_RADIUS * 0.76,
            Math.cos(angle) * CLOCK_RADIUS * 0.76,
            0.9,
          ]}
          rotation={[0, 0, -angle]}
        >
          <boxGeometry args={[0.3, 1, 0.2]} />
          <meshStandardMaterial color="#3d4045" roughness={0.5} metalness={0.1} />
        </mesh>
      ))}

      {/* Hands: each pivots at the dial's centre, so the geometry hangs off one
          end and the group's z rotation reads the time. */}
      <group ref={hourRef} position={[0, 0, 1]}>
        <mesh position={[0, CLOCK_RADIUS * 0.28, 0]}>
          <boxGeometry args={[0.6, CLOCK_RADIUS * 0.56, 0.22]} />
          <meshStandardMaterial
            color="#33363a"
            roughness={0.45}
            metalness={0.15}
          />
        </mesh>
      </group>

      <group ref={minuteRef} position={[0, 0, 1.1]}>
        <mesh position={[0, CLOCK_RADIUS * 0.4, 0]}>
          <boxGeometry args={[0.42, CLOCK_RADIUS * 0.8, 0.2]} />
          <meshStandardMaterial
            color="#33363a"
            roughness={0.45}
            metalness={0.15}
          />
        </mesh>
      </group>

      <group ref={secondRef} position={[0, 0, 1.2]}>
        <mesh position={[0, CLOCK_RADIUS * 0.44, 0]}>
          <boxGeometry args={[0.18, CLOCK_RADIUS * 0.88, 0.16]} />
          <meshStandardMaterial
            color="#8d9095"
            roughness={0.4}
            metalness={0.3}
          />
        </mesh>
      </group>

      {/* Centre cap */}
      <mesh position={[0, 0, 1.35]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.45, 0.45, 0.5, 16]} />
        <meshStandardMaterial color="#2c2e32" roughness={0.4} metalness={0.3} />
      </mesh>
    </group>
  );
}

/**
 * The office around the desk: floor, wall, skirting and a doorway.
 *
 * The wall is a real plane standing ROOM_DEPTH_METRES behind the desk, which is
 * the whole point — a background image sits at infinity, so it never shifts
 * against the subject and reads as flat no matter how far away it supposedly is.
 * Here the floor runs away to the wall, the wall's foot shadows into the
 * skirting, and the doorway gives the eye a known-size object to measure the
 * space against.
 */
function Room() {
  const [wallMap, wallNormal, wallRough] = useLoader(
    THREE.TextureLoader,
    WALL_MAPS
  );
  const [floorMap, floorNormal, floorArm] = useLoader(
    THREE.TextureLoader,
    FLOOR_MAPS
  );

  useMemo(() => {
    const prepare = (
      texture: THREE.Texture,
      colours: boolean,
      spanXMetres: number,
      spanYMetres: number,
      tileMetres: number
    ) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 8;
      texture.repeat.set(spanXMetres / tileMetres, spanYMetres / tileMetres);
      if (colours) texture.colorSpace = THREE.SRGBColorSpace;
    };

    // Only colour maps are sRGB; normal and roughness maps stay linear.
    prepare(wallMap, true, ROOM_WIDTH_METRES, WALL_HEIGHT_METRES, WALL_TEXTURE_METRES);
    prepare(wallNormal, false, ROOM_WIDTH_METRES, WALL_HEIGHT_METRES, WALL_TEXTURE_METRES);
    prepare(wallRough, false, ROOM_WIDTH_METRES, WALL_HEIGHT_METRES, WALL_TEXTURE_METRES);

    prepare(floorMap, true, ROOM_WIDTH_METRES, FLOOR_DEPTH_METRES, FLOOR_TEXTURE_METRES);
    prepare(floorNormal, false, ROOM_WIDTH_METRES, FLOOR_DEPTH_METRES, FLOOR_TEXTURE_METRES);
    prepare(floorArm, false, ROOM_WIDTH_METRES, FLOOR_DEPTH_METRES, FLOOR_TEXTURE_METRES);
  }, [wallMap, wallNormal, wallRough, floorMap, floorNormal, floorArm]);

  return (
    <group>
      {/* Floor, running from under the desk back to the wall. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, FLOOR_LEVEL, FLOOR_CENTRE_Z]}
        receiveShadow
      >
        <planeGeometry args={[ROOM_WIDTH, FLOOR_DEPTH]} />
        <meshStandardMaterial
          map={floorMap}
          normalMap={floorNormal}
          roughnessMap={floorArm}
          roughness={1}
          metalness={0}
        />
      </mesh>

      {/* The wall itself. */}
      <mesh position={[0, FLOOR_LEVEL + WALL_HEIGHT / 2, WALL_Z]} receiveShadow>
        <planeGeometry args={[ROOM_WIDTH, WALL_HEIGHT]} />
        <meshStandardMaterial
          map={wallMap}
          normalMap={wallNormal}
          roughnessMap={wallRough}
          roughness={1}
          metalness={0}
        />
      </mesh>

      {/* Skirting along the foot of the wall. */}
      <RoundedBox
        args={[ROOM_WIDTH, SKIRTING_HEIGHT, SKIRTING_DEPTH]}
        radius={0.3}
        smoothness={3}
        position={[
          0,
          FLOOR_LEVEL + SKIRTING_HEIGHT / 2,
          WALL_Z + SKIRTING_DEPTH / 2,
        ]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color="#f4f2ed" roughness={0.4} metalness={0} />
      </RoundedBox>

      {/* Doorway, off to the left: a known-size object that gives the room scale. */}
      <group position={[DOOR_X, FLOOR_LEVEL, WALL_Z]}>
        {[-1, 1].map((side) => (
          <RoundedBox
            key={side}
            args={[DOOR_CASING, DOOR_HEIGHT + DOOR_CASING, DOOR_CASING_DEPTH]}
            radius={0.4}
            smoothness={3}
            position={[
              (side * (DOOR_WIDTH + DOOR_CASING)) / 2,
              (DOOR_HEIGHT + DOOR_CASING) / 2,
              DOOR_CASING_DEPTH / 2,
            ]}
            castShadow
          >
            <meshStandardMaterial
              color="#f7f5f1"
              roughness={0.4}
              metalness={0}
            />
          </RoundedBox>
        ))}

        <RoundedBox
          args={[DOOR_WIDTH + DOOR_CASING * 2, DOOR_CASING, DOOR_CASING_DEPTH]}
          radius={0.4}
          smoothness={3}
          position={[0, DOOR_HEIGHT + DOOR_CASING / 2, DOOR_CASING_DEPTH / 2]}
          castShadow
        >
          <meshStandardMaterial color="#f7f5f1" roughness={0.4} metalness={0} />
        </RoundedBox>

        {/* A glass door: slim steel stiles and rails around a frosted pane. */}
        <group position={[0, 0, DOOR_CASING_DEPTH * 0.3]}>
          {[-1, 1].map((side) => (
            <mesh
              key={side}
              position={[
                (side * (DOOR_WIDTH - DOOR_STILE)) / 2,
                DOOR_HEIGHT / 2,
                0,
              ]}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[DOOR_STILE, DOOR_HEIGHT, DOOR_THICKNESS]} />
              <meshStandardMaterial
                color="#c3c6cb"
                roughness={0.28}
                metalness={0.85}
              />
            </mesh>
          ))}

          {[DOOR_RAIL / 2, DOOR_HEIGHT - DOOR_RAIL / 2].map((y) => (
            <mesh key={y} position={[0, y, 0]} castShadow receiveShadow>
              <boxGeometry
                args={[DOOR_WIDTH, DOOR_RAIL, DOOR_THICKNESS * 0.8]}
              />
              <meshStandardMaterial
                color="#c3c6cb"
                roughness={0.28}
                metalness={0.85}
              />
            </mesh>
          ))}

          {/* Frosted pane: it reads unmistakably as glass, and being frosted it
              does not need a real room behind it to look right. */}
          <mesh position={[0, DOOR_HEIGHT / 2, 0]}>
            <boxGeometry
              args={[
                DOOR_WIDTH - DOOR_STILE * 2,
                DOOR_HEIGHT - DOOR_RAIL * 2,
                DOOR_GLASS,
              ]}
            />
            {/* Frosted by opacity, not by `transmission`.  A transmission
                material makes three re-render the entire scene into a separate
                buffer every frame, which is heavy machinery for one pane and
                leaves the depth-based passes reading the wrong pass. */}
            <meshStandardMaterial
              color="#eef2f4"
              roughness={0.5}
              metalness={0}
              transparent
              opacity={0.55}
            />
          </mesh>

          {/* Pull handle, bolted through the glass. */}
          <mesh
            position={[DOOR_WIDTH / 2 - 6, HANDLE_HEIGHT, DOOR_GLASS / 2 + 3]}
            castShadow
          >
            <cylinderGeometry args={[0.7, 0.7, 22, 16]} />
            <meshStandardMaterial
              color="#cbcdd1"
              roughness={0.22}
              metalness={0.9}
            />
          </mesh>

          {[-8, 8].map((offset) => (
            <mesh
              key={offset}
              position={[
                DOOR_WIDTH / 2 - 6,
                HANDLE_HEIGHT + offset,
                DOOR_GLASS / 2 + 1.5,
              ]}
              rotation={[Math.PI / 2, 0, 0]}
            >
              <cylinderGeometry args={[0.4, 0.4, 3, 12]} />
              <meshStandardMaterial
                color="#cbcdd1"
                roughness={0.22}
                metalness={0.9}
              />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
}

/**
 * The desk: a real wooden table under the piece.
 *
 * The glTF is modelled in metres with its origin on the floor, so it is scaled
 * by UNITS_PER_METRE and then dropped until its top surface lands exactly on the
 * ground the stand's feet rest on, centred on the origin.
 */
function Desk() {
  const { scene } = useGLTF(DESK_URL);

  const desk = useMemo(() => {
    const instance = scene.clone(true);
    const bounds = new THREE.Box3().setFromObject(instance);
    const centre = bounds.getCenter(new THREE.Vector3());

    instance.scale.setScalar(UNITS_PER_METRE);
    instance.position.set(
      -centre.x * UNITS_PER_METRE,
      GROUND_Y - bounds.max.y * UNITS_PER_METRE,
      -centre.z * UNITS_PER_METRE
    );

    instance.traverse((child) => {
      child.castShadow = true;
      child.receiveShadow = true;
    });

    return instance;
  }, [scene]);

  return <primitive object={desk} />;
}

useGLTF.preload(DESK_URL);

function DeskBase() {
  return (
    <group position={[0, DESK_Y, -0.3]}>
      {/* Feet */}
      {[-STAND_X, STAND_X].map((x) => (
        <RoundedBox
          key={x}
          args={[STAND_FOOT_WIDTH, DESK_FOOT_HEIGHT, 2.2]}
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
        args={[STAND_HALF_WIDTH * 2, 0.19, 0.5]}
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

      {/* Uprights, outboard of the rims, carrying the axle */}
      {[-STAND_X, STAND_X].map((x) => (
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
