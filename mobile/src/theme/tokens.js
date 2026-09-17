/**
 * Design tokens.
 *
 * The product is a cold thing moving through a warm building, so the palette
 * carries the temperature: cold states read blue-green, warm states read amber
 * and red. Around that sits the room itself — a modern hospital floor, vinyl
 * and stainless steel, lit differently on a day shift than at 3am. Night ward
 * never goes pure black: a phone held over a sleeping patient should not throw
 * a white rectangle at the ceiling.
 */

const palette = {
  dark: {
    mode: 'dark',
    bg: '#071A21',
    bgDeep: '#041217',
    surface: '#0C2732',
    surfaceRaised: '#10333F',
    line: '#1B4756',
    lineSoft: '#143643',
    text: '#E6F5F8',
    textDim: '#8AAEBA',
    textFaint: '#5C8090',
    primary: '#19D3A2',
    primaryInk: '#02231B',
    cold: '#4FC9F0',
    coldDeep: '#1C7FA8',
    warn: '#F2B134',
    warnInk: '#2A1D00',
    danger: '#FF6058',
    dangerInk: '#2B0A08',
    ok: '#19D3A2',
    shadow: '#000000',
    overlay: 'rgba(3,12,16,0.72)',

    // The ward floor the app sits on: dark vinyl, wide tiles, a corridor light
    // pooling near the top of the screen.
    floor: '#04141A',
    floorTile: '#06202A',
    floorTileAlt: '#07242F',
    floorGrout: 'rgba(120, 200, 220, 0.07)',
    floorSheen: 'rgba(120, 220, 240, 0.05)',
    floorGlow: 'rgba(25, 211, 162, 0.10)',

    // Instrument surfaces used by the drawn medical hardware.
    steel: '#9FC3CF',
    steelDeep: '#5C8492',
    glass: 'rgba(200, 240, 250, 0.18)',
    glassEdge: 'rgba(200, 240, 250, 0.38)',
    label: '#EAF6F9',
  },
  light: {
    mode: 'light',
    bg: '#EFF5F7',
    bgDeep: '#E2ECEF',
    surface: '#FFFFFF',
    surfaceRaised: '#FFFFFF',
    line: '#D3E2E7',
    lineSoft: '#E6EFF2',
    text: '#062029',
    textDim: '#4E7683',
    textFaint: '#7599A4',
    primary: '#0B9C7A',
    primaryInk: '#FFFFFF',
    cold: '#1490C9',
    coldDeep: '#0C6B96',
    warn: '#A86B00',
    warnInk: '#FFFFFF',
    danger: '#C33A32',
    dangerInk: '#FFFFFF',
    ok: '#0B9C7A',
    shadow: '#1B3A44',
    overlay: 'rgba(11,36,44,0.45)',

    floor: '#E6EEF1',
    floorTile: '#F2F7F9',
    floorTileAlt: '#EAF1F4',
    floorGrout: 'rgba(12, 60, 76, 0.07)',
    floorSheen: 'rgba(255, 255, 255, 0.55)',
    floorGlow: 'rgba(11, 156, 122, 0.08)',

    steel: '#7E9CA8',
    steelDeep: '#4E7683',
    glass: 'rgba(20, 144, 201, 0.10)',
    glassEdge: 'rgba(20, 144, 201, 0.30)',
    label: '#0A2A34',
  },
};

const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 44 };

const radius = { sm: 8, md: 12, lg: 18, xl: 26, pill: 999 };

const type = {
  micro: { fontSize: 11, letterSpacing: 0.4 },
  label: { fontSize: 13 },
  body: { fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  subtitle: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  display: { fontSize: 30, lineHeight: 34, fontWeight: '800', letterSpacing: -0.5 },
  reading: { fontSize: 44, lineHeight: 46, fontWeight: '800', letterSpacing: -1.5 },
};

/** Status colours are derived so a new status cannot be added without a colour. */
function statusTone(colors, status) {
  switch (status) {
    case 'delivered':
      return { fg: colors.primary, bg: withAlpha(colors.primary, 0.14), label: 'Delivered' };
    case 'in-transit':
      return { fg: colors.cold, bg: withAlpha(colors.cold, 0.14), label: 'On the way' };
    case 'verified':
      return { fg: colors.cold, bg: withAlpha(colors.cold, 0.12), label: 'Verified' };
    case 'packed':
      return { fg: colors.cold, bg: withAlpha(colors.cold, 0.12), label: 'Packed' };
    case 'blocked':
      return { fg: colors.danger, bg: withAlpha(colors.danger, 0.15), label: 'Blocked' };
    case 'cancelled':
      return { fg: colors.textFaint, bg: withAlpha(colors.textFaint, 0.14), label: 'Cancelled' };
    case 'requested':
    default:
      return { fg: colors.warn, bg: withAlpha(colors.warn, 0.14), label: 'Awaiting check' };
  }
}

function verdictTone(colors, verdict) {
  if (verdict === 'pass') return { fg: colors.primary, bg: withAlpha(colors.primary, 0.14), label: 'Safe to dispense' };
  if (verdict === 'review') return { fg: colors.warn, bg: withAlpha(colors.warn, 0.16), label: 'Pharmacist review' };
  if (verdict === 'fail') return { fg: colors.danger, bg: withAlpha(colors.danger, 0.16), label: 'Do not dispense' };
  return { fg: colors.textDim, bg: withAlpha(colors.textDim, 0.12), label: 'Not checked yet' };
}

/** Each role gets one accent, used on the badge, the header and the tab bar. */
function roleTone(colors, role) {
  switch (role) {
    case 'pharmacist':
      return { color: colors.primary, label: 'Pharmacy' };
    case 'courier':
      return { color: colors.warn, label: 'Logistics' };
    case 'admin':
      return { color: colors.steel, label: 'Administration' };
    case 'nurse':
    default:
      return { color: colors.cold, label: 'Ward' };
  }
}

/** Maps a temperature onto the cold-to-hot ramp used by the vial and the trace. */
function temperatureColor(colors, celsius, min = 2, max = 8) {
  if (celsius === null || celsius === undefined) return colors.textFaint;
  if (celsius <= 0) return '#7FB5FF';
  if (celsius < min) return colors.cold;
  if (celsius <= max) return colors.primary;
  if (celsius <= max + 3) return colors.warn;
  return colors.danger;
}

function withAlpha(hex, alpha) {
  if (typeof hex !== 'string') return hex;
  if (hex.startsWith('rgba')) return hex;
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

module.exports = { palette, space, radius, type, statusTone, verdictTone, roleTone, temperatureColor, withAlpha };
