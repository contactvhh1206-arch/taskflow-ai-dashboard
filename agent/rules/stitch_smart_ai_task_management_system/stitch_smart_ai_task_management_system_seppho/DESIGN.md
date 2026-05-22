---
name: Cognitive Enterprise
colors:
  surface: '#fcf9f8'
  surface-dim: '#dcd9d9'
  surface-bright: '#fcf9f8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3f2'
  surface-container: '#f0edec'
  surface-container-high: '#eae7e7'
  surface-container-highest: '#e5e2e1'
  on-surface: '#1c1b1b'
  on-surface-variant: '#424656'
  inverse-surface: '#313030'
  inverse-on-surface: '#f3f0ef'
  outline: '#737687'
  outline-variant: '#c3c6d8'
  surface-tint: '#0052dd'
  primary: '#004ccd'
  on-primary: '#ffffff'
  primary-container: '#0f62fe'
  on-primary-container: '#f3f3ff'
  inverse-primary: '#b4c5ff'
  secondary: '#731be5'
  on-secondary: '#ffffff'
  secondary-container: '#8d42ff'
  on-secondary-container: '#fdf6ff'
  tertiary: '#9e3100'
  on-tertiary: '#ffffff'
  tertiary-container: '#c84000'
  on-tertiary-container: '#fff1ed'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174c'
  on-primary-fixed-variant: '#003da9'
  secondary-fixed: '#ebdcff'
  secondary-fixed-dim: '#d4bbff'
  on-secondary-fixed: '#270058'
  on-secondary-fixed-variant: '#5d00c2'
  tertiary-fixed: '#ffdbd0'
  tertiary-fixed-dim: '#ffb59d'
  on-tertiary-fixed: '#390c00'
  on-tertiary-fixed-variant: '#832700'
  background: '#fcf9f8'
  on-background: '#1c1b1b'
  surface-variant: '#e5e2e1'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
  code-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 8px
  container-max: 1440px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 32px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 24px
---

## Brand & Style
The design system is engineered for a high-performance Task Management System where human productivity meets AI intuition. The brand personality is **Precise, Calm, and Empowering**. It balances the structured reliability required for enterprise operations with a cutting-edge, "intelligent" layer represented through subtle glassmorphism and motion.

The design style is **Corporate / Modern** with a **Glassmorphic** twist for AI-driven features. This distinction allows users to instantly differentiate between manual tasks and AI-augmented insights. The interface prioritizes clarity and focus, reducing cognitive load in fast-paced environments like wellness centers or corporate offices.

Key visual principles:
- **Clarity over Decoration:** Whitespace is used to group related tasks.
- **Intelligence Layering:** AI features exist on a separate visual plane using translucent, blurred materials.
- **Operational Efficiency:** High-contrast elements ensure legibility in varied lighting conditions, from bright offices to dimmed spa environments.

## Colors
This design system utilizes a sophisticated palette of **Professional Blues** and **Slate Grays** to establish trust. 

- **Primary (IBM Blue):** Used for primary actions and active states.
- **Secondary (Deep Purple):** Used for high-level analytics and complex task grouping.
- **AI Accent (Electric Cyan):** A vibrant, glowing accent reserved exclusively for AI-generated suggestions, automated scheduling, and "smart" status indicators.
- **Neutrals:** A scale of cool grays (Slate) provides the structural foundation.

The system supports a dual-mode strategy. The **Light Mode** uses a soft `background_light` to reduce eye strain, while the **Dark Mode** employs high-contrast text and deep `background_dark` tones to ensure accessibility in low-light environments like spa treatment rooms.

## Typography
The typography system uses **Inter** as the workhorse for its exceptional legibility and neutral, professional character. To emphasize the technical and AI aspects of the product, **Geist** is introduced for labels and data-heavy components to provide a clean, modern, and slightly "developer-grade" precision.

- **Minimum Size:** No text should fall below 14px for body content to ensure accessibility.
- **Hierarchy:** Strong weight contrasts (Bold vs. Regular) help users scan task lists quickly.
- **Spacing:** Tight letter spacing on headlines for a compact, modern feel; increased tracking on labels for readability at small sizes.

## Layout & Spacing
The design system employs a **12-column Fluid Grid** with fixed maximum widths for dashboard views to prevent line-lengths from becoming unreadable on ultra-wide monitors.

- **The 8px Rule:** All spacing, padding, and margins scale in increments of 8px to ensure mathematical harmony.
- **Density:** The layout supports "Comfortable" (default) and "Compact" modes. In Compact mode, vertical spacing is reduced to 4px to allow for high-density data viewing.
- **Mobile Reflow:** On mobile, the 12-column grid collapses to a 1-column stack with 16px side margins. Sidebars transform into bottom sheets or full-screen overlays.

## Elevation & Depth
Depth is used to communicate the relationship between the user and the AI.

- **Manual Layer (Level 0-1):** Standard tasks and inputs live on the base surface or slightly elevated with a soft, 4px blur shadow (#000000 05%).
- **Interaction Layer (Level 2):** Hovered cards and active modals use a 12px blur shadow with a slightly higher opacity (#000000 10%).
- **Intelligence Layer (Glassmorphism):** AI sidebars, floating suggestion chips, and "Smart Insights" panels use a backdrop blur (12px to 20px) and a semi-transparent surface (e.g., `rgba(255, 255, 255, 0.7)` in light mode). This "frosted glass" effect visually separates AI-generated content from the static, user-generated data.
- **Borders:** All surfaces use a subtle 1px border (`#E0E0E0` in light, `#262626` in dark) to maintain definition regardless of shadow settings.

## Shapes
The shape language is approachable yet professional. A consistent **16px (1rem)** corner radius is applied to all primary containers (Cards, Modals, Large Buttons) to create a friendly, SaaS-native aesthetic.

- **Primary UI Elements:** 16px (`rounded-xl` context).
- **Secondary Elements (Inputs, Small Buttons):** 8px (`rounded-lg` context).
- **Status Pills:** Fully rounded (pill-shaped) to distinguish them from actionable buttons.

## Components

- **Buttons:** Primary buttons are solid `primary_color` with 8px radius. AI-powered buttons use a subtle gradient from `primary_color` to `secondary_color` and a glow effect on hover.
- **Cards:** Task cards use the 16px radius. AI-suggested tasks feature a "glass" border—a 1px semi-transparent stroke that catches the light.
- **Input Fields:** Large, 48px height fields with 8px radius. Focus states use a 2px `primary_color` ring.
- **Chips & Tags:** Small (24px height) with pill-shaped corners. AI-automated tags should include a small sparkle icon (✨) and use the `ai_accent` color.
- **AI Status Indicators:** Pulse animations are used to indicate "AI Thinking" states. These should be localized within the specific component using the cyan accent.
- **Lists:** High-contrast list items with clear dividers. On mobile, list items have a minimum touch target height of 56px.