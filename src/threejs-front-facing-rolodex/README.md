# Three.js front-facing Rolodex

This is the **real 3D version**, not a CSS card carousel.

## What is actually 3D

The WebGL scene contains:

- two side wheel rings
- hubs
- a central horizontal axle
- visible spokes
- one rotating metal mounting rail per project card
- desk feet / support frame
- thick project cards with image surfaces, and a hinged hanger on each side

The wheel assembly genuinely rotates around the X axis.

The cards **do not inherit the wheel rotation**. Each card's position follows
its physical rail around the wheel, then applies the equal and opposite X
rotation about its own rail axis so its face stays toward the viewer. Because the
cards live inside the rotating wheel, one and the same matrix carries card, rod
and hinge, so they cannot drift apart or lag by a frame.

On top of that they **sway**. A hanging card is not welded to its rod: when the
wheel moves it lags, swinging a few degrees about the rod's own axis — the only
motion that preserves its facing. The swing is scaled by each card's position, so
it is strongest at the top and bottom of the wheel where a hinge travels fastest
through the screen plane, and it dies away once the wheel stops.

## Interaction

- Mouse wheel / trackpad: vertical movement rotates the wheel.
- Touch: vertical swipe rotates it.
- The wheel is left exactly where it is put: it never snaps or self-aligns.
- Clicking a non-front card rotates it to the front.
- Clicking the front card selects it.
- Desktop: project information appears in the right-hand column.
- Phone: project information opens in a bottom drawer.

The component fills `100svh`.

## The scene

The piece is not floating in a void. It stands on a real desk, in a real
photographed room, at real scale:

- `public/models/woodentable01/WoodenTable_01_1k.gltf` — a wooden table
  (180 × 55 × 66 cm) from [Poly Haven](https://polyhaven.com), with
  base-colour, normal and metallic-roughness maps. **CC0**, no attribution
  required.
- `public/hdri/art_studio_512.hdr` — a photographed studio interior from Poly
  Haven, **CC0**, downscaled from the 1k original to 512×256. It supplies the
  light and the reflections on the metal, and it is only ever sampled for
  lighting and for a blurred reflection, so the extra resolution bought nothing
  visible.
- `public/textures/wall/` — `beige_wall_001`, a 3 m painted plaster scan. The
  office wall is a **real plane** standing 6 m behind the desk, not a background
  image: a background sits at infinity, so it has no parallax and always reads
  flat. Colour, normal and roughness maps.
- `public/textures/floor/` — `concrete_floor_painted`, a 2 m scan, for the
  floor the desk stands on.

Both texture sets are WebP re-encodes of the original JPEG scans — normal maps
at quality 90, the rest at 85 — which halved their weight.
- A doorway, skirting and floor give the room scale and a vanishing line; the
  door is 0.9 × 2.05 m and offset left, clear of the piece's silhouette.
- `@react-three/postprocessing` adds ambient occlusion and a slight vignette;
  `SoftShadows` widens the shadow penumbra.

**Everything is metric.** A rolodex card is 5 inches — 0.127 m — wide, and the
model's card is `CARD_WIDTH` units, so:

```ts
const UNITS_PER_METRE = CARD_WIDTH / 0.127;
```

One unit is 2.51 cm, which puts the assembled piece at about 23 cm tall and the
desk at its true size. The desk glTF is modelled in metres with its origin on the
floor, so `Desk` scales it by `UNITS_PER_METRE` and drops it until its top
surface sits exactly on `GROUND_Y`.

To use your own desk or room, drop a model into `public/` and point `DESK_URL`
and `ROOM_HDRI` at it. If you swap the HDRI, keep it under a couple of megabytes:
a 1k `.hdr` is plenty for reflections and a blurred backdrop.

## Install dependencies

For a React 19 / current Next.js project:

```bash
npm install three @react-three/fiber @react-three/drei @react-three/postprocessing postprocessing
```

or:

```bash
pnpm add three @react-three/fiber @react-three/drei @react-three/postprocessing postprocessing
```

## Copy these two files

```text
components/
  ThreeDRolodex/
    ThreeDRolodex.tsx
    ThreeDRolodex.module.css
```

See `example-page.tsx` for usage.

## Your own project images

Put images somewhere under `public`, for example:

```text
public/
  projects/
    intuition.jpg
    forge.jpg
    atlas.jpg
```

Then edit only the data array:

```ts
const projects = [
  {
    id: "project-one",
    title: "Project One",
    image: "/projects/project-one.jpg",
    href: "/projects/project-one",
    eyebrow: "Web / Product",
    description: "Your description.",
    tags: ["React", "3D"],
  },
];
```

The image is mapped directly onto the physical 3D card.

## Important geometry controls

At the top of `ThreeDRolodex.tsx`:

```ts
const WHEEL_RADIUS = 3.05;
const WHEEL_HALF_WIDTH = 3.22;
const WHEEL_Y = 1.42;

const STAND_X = WHEEL_HALF_WIDTH + 0.33; // uprights, clear of the rims
const CARD_WIDTH = 4.55;
const CARD_HEIGHT = 2.86;
```

- Increase `WHEEL_RADIUS` for a larger circular mechanism.
- Increase `WHEEL_HALF_WIDTH` to expose more frame outside the cards.
- `WHEEL_Y` is the gimbal/pivot height on each upright card.
- Change the card dimensions if your images use a different aspect ratio, but keep
  `CARD_HEIGHT` below `WHEEL_RADIUS + CARD_TOP_EDGE − 0.095` — 2.905 at these
  values. The card at the top of the wheel hangs down past the hub, and anything
  taller reaches through the axle.
- `STAND_X` must stay at least `WHEEL_HALF_WIDTH + 0.105 + 0.135` out, or the rims
  pass through the uprights.

## Feel of the interaction

Search for:

```ts
rawDelta * 0.00155
```

to change wheel sensitivity.

Search for:

```ts
const pixelsPerProject = 180;
```

to change touch drag distance per project.

The damping value (`10.5`) controls how physical/heavy the wheel feels.

## Notes

Use same-origin images from `public/` where possible. Remote image servers need
to permit cross-origin texture loading.

This intentionally uses standard WebGL through React Three Fiber rather than
WebGPU-only features so it works across a broad browser range.
