import { css, unsafeCSS } from "lit";
import { PHONE_LAYOUT_MEDIA_QUERY, SHORT_VIEWPORT_MEDIA_QUERY } from "../../breakpoints";

/**
 * The workspace band: the sidebar's first row, the conversation header and the
 * workbench tab strip are one band of one height (`--pi-panel-band-height`), so a
 * panel's content starts at the same y across the window. The desktop height is
 * declared once with the other tokens in `index.html`; this sheet is the single
 * owner of the phone override.
 *
 * It rides the layout's own lines, not the pointer: the app switches to the phone
 * layout at the mobile navigation line and at a coarse pointer up to the
 * side-by-side line, and it declares a short-viewport tier of its own. Sixty-four
 * pixels of chrome across a phone is a fifth of the view, and a band that stayed
 * at the desktop height there would leave the surface below it starting below the
 * fold. A surface that draws the band imports this sheet, so its height cannot
 * drift from its siblings'.
 */
export const workspaceBandStyles = css`
  @media ${unsafeCSS(PHONE_LAYOUT_MEDIA_QUERY)}, ${unsafeCSS(SHORT_VIEWPORT_MEDIA_QUERY)} {
    :host {
      --pi-panel-band-height: 52px;
      /* A phone has no width to spare for a wide bar inset: the band and the tab
         strip take the inset the phone's own bars use, and the sidebar's rows
         start at the phone's edge. */
      --pi-bar-inset-comfort: var(--pi-space-4);
      --pi-row-edge: var(--pi-space-5);
    }
  }
`;
