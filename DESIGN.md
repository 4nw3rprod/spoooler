# Design System

## Aesthetic Vision
"Operator UI" – dark mode default, monochromatic with subtle tints, high contrast for actionable elements, and zero decorative fluff. Think Linear or Vercel's dashboard.

## Color Strategy
- Restrained: Tinted neutrals with a single, highly saturated accent (Untitled UI's default primary).
- Surface backgrounds should be deep, near-black, using Untitled UI's dark mode variables.
- Borders and dividers should be barely visible (opacity 5-10%).

## Typography
- Inter (sans-serif) for all UI text.
- Heavy reliance on scale and weight for hierarchy. Muted text (`text-tertiary` or similar) for non-essential logs.
- Monospace (Geist Mono or similar) for raw JSON and console outputs.

## Layout
- Full-height dashboard layout. 
- Left sidebar or top bar for configuration and pipeline settings.
- Main area dedicated 50/50 to the Live Video Player (large, prominent) and the active stage execution (logs, inputs).
- Avoid unnecessary cards. Use seamless borders and subtle background fills to separate regions.

## Motion
- Snappy, instant transitions for tabs.
- Smooth exponential ease-out for progress bars.
- No bouncy animations.

## Components
- We are using **Untitled UI NextJS Starter Kit** (React Aria Components + Tailwind v4).
- Avoid `glassmorphism` and heavy shadows in dark mode.
- Use Untitled UI `ButtonGroup` or `Tabs` for pipeline stages.
