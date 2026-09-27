# Front-facing Rolodex portfolio

A dependency-free React/Next.js component for a one-screen portfolio.

## Interaction

- Vertical mouse wheel / trackpad movement rotates the Rolodex.
- Vertical touch swipes do the same on phones/tablets.
- Cards orbit vertically around an implied horizontal drum.
- **Cards never rotate with the drum**: every card plane stays parallel to the screen.
- Clicking a neighbouring card brings it to the centre.
- Clicking the centred card opens project details.
- Desktop: project details live in a fixed second column.
- Mobile: project details open in a bottom drawer.

## Install

Copy:

- `FrontFacingRolodex.tsx`
- `FrontFacingRolodex.module.css`

into your component folder.

Then import it as shown in `example-page.tsx`.

## Replace projects

Edit the `projects` array:

```ts
{
  id: "my-project",
  title: "My Project",
  image: "/projects/my-project.jpg",
  href: "/projects/my-project",
  eyebrow: "Web Design",
  description: "Short project description.",
  tags: ["React", "Branding"],
}
```

Put your images in `public/projects/` (or use any normal image URL).

## Tuning

In `FrontFacingRolodex.tsx`:

- `y = Math.sin(angle) * 46` controls the vertical orbit radius.
- `depth = (Math.cos(angle) - 1) * 290` controls how far rear cards recede.
- `pixelsPerCard` controls swipe sensitivity.
- Wheel sensitivity is the multiplier in `delta * 0.0026`.

In the CSS:

- `.card { width: ... }` controls project-card size.
- `.shell` controls the desktop left/right column ratio.
- `@media (max-width: 860px)` switches to the mobile drawer.
