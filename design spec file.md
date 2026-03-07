# Bot Auto IG: Design Specification

This document outlines the UI design system and aesthetic guidelines established in the application, primarily modeled after the dark, glassmorphic "Kyntra" style implemented in the Scraping tab.

## 1. Core Philosophy
The application features a modern, premium, dark SaaS aesthetic. It relies on:
- **Deep dark backgrounds** to emphasize content.
- **Glassmorphism** (translucent backgrounds with blur effects) for depth.
- **Vibrant gradient accents** (primarily red/orange) to highlight key actions and titles.
- **Subtle borders** (`white/5` or `white/10`) to separate components without harsh lines.

## 2. Color Palette

### Backgrounds
- **App/Page Background**: `#050505` (Deepest dark grey/black)
- **Dialog/Modal Background**: `#0a0a0a` (`bg-[#0a0a0a]`)
- **Card/Container Backgrounds**:
  - Base level: `bg-white/[0.02]`
  - Slightly elevated: `bg-white/[0.03]`
  - Inputs / Textareas: `bg-black/50`
  - Highlighting / Hover: `hover:bg-white/[0.02]` or `hover:bg-white/5`

### Typography Colors
- **Primary Text**: `text-gray-200` (Main body text)
- **Secondary / Muted Text**: `text-gray-400` or `text-gray-500` (Subtitles, field descriptions)
- **High-Impact Titles (Gradient)**: 
  - `bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent`

### Accents & Gradients
- **Primary Brand Gradient (Buttons)**: 
  - `bg-gradient-to-r from-red-600 to-orange-500 text-white`
- **Primary Hover/Glow Effect**: 
  - Base: `shadow-[0_0_15px_rgba(239,68,68,0.4)]`
  - Hover: `shadow-[0_0_25px_rgba(239,68,68,0.6)]`

### Semantic Colors (Status Badges, Alerts)
- **Success / Running**: 
  - Background: `bg-green-500/10`
  - Text: `text-green-400`
  - Border: `border-green-500/20`
  - Glow (optional): `shadow-[0_0_10px_rgba(34,197,94,0.2)]`
- **Warning / Paused**: 
  - Background: `bg-orange-500/10`
  - Text: `text-orange-400`
  - Border: `border-orange-500/20`
- **Error / Failed / Destructive**: 
  - Background: `bg-red-500/10`
  - Text: `text-red-400` (or `text-red-500`)
  - Border: `border-red-500/20`
  - Glow (optional): `shadow-[0_0_10px_rgba(239,68,68,0.2)]`
- **Info / Regular File**: 
  - Background: `bg-blue-500/10`
  - Text: `text-blue-400`
  - Border: `border-blue-500/20`
- **Neutral / Idle / Done**: 
  - Background: `bg-white/5` (Done) or `bg-transparent` (Idle)
  - Text: `text-gray-300` (Done) or `text-gray-500` (Idle)
  - Border: `border-white/10` or `border-white/5`

## 3. UI Components

### Page Layout
Top-level page containers should be full-height flex columns with relative positioning to contain ambient background glows if applicable.
- **Ambient Glows**: Use absolute positioned div blocks like:
  ```html
  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-red-600/10 blur-[120px] rounded-full pointer-events-none" />
  ```

### Header Section
- Main headers inside pages should feature the `from-white to-gray-400` text gradient.
- The wrapper usually sits on an elevated glassmorphic layer (`bg-white/[0.02] border-b border-white/5`).

### Buttons
**Primary Action Button**:
- No borders.
- Red/orange gradient.
- Heavy localized colored drop shadows for a glowing aesthetic (`shadow-[0_0_15px_rgba(239,68,68,0.4)] hover:shadow-[0_0_25px_rgba(239,68,68,0.6)]`).

**Secondary / Cancel Button**:
- Transparent background (`bg-transparent` or `bg-white/5`).
- Translucent border (`border-white/10`).
- Text color light grey (`text-gray-300`).
- Hover: `hover:bg-white/10 hover:text-white transition-all`.

### Tables & Data Grids
- **Container**: Borderless or very subtle border (`border-white/[0.05]`), sitting within a `bg-white/[0.02] rounded-2xl backdrop-blur-sm` wrapper.
- **Header Row**: `border-b border-white/[0.05] hover:bg-transparent`.
- **Table Rows**: Separation via `border-b border-white/[0.05]`.
- **Hover effects**: Rows use a subtle translucent white hover `hover:bg-white/[0.02]`. Selection state uses `bg-white/[0.04]`.
- **Typographical hierarchy**: Table headers in `text-gray-400 font-medium`, major identifiers in `text-gray-200`, sub-information in `text-gray-500 text-xs`.

### Forms, Inputs & Textareas
- **Labels**: Usually `text-gray-400`.
- **Input Fields**: 
  - Background: `bg-black/50`
  - Border: `border-white/10`
  - Text: `text-white`
  - Focus Ring: `focus-visible:ring-red-500/50 focus-visible:border-red-500`

### Modals & Dialogs
- **Overlay/Backdrop**: Standard blur/darkening overlay.
- **Container**: 
  - Background: `bg-[#0a0a0a]`
  - Borders: `border-white/10`
  - Text: `text-gray-200`
- Dialog headers mirror the application headers, using the gradient text effect.

## 4. Interaction & Animation
- Incorporate subtle transition effects (`transition-all` or `transition-colors`) for states (hover, focus, active).
- Buttons should feel responsive and slightly elevate their glow radius when hovered.
- Utilize drop-down menus with dark backgrounds (`bg-[#0f0f0f]`) and translucent hover highlights (`hover:bg-white/10`) to keep contextual actions cohesive.
