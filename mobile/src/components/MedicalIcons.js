import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

/**
 * The instrument set.
 *
 * Everything the app draws — syringes, vials, thermometers, the cold box, the
 * ID badge — is composed from plain views. No icon font, no vector library, no
 * bitmap: the shapes take their colour from the palette, so an amber vial in
 * the night ward is the same amber as the excursion banner next to it, and
 * nothing to download means nothing to fail on a ward with poor reception.
 *
 * Each icon draws inside a square of `size` and scales from it, so they line up
 * on a shared baseline whatever size they are asked for.
 */

function Piece({ style }) {
  return <View pointerEvents="none" style={style} />;
}

/** A syringe, barrel to needle, lying at the angle it is held at. */
export function SyringeIcon({ size = 24, color, tint, angle = -40 }) {
  const { colors, alpha } = useTheme();
  const body = color || colors.steel;
  const fluid = tint || colors.primary;
  const u = size / 24;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: `${angle}deg` }] }}>
        {/* plunger rod and thumb rest */}
        <Piece style={{ position: 'absolute', top: 0.5 * u, width: 7 * u, height: 1.8 * u, borderRadius: u, backgroundColor: body }} />
        <Piece style={{ position: 'absolute', top: 2 * u, width: 1.8 * u, height: 5 * u, backgroundColor: body }} />
        {/* barrel */}
        <Piece
          style={{
            position: 'absolute',
            top: 6 * u,
            width: 7.5 * u,
            height: 11 * u,
            borderRadius: 1.6 * u,
            borderWidth: Math.max(1, 1.2 * u),
            borderColor: body,
            backgroundColor: alpha(fluid, 0.25),
            overflow: 'hidden',
            justifyContent: 'flex-end',
          }}
        >
          <Piece style={{ height: 6 * u, backgroundColor: alpha(fluid, 0.85) }} />
        </Piece>
        {/* finger flange */}
        <Piece style={{ position: 'absolute', top: 6 * u, width: 11 * u, height: 1.6 * u, borderRadius: u, backgroundColor: body }} />
        {/* hub and needle */}
        <Piece style={{ position: 'absolute', top: 17 * u, width: 3.4 * u, height: 1.8 * u, backgroundColor: body }} />
        <Piece style={{ position: 'absolute', top: 18.6 * u, width: 1.1 * u, height: 5 * u, backgroundColor: body }} />
      </View>
    </View>
  );
}

/** A capped vial with its fill level. */
export function VialIcon({ size = 24, color, tint, fill = 0.6 }) {
  const { colors, alpha } = useTheme();
  const body = color || colors.steel;
  const fluid = tint || colors.cold;
  const u = size / 24;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Piece style={{ position: 'absolute', top: 1.5 * u, width: 8 * u, height: 2.6 * u, borderRadius: 0.8 * u, backgroundColor: body }} />
      <Piece style={{ position: 'absolute', top: 4 * u, width: 5.5 * u, height: 1.6 * u, backgroundColor: alpha(body, 0.7) }} />
      <View
        style={{
          position: 'absolute',
          top: 5.4 * u,
          width: 11 * u,
          height: 16 * u,
          borderRadius: 2.2 * u,
          borderWidth: Math.max(1, 1.2 * u),
          borderColor: body,
          backgroundColor: alpha(fluid, 0.16),
          overflow: 'hidden',
          justifyContent: 'flex-end',
        }}
      >
        <Piece style={{ height: Math.max(2, 14 * u * fill), backgroundColor: alpha(fluid, 0.85) }} />
      </View>
    </View>
  );
}

/** A clinical thermometer with its column at the given fraction. */
export function ThermometerIcon({ size = 24, color, tint, level = 0.55 }) {
  const { colors, alpha } = useTheme();
  const body = color || colors.steel;
  const fluid = tint || colors.cold;
  const u = size / 24;
  const stemHeight = 13 * u;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute',
          top: 2 * u,
          width: 5.4 * u,
          height: stemHeight + 2 * u,
          borderTopLeftRadius: 3 * u,
          borderTopRightRadius: 3 * u,
          borderWidth: Math.max(1, 1.2 * u),
          borderBottomWidth: 0,
          borderColor: body,
          backgroundColor: alpha(fluid, 0.12),
          overflow: 'hidden',
          justifyContent: 'flex-end',
        }}
      >
        <Piece style={{ height: Math.max(2, stemHeight * level), backgroundColor: fluid }} />
      </View>
      <Piece
        style={{
          position: 'absolute',
          top: 15.5 * u,
          width: 8.4 * u,
          height: 8.4 * u,
          borderRadius: 4.2 * u,
          borderWidth: Math.max(1, 1.2 * u),
          borderColor: body,
          backgroundColor: fluid,
        }}
      />
      {/* graduations */}
      {[0, 1, 2].map((index) => (
        <Piece
          key={index}
          style={{
            position: 'absolute',
            left: size / 2 + 3.4 * u,
            top: (5 + index * 3) * u,
            width: 3 * u,
            height: Math.max(1, u),
            borderRadius: u,
            backgroundColor: alpha(body, 0.7),
          }}
        />
      ))}
    </View>
  );
}

