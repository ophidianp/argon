# Design

A native-feeling macOS tool. The agents' work is the content; the chrome recedes. All values live as tokens at the top of `src/styles.css`, defined for dark and for `:root[data-theme='light']`. The theme follows the Mac unless Settings says otherwise (`src/theme.ts`).

## Look

Warm black and ivory, not grey: the interface floats over the board in pills and capsules of glass, with soft continuous corners. The material is Apple's (blur, a thin light rim, a highlight on the top edge); the character is its own (coral, coloured chips, agents tinting their console's frame). The day theme is the same design on warm paper.

## Colour

- Neutrals carry the interface: `--bg`, `--panel`, `--panel-2`, `--panel-3`, `--line`, `--line-2`, `--text`, `--text-2`, `--muted`, `--faint`.
- `--ink` is the theme's foreground as RGB channels, for translucent hover and fill states: `rgb(var(--ink) / 0.08)`. Never write a translucent white.
- Coral (`--accent`) goes on the primary action, the active tool (filled), the active tab, what is selected and an agent that is working.
- The bottom chips each have a two-colour ring (`--a`, `--b`): the one decorative colour in the interface.
- `--needs`, `--done`, `--danger`, `--warn`, `--ok`, `--info`, `--purple` mean status and link kinds only.
- Colours a person picks (shapes, sticky notes, groups) are their content and stay as picked. The saved default ink `#ece8e2` means "the theme's text colour": pass stored colours through `themed()`.
- The document sheet (`.paper`) is white paper in both themes.

## Surfaces

- `--glass` with `backdrop-filter: var(--blur)` and `box-shadow: var(--rim), …`: pills, capsules and bars that float over the board. No solid borders on glass: the rim draws the edge.
- `--popover` with the same blur and rim: menus, sheets, tooltips.
- `--panel`: cards on the board. Nodes are never translucent, so what sits under them cannot bleed through their text.
- `--shadow` only for what floats above other interface, `--shadow-sm` for rails and nodes.

## Type

- The system font (`--font`, San Francisco on a Mac). The base size is 13px; the scale is 11 to 13 for controls and text, 15 for sheet titles, 20 and 32 for the two empty and home headlines. Sentence case always.
- `--mono` (JetBrains Mono) is for terminals, code, diffs, paths and commit hashes. Numbers elsewhere use `font-variant-numeric: tabular-nums`.

## Shape and controls

- Radii: 9 to 12 for controls and pills that hold several, 16 for cards and menus, 20 for sheets and the command bar. Full round for chips, tools, round buttons and ring petals.
- Control height 28 to 36. Lucide icons at stroke 1.6.
- Selected in a segmented control is a neutral raised segment (`--seg-on`), not coral.
- Every control with no visible word has a `title`, which `Tips` shows as a tooltip. Say what pressing it does, not what it is called.
- Console actions appear on hover or keyboard focus. Status is always visible, as a dot and a plain word.
- A small menu that belongs to a node (size, context) opens as a `Popover` on the page, never inside the node: it is not clipped and keeps its size at any zoom. Esc or a click away closes it.
- A write box is never disabled. What cannot be delivered yet waits, says so, and can be taken back.

## Motion

It should feel like one continuous material answering the hand. Everything uses `--spring` and only transform and opacity for movement: presses shrink a touch, menus and sheets rise into place in 0.2 to 0.3s, new consoles settle in. Reduced motion is respected.

The moment that earns attention is dropping a terminal on another: the target tints and says what will happen, then both glide into a frame that settles around them. Exact sizes glide the same way, and a terminal refits only when the size has settled, so the CLI does not repaint on every frame. Day and night cross-fade with a view transition.

An element that animates its opacity must not hold the end state (`both`) if something inside it uses `backdrop-filter`: while held, the inner glass has nothing behind it to blur.
