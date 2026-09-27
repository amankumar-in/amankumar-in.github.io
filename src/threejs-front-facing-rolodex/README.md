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
- thick project cards with image surfaces and metal clips

The wheel assembly genuinely rotates around the X axis.

The cards **do not inherit the wheel rotation**. Each card's position follows
its physical rail around the wheel, while the card's rotation remains `[0, 0, 0]`.
The wheel group uses the inverse X rotation so the rail and the independent card
remain spatially aligned throughout the turn. That is what keeps every project
image fully front-facing without faking the mechanism with a 2D slider.

## Interaction

- Mouse wheel / trackpad: vertical movement rotates the wheel.
- Touch: vertical swipe rotates it.
- Input snaps to the nearest project.
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
- `public/hdri/art_studio_1k.hdr` — a photographed studio interior from Poly
  Haven, **CC0**. It supplies the light and the reflections on the metal.
- `public/textures/wall/` — `beige_wall_001`, a 3 m painted plaster scan. The
  office wall is a **real plane** standing 6 m behind the desk, not a background
  image: a background sits at infinity, so it has no parallax and always reads
  flat. Colour, normal and roughness maps.
- `public/textures/floor/` — `concrete_floor_painted`, a 2 m scan, for the
  floor the desk stands on.
- A doorway, skirting and floor give the room scale and a vanishing line; the
  door is 0.9 × 2.05 m and offset left, clear of the piece's silhouette.
- `@react-three/postprocessing` adds ambient occlusion and a slight vignette;
  `SoftShadows` widens the shadow penumbra.

**Everything is metric.** A rolodex card is 5 inches — 0.127 m — wide, and the
model's card is `CARD_WIDTH` units, so:

```ts
const UNITS_PER_METRE = CARD_WIDTH / 0.127;
```

One unit is 2.51 cm, which puts the assembled piece at about 24 cm tall and the
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

const CARD_WIDTH = 5.05;
const CARD_HEIGHT = 3.18;
```

- Increase `WHEEL_RADIUS` for a larger circular mechanism.
- Increase `WHEEL_HALF_WIDTH` to expose more frame outside the cards.
- `WHEEL_Y` is the gimbal/pivot height on each upright card.
- Change the card dimensions if your images use a different aspect ratio.

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