/** The insulated transport box the vials travel in. */
export function ColdBoxIcon({ size = 24, color, tint }) {
  const { colors, alpha } = useTheme();
  const body = color || colors.steel;
  const fluid = tint || colors.cold;
  const u = size / 24;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Piece style={{ position: 'absolute', top: 3 * u, width: 19 * u, height: 4 * u, borderRadius: u, backgroundColor: body }} />
      <Piece style={{ position: 'absolute', top: 1 * u, width: 7 * u, height: 2.4 * u, borderRadius: u, borderWidth: Math.max(1, 1.2 * u), borderColor: body }} />
      <View
        style={{
          position: 'absolute',
          top: 7 * u,
          width: 16 * u,
          height: 13 * u,
          borderRadius: 1.8 * u,
          borderWidth: Math.max(1, 1.4 * u),
          borderColor: body,
          backgroundColor: alpha(fluid, 0.18),
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1.4 * u,
        }}
      >
        <Piece style={{ width: 8 * u, height: Math.max(1, 1.2 * u), borderRadius: u, backgroundColor: alpha(fluid, 0.9) }} />
        <Piece style={{ width: 5 * u, height: Math.max(1, 1.2 * u), borderRadius: u, backgroundColor: alpha(fluid, 0.6) }} />
      </View>
    </View>
  );
}

/** A trace, drawn as rotated segments: flat, a spike, flat again. */
export function PulseIcon({ size = 24, color }) {
  const { colors } = useTheme();
  const stroke = color || colors.cold;
  const u = size / 24;
  const thickness = Math.max(1.6, 1.8 * u);
  const segments = [
    { left: 0, top: 12, width: 6, rotate: 0 },
    { left: 5, top: 9, width: 5, rotate: -52 },
    { left: 8.5, top: 9, width: 7, rotate: 58 },
    { left: 13, top: 12.5, width: 5, rotate: -30 },
    { left: 17, top: 12, width: 7, rotate: 0 },
  ];

  return (
    <View style={{ width: size, height: size }}>
      {segments.map((segment, index) => (
        <Piece
          key={index}
          style={{
            position: 'absolute',
            left: segment.left * u,
            top: segment.top * u,
            width: segment.width * u,
            height: thickness,
            borderRadius: thickness,
            backgroundColor: stroke,
            transform: [{ rotate: `${segment.rotate}deg` }],
          }}
        />
      ))}
    </View>
  );
}

/** A clipboard: the ward's indent list. */
export function ClipboardIcon({ size = 24, color, tint }) {
  const { colors, alpha } = useTheme();
  const body = color || colors.steel;
  const accent = tint || colors.primary;
  const u = size / 24;

  return (
    <View style={{ width: size, height: size, alignItems: 'center' }}>
      <View
        style={{
          position: 'absolute',
          top: 3 * u,
          width: 17 * u,
          height: 19 * u,
          borderRadius: 2.4 * u,
          borderWidth: Math.max(1, 1.4 * u),
          borderColor: body,
          backgroundColor: alpha(body, 0.08),
          paddingTop: 6 * u,
          paddingHorizontal: 3 * u,
          gap: 2.2 * u,
        }}
      >
        <Piece style={{ width: '82%', height: Math.max(1, 1.4 * u), borderRadius: u, backgroundColor: alpha(accent, 0.9) }} />
        <Piece style={{ width: '62%', height: Math.max(1, 1.4 * u), borderRadius: u, backgroundColor: alpha(body, 0.75) }} />
        <Piece style={{ width: '72%', height: Math.max(1, 1.4 * u), borderRadius: u, backgroundColor: alpha(body, 0.55) }} />
      </View>
      <Piece
        style={{
          position: 'absolute',
          top: 1 * u,
          width: 9 * u,
          height: 4.4 * u,
          borderRadius: 1.2 * u,
          backgroundColor: body,
        }}
      />
    </View>
  );
}

