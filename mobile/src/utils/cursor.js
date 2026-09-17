import { Platform } from 'react-native';

/**
 * The glove.
 *
 * On a ward workstation the app is driven with a mouse, and the pointer is the
 * one piece of the interface that is in the operator's hand the whole time. It
 * is a nitrile examination glove here: open while moving, index finger out over
 * anything that can be pressed, and an ordinary caret inside text fields, where
 * a glove would only be in the way.
 *
 * Touch devices never see this: there is no pointer to dress.
 */

const OPEN_GLOVE = `
<svg xmlns='http://www.w3.org/2000/svg' width='30' height='32' viewBox='0 0 24 26'>
  <g transform='rotate(-10 12 13)'>
    <g fill='#EAFBF6' stroke='#08313C' stroke-width='1.25' stroke-linejoin='round'>
      <rect x='4' y='6.2' width='3.4' height='9' rx='1.7'/>
      <rect x='7.6' y='3.4' width='3.4' height='11.8' rx='1.7'/>
      <rect x='11.2' y='4.4' width='3.4' height='10.8' rx='1.7'/>
      <rect x='14.8' y='6.6' width='3.4' height='8.6' rx='1.7'/>
      <rect x='0.9' y='10' width='3.2' height='7' rx='1.6' transform='rotate(18 2.5 13.5)'/>
      <rect x='3.3' y='11' width='15.8' height='9.2' rx='3'/>
    </g>
    <rect x='4.3' y='18.9' width='13.8' height='4.1' rx='1.5' fill='#19D3A2' stroke='#08313C' stroke-width='1.1'/>
  </g>
</svg>`;

const POINTING_GLOVE = `
<svg xmlns='http://www.w3.org/2000/svg' width='30' height='32' viewBox='0 0 24 26'>
  <g fill='#EAFBF6' stroke='#08313C' stroke-width='1.25' stroke-linejoin='round'>
    <rect x='7.9' y='1.5' width='3.7' height='13.2' rx='1.85'/>
    <rect x='3.4' y='9.8' width='15.8' height='10.2' rx='3.4'/>
    <rect x='0.8' y='11' width='3.2' height='6.8' rx='1.6' transform='rotate(20 2.4 14)'/>
  </g>
  <rect x='4.4' y='18.7' width='13.8' height='4.2' rx='1.5' fill='#4FC9F0' stroke='#08313C' stroke-width='1.1'/>
</svg>`;

function asUrl(svg) {
  return `url("data:image/svg+xml,${encodeURIComponent(svg.trim().replace(/\s+/g, ' '))}")`;
}

let installed = false;

export function installGloveCursor() {
  if (Platform.OS !== 'web' || installed) return;
  if (typeof document === 'undefined') return;
  installed = true;

  const style = document.createElement('style');
  style.setAttribute('data-coldchain', 'cursor');
  style.textContent = `
    * { cursor: ${asUrl(OPEN_GLOVE)} 12 4, auto !important; }
    a,
    button,
    [role="button"],
    [role="tab"],
    [role="link"],
    [role="switch"],
    [role="menuitem"] { cursor: ${asUrl(POINTING_GLOVE)} 12 2, pointer !important; }
    input,
    textarea,
    select,
    [contenteditable="true"] { cursor: text !important; }
    input[type="button"],
    input[type="submit"] { cursor: ${asUrl(POINTING_GLOVE)} 12 2, pointer !important; }
    [aria-disabled="true"] { cursor: ${asUrl(OPEN_GLOVE)} 12 4, not-allowed !important; }
    ::selection { background: rgba(25, 211, 162, 0.28); }
  `;
  document.head.appendChild(style);
}
