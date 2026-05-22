---
name: Modern Fiscal System
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#45464d'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#006a61'
  on-secondary: '#ffffff'
  secondary-container: '#86f2e4'
  on-secondary-container: '#006f66'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#271901'
  on-tertiary-container: '#98805d'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#89f5e7'
  secondary-fixed-dim: '#6bd8cb'
  on-secondary-fixed: '#00201d'
  on-secondary-fixed-variant: '#005049'
  tertiary-fixed: '#fcdeb5'
  tertiary-fixed-dim: '#dec29a'
  on-tertiary-fixed: '#271901'
  on-tertiary-fixed-variant: '#574425'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display-lg:
    fontFamily: Hanken Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
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
  data-tabular:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  container-padding: 24px
  stack-gap: 16px
  grid-gutter: 20px
  section-margin: 32px
---

## Brand & Style

The design system is engineered for precision, clarity, and institutional trust. It caters to finance professionals and business owners who require a high-density information environment that remains breathable and easy to navigate. 

The aesthetic is **Corporate / Modern**, leaning heavily into **Minimalism**. It prioritizes functional utility over decorative flair. The visual language uses generous whitespace to separate complex data sets, crisp edges for a sense of order, and a systematic approach to hierarchy that ensures the most critical financial KPIs are immediately identifiable. The emotional response should be one of "controlled efficiency"—the user should feel that their data is organized, secure, and accurate.

## Colors

The palette is anchored by a deep "Ink Blue" primary color, providing a foundational sense of stability and authority. A "Precision Teal" serves as the secondary accent, used for interactive elements and highlights without being distracting.

- **Primary & Neutral:** We utilize a refined scale of Slate grays for text and UI borders to maintain high legibility while avoiding the harshness of pure black.
- **Semantic Data:** Revenue and positive trends are represented by a vibrant Emerald green, while expenses and alerts use a high-visibility Crimson. These are used sparingly to ensure "red-flag" items are never missed.
- **Surface Strategy:** The UI uses a "Subtle Background" (`#F8FAFC`) to differentiate the application canvas from white content cards, creating a natural layered effect without heavy shadows.

## Typography

Typography is the backbone of this design system, optimized for reading long-form ledgers and complex balance sheets.

- **Headlines:** **Hanken Grotesk** provides a contemporary, sharp look for page titles and high-level metrics. Its precise geometry conveys technical sophistication.
- **Body & Data:** **Inter** is used for all functional UI and data entries. For numerical values, the `data-tabular` token must be used, which enables "Tabular Numbers" (tnum) and "Lining Figures" (lnum) to ensure that columns of numbers align perfectly for easy scanning and comparison.
- **Scale:** Font sizes are kept conservative to support high data density, rarely exceeding 16px for standard interface elements.

## Layout & Spacing

The layout utilizes a **Fixed Grid** approach for internal dashboard views to ensure that financial reports maintain a consistent structure across different machines. 

- **Grid Model:** A 12-column grid with a 1200px max-width for content. On smaller screens, the grid remains fluid until 768px, where it transitions to a single-column stack.
- **Spacing Rhythm:** Based on a 4px baseline unit. 
    - **Dense Views:** Ledgers use 8px (2 units) of vertical padding per row.
    - **Standard Views:** Form fields and general UI use 12px-16px (3-4 units) of spacing.
- **Data Separation:** Rather than using heavy boxes, we use vertical alignment and generous horizontal margins to distinguish between data columns.

## Elevation & Depth

To maintain a "clean and functional" feel, this design system avoids heavy shadows and skeuomorphism. Depth is communicated through **Tonal Layers** and **Low-Contrast Outlines**.

- **Level 0 (Canvas):** The base background uses a subtle off-white/gray tint.
- **Level 1 (Cards):** White surfaces with a 1px border (`#E2E8F0`). No shadow is used here to keep the UI "flat" and printable.
- **Level 2 (Popovers/Modals):** Elements that float above the UI use a very soft, diffused shadow (10% opacity) and a crisp 1px border to ensure separation from the background cards.
- **Active State:** Selection is indicated by a 2px "Precision Teal" left-border or a subtle background tint (`#F1F5F9`), never by an increase in elevation or shadow.

## Shapes

The design system uses a **Soft** shape language. This provides a modern touch while maintaining the serious, structured nature of a financial tool.

- **Components:** Buttons, input fields, and metric cards use a `0.25rem` (4px) corner radius.
- **Containers:** Larger dashboard sections or modals use `0.5rem` (8px).
- **Interactive States:** Focus rings are square-edged or have a minimal 2px radius to reinforce the feeling of technical precision.

## Components

### Data Tables
Tables are the primary component. They must feature sticky headers and a "Zebra" stripe pattern (every second row) using a 2% tint of the primary color. Cells containing currency must be right-aligned to the decimal point.

### Metric Cards
Metric cards should display a clear label (`label-caps`), a large value (`headline-md`), and a small "Trend Indicator" chip. The trend indicator uses semantic green/red for its background with a 10% opacity tint and matching colored text.

### Buttons & Inputs
- **Primary Action:** Solid primary color with white text.
- **Secondary Action:** Ghost style (transparent background) with a 1px slate border.
- **Inputs:** Use a 1px border with a "focus" state that changes the border color to the secondary teal. Error states must include both a red border and a helper icon for accessibility.

### Simple Charts
Charts should use a simplified color palette based on the primary and secondary colors. Bar charts for comparison should use the Neutral Slate, while performance charts (Profit/Loss) must use the Semantic Green/Red logic. Lines should be thin (2px) with small circular data points.