/** A shield with a cross: the audit trail and anything about protection. */
export function ShieldIcon({ size = 24, color, tint }) {
  const { colors, alpha } = useTheme();
  const body = color || colors.steel;
  const accent = tint || colors.primary;
  const u = size / 24;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute',
          top: 2 * u,
          width: 17 * u,
          height: 19 * u,
          borderTopLeftRadius: 3 * u,
          borderTopRightRadius: 3 * u,
          borderBottomLeftRadius: 8.5 * u,
          borderBottomRightRadius: 8.5 * u,
          borderWidth: Math.max(1, 1.4 * u),
          borderColor: body,
          backgroundColor: alpha(accent, 0.12),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Piece style={{ position: 'absolute', width: 8 * u, height: Math.max(1.6, 2 * u), borderRadius: u, backgroundColor: accent }} />
        <Piece style={{ position: 'absolute', width: Math.max(1.6, 2 * u), height: 8 * u, borderRadius: u, backgroundColor: accent }} />
      </View>
    </View>
  );
}

/** The staff ID badge on its lanyard clip. */
export function BadgeIcon({ size = 24, color, tint }) {
  const { colors, alpha } = useTheme();
  const body = color || colors.steel;
  const accent = tint || colors.cold;
  const u = size / 24;

  return (
    <View style={{ width: size, height: size, alignItems: 'center' }}>
      <Piece style={{ position: 'absolute', top: 0.5 * u, width: 6 * u, height: 3 * u, borderRadius: u, borderWidth: Math.max(1, 1.2 * u), borderColor: body }} />
      <View
        style={{
          position: 'absolute',
          top: 4.5 * u,
          width: 18 * u,
          height: 15 * u,
          borderRadius: 2.4 * u,
          borderWidth: Math.max(1, 1.4 * u),
          borderColor: body,
          backgroundColor: alpha(accent, 0.1),
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 2.4 * u,
          gap: 2 * u,
        }}
      >
        <Piece style={{ width: 5 * u, height: 5 * u, borderRadius: 2.5 * u, backgroundColor: alpha(accent, 0.85) }} />
        <View style={{ flex: 1, gap: 1.6 * u }}>
          <Piece style={{ width: '100%', height: Math.max(1, 1.3 * u), borderRadius: u, backgroundColor: alpha(body, 0.8) }} />
          <Piece style={{ width: '70%', height: Math.max(1, 1.3 * u), borderRadius: u, backgroundColor: alpha(body, 0.5) }} />
        </View>
      </View>
    </View>
  );
}

/** A bell, for ward alerts. */
export function BellIcon({ size = 24, color, tint }) {
  const { colors, alpha } = useTheme();
  const body = color || colors.steel;
  const accent = tint || colors.warn;
  const u = size / 24;

  return (
    <View style={{ width: size, height: size, alignItems: 'center' }}>
      <Piece style={{ position: 'absolute', top: 1 * u, width: 3 * u, height: 3 * u, borderRadius: 1.5 * u, backgroundColor: body }} />
      <View
        style={{
          position: 'absolute',
          top: 3.5 * u,
          width: 15 * u,
          height: 13 * u,
          borderTopLeftRadius: 7.5 * u,
          borderTopRightRadius: 7.5 * u,
          borderBottomLeftRadius: 1.5 * u,
          borderBottomRightRadius: 1.5 * u,
          borderWidth: Math.max(1, 1.4 * u),
          borderColor: body,
          backgroundColor: alpha(accent, 0.16),
        }}
      />
      <Piece style={{ position: 'absolute', top: 16.5 * u, width: 19 * u, height: Math.max(1.4, 1.8 * u), borderRadius: u, backgroundColor: body }} />
      <Piece style={{ position: 'absolute', top: 18.8 * u, width: 4 * u, height: 3.2 * u, borderBottomLeftRadius: 2 * u, borderBottomRightRadius: 2 * u, backgroundColor: body }} />
    </View>
  );
}

/** A courier trolley, for anything in transit. */
export function TrolleyIcon({ size = 24, color, tint }) {
  const { colors, alpha } = useTheme();
  const body = color || colors.steel;
  const accent = tint || colors.cold;
  const u = size / 24;

  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          position: 'absolute',
          left: 2 * u,
          top: 5 * u,
          width: 13 * u,
          height: 10 * u,
          borderRadius: 1.8 * u,
          borderWidth: Math.max(1, 1.4 * u),
          borderColor: body,
          backgroundColor: alpha(accent, 0.16),
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: 14 * u,
          top: 8.5 * u,
          width: 8 * u,
          height: 6.5 * u,
          borderTopRightRadius: 2.4 * u,
          borderBottomRightRadius: 1.4 * u,
          borderWidth: Math.max(1, 1.4 * u),
          borderColor: body,
        }}
      />
      <Piece style={{ position: 'absolute', left: 4.5 * u, top: 16 * u, width: 5 * u, height: 5 * u, borderRadius: 2.5 * u, borderWidth: Math.max(1, 1.4 * u), borderColor: body }} />
      <Piece style={{ position: 'absolute', left: 14.5 * u, top: 16 * u, width: 5 * u, height: 5 * u, borderRadius: 2.5 * u, borderWidth: Math.max(1, 1.4 * u), borderColor: body }} />
    </View>
  );
}

/** A dial, for settings. */
export function DialIcon({ size = 24, color, tint }) {
  const { colors, alpha } = useTheme();
  const body = color || colors.steel;
  const accent = tint || colors.primary;
  const u = size / 24;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {[0, 45, 90, 135].map((angle) => (
        <Piece
          key={angle}
          style={{
            position: 'absolute',
            width: 21 * u,
            height: Math.max(2, 3 * u),
            borderRadius: 1.5 * u,
            backgroundColor: alpha(body, 0.85),
            transform: [{ rotate: `${angle}deg` }],
          }}
        />
      ))}
      <Piece
        style={{
          position: 'absolute',
          width: 14 * u,
          height: 14 * u,
          borderRadius: 7 * u,
          backgroundColor: body,
        }}
      />
      <Piece
        style={{
          position: 'absolute',
          width: 7 * u,
          height: 7 * u,
          borderRadius: 3.5 * u,
          backgroundColor: accent,
        }}
      />
    </View>
  );
}

/** A gloved hand — the signature of the whole product. */
export function GloveIcon({ size = 24, color, tint }) {
  const { colors, alpha } = useTheme();
  const body = color || colors.steel;
  const skin = tint || colors.primary;
  const u = size / 24;
  const fingers = [
    { left: 4.5, top: 5.5, height: 9 },
    { left: 8.4, top: 3.2, height: 11.3 },
    { left: 12.3, top: 4.2, height: 10.3 },
    { left: 16.2, top: 6.4, height: 8.1 },
  ];

  return (
    <View style={{ width: size, height: size }}>
      {fingers.map((finger, index) => (
        <Piece
          key={index}
          style={{
            position: 'absolute',
            left: finger.left * u,
            top: finger.top * u,
            width: 3.4 * u,
            height: finger.height * u,
            borderRadius: 1.7 * u,
            backgroundColor: alpha(skin, 0.28),
            borderWidth: Math.max(1, 1.1 * u),
            borderColor: body,
          }}
        />
      ))}
      {/* thumb */}
      <Piece
        style={{
          position: 'absolute',
          left: 0.6 * u,
          top: 10 * u,
          width: 3.2 * u,
          height: 7 * u,
          borderRadius: 1.6 * u,
          backgroundColor: alpha(skin, 0.28),
          borderWidth: Math.max(1, 1.1 * u),
          borderColor: body,
          transform: [{ rotate: '18deg' }],
        }}
      />
      {/* palm */}
      <Piece
        style={{
          position: 'absolute',
          left: 3.4 * u,
          top: 11 * u,
          width: 17 * u,
          height: 9 * u,
          borderRadius: 3 * u,
          backgroundColor: alpha(skin, 0.32),
          borderWidth: Math.max(1, 1.2 * u),
          borderColor: body,
        }}
      />
      {/* cuff */}
      <Piece
        style={{
          position: 'absolute',
          left: 4.4 * u,
          top: 19 * u,
          width: 15 * u,
          height: 4 * u,
          borderRadius: 1.4 * u,
          backgroundColor: skin,
        }}
      />
    </View>
  );
}

const ICONS = {
  syringe: SyringeIcon,
  vial: VialIcon,
  thermometer: ThermometerIcon,
  coldbox: ColdBoxIcon,
  pulse: PulseIcon,
  clipboard: ClipboardIcon,
  shield: ShieldIcon,
  badge: BadgeIcon,
  bell: BellIcon,
  trolley: TrolleyIcon,
  dial: DialIcon,
  glove: GloveIcon,
};

export function MedIcon({ name, ...rest }) {
  const Component = ICONS[name] || VialIcon;
  return <Component {...rest} />;
}

export const ICON_NAMES = Object.keys(ICONS);
