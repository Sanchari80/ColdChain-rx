import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { tapFeedback } from '../utils/feedback';

/** Text that already knows about the palette and the type scale. */
export function T({ variant = 'body', tone = 'text', style, children, ...rest }) {
  const { colors, type } = useTheme();
  const toneColor = {
    text: colors.text,
    dim: colors.textDim,
    faint: colors.textFaint,
    primary: colors.primary,
    cold: colors.cold,
    warn: colors.warn,
    danger: colors.danger,
    steel: colors.steel,
  }[tone] || tone;

  return (
    <Text style={[type[variant] || type.body, { color: toneColor }, style]} {...rest}>
      {children}
    </Text>
  );
}

/**
 * A panel.
 *
 * Everything the app says sits on one of these: a clean instrument face lifted
 * off the ward floor behind it. `accent` runs a coloured rail down the leading
 * edge, which is how a panel says what it is about without spending a word.
 */
export function Card({ style, children, tone, accent, padded = true, ...rest }) {
  const { colors, radius, space, alpha, mode } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: mode === 'dark' ? alpha(colors.surface, 0.94) : colors.surface,
          borderRadius: radius.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: tone ? alpha(tone, 0.45) : colors.line,
          padding: padded ? space.lg : 0,
          overflow: 'hidden',
          shadowColor: colors.shadow,
          shadowOpacity: mode === 'dark' ? 0.38 : 0.1,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
          elevation: 2,
        },
        accent ? { borderLeftWidth: 3, borderLeftColor: accent } : null,
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

/** A panel heading with an optional instrument drawn beside it. */
export function PanelHeader({ title, subtitle, icon, right }) {
  const { space } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      {icon}
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="subtitle">{title}</T>
        {subtitle ? <T variant="label" tone="dim">{subtitle}</T> : null}
      </View>
      {right}
    </View>
  );
}

/**
 * The press animation every tappable surface shares: the surface sinks a little
 * on touch and springs back on release, with a click and a haptic tick when the
 * press lands.
 */
function usePressMotion(depth = 0.96) {
  const { reduceMotion } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const shade = useRef(new Animated.Value(0)).current;

  const animate = (pressed) => {
    if (reduceMotion) return;
    Animated.parallel([
      Animated.spring(scale, { toValue: pressed ? depth : 1, useNativeDriver: true, speed: 50, bounciness: pressed ? 0 : 8 }),
      Animated.timing(shade, { toValue: pressed ? 1 : 0, duration: pressed ? 80 : 180, useNativeDriver: true }),
    ]).start();
  };

  return { scale, shade, pressIn: () => animate(true), pressOut: () => animate(false) };
}

/** A pressable surface with the shared press motion, click and haptic. */
export function Touchable({ onPress, disabled, containerStyle, style, children, depth = 0.98, sound = true, ...rest }) {
  const { scale, pressIn, pressOut } = usePressMotion(depth);
  return (
    <Animated.View style={[{ transform: [{ scale }] }, containerStyle]}>
      <Pressable
        disabled={disabled}
        onPressIn={pressIn}
        onPressOut={pressOut}
        onPress={(event) => {
          if (sound) tapFeedback();
          onPress && onPress(event);
        }}
        style={style}
        {...rest}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

/**
 * The app's button: a solid, slightly glossy face with a coloured shadow under
 * it. It sinks and darkens under the finger, and clicks when the press lands.
 */
export function MedButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  busy = false,
  icon,
  full = false,
  style,
}) {
  const { colors, radius, space, alpha, mode } = useTheme();
  const { scale, shade, pressIn, pressOut } = usePressMotion(0.96);

  const tones = {
    primary: { bg: colors.primary, fg: colors.primaryInk, border: colors.primary, glow: colors.primary },
    cold: { bg: colors.cold, fg: mode === 'dark' ? '#03202B' : '#FFFFFF', border: colors.cold, glow: colors.cold },
    danger: { bg: colors.danger, fg: colors.dangerInk, border: colors.danger, glow: colors.danger },
    quiet: { bg: alpha(colors.surfaceRaised, mode === 'dark' ? 0.85 : 0.95), fg: colors.text, border: colors.line, glow: colors.shadow },
    ghost: { bg: alpha(colors.primary, 0.14), fg: colors.primary, border: alpha(colors.primary, 0.35), glow: colors.primary },
  };
  const tone = tones[variant] || tones.primary;
  const solid = variant === 'primary' || variant === 'cold' || variant === 'danger';
  const inactive = disabled || busy;

  return (
    <Animated.View
      style={[
        {
          transform: [{ scale }],
          borderRadius: radius.md,
          shadowColor: tone.glow,
          shadowOpacity: inactive ? 0 : solid ? 0.35 : 0.12,
          shadowRadius: solid ? 12 : 8,
          shadowOffset: { width: 0, height: solid ? 6 : 3 },
          elevation: inactive ? 0 : solid ? 5 : 2,
        },
        full && { alignSelf: 'stretch' },
        style,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: inactive, busy }}
        disabled={inactive}
        onPressIn={pressIn}
        onPressOut={pressOut}
        onPress={() => {
          tapFeedback(solid ? 'medium' : 'light');
          onPress && onPress();
        }}
        android_ripple={{ color: alpha(solid ? '#FFFFFF' : colors.primary, 0.18) }}
        style={{
          backgroundColor: tone.bg,
          borderColor: tone.border,
          borderWidth: solid ? 0 : 1,
          borderRadius: radius.md,
          paddingVertical: 15,
          paddingHorizontal: space.xl,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.sm,
          opacity: inactive ? 0.5 : 1,
          minHeight: 52,
          overflow: 'hidden',
          ...(Platform.OS === 'web' ? { cursor: inactive ? 'not-allowed' : 'pointer', userSelect: 'none' } : null),
        }}
      >
        {/* The gloss across the top half of a solid face. */}
        {solid ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '50%',
              backgroundColor: 'rgba(255,255,255,0.10)',
            }}
          />
        ) : null}
        {/* Darkens under the finger. */}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.14)', opacity: shade }]}
        />
        {busy ? <ActivityIndicator size="small" color={tone.fg} /> : null}
        {!busy && icon ? icon : null}
        <Text
          style={{ fontSize: 15, lineHeight: 20, fontWeight: '700', letterSpacing: 0.4, color: tone.fg }}
          numberOfLines={1}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * A labelled field.
 *
 * Every piece of typing in the app goes through this one component, so a staff
 * ID, a PIN, a server address and a pharmacist's override all behave the same
 * way: a 50pt target a gloved finger can hit, a border that answers focus, the
 * hint underneath, and the error in place of the hint when there is one.
 */
export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  error,
  secure = false,
  multiline = false,
  keyboardType,
  autoCapitalize = 'none',
  maxLength,
  editable = true,
  monospace = false,
  onSubmitEditing,
  returnKeyType,
  right,
  style,
}) {
  const { colors, radius, space, alpha } = useTheme();
  const [focused, setFocused] = useState(false);
  const border = error ? colors.danger : focused ? colors.primary : colors.line;

  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? <T variant="label" tone="dim">{label}</T> : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.bgDeep,
          borderRadius: radius.md,
          borderWidth: focused || error ? 1.5 : StyleSheet.hairlineWidth,
          borderColor: border,
          paddingHorizontal: space.md,
          opacity: editable ? 1 : 0.6,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          secureTextEntry={secure}
          multiline={multiline}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          maxLength={maxLength}
          editable={editable}
          onSubmitEditing={onSubmitEditing}
          returnKeyType={returnKeyType}
          accessibilityLabel={label}
          style={{
            flex: 1,
            color: colors.text,
            fontSize: 16,
            paddingVertical: 14,
            minHeight: multiline ? 108 : 50,
            textAlignVertical: multiline ? 'top' : 'center',
            fontFamily: monospace ? (Platform.OS === 'ios' ? 'Menlo' : 'monospace') : undefined,
            ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
          }}
        />
        {right ? <View style={{ paddingLeft: space.sm }}>{right}</View> : null}
      </View>
      {error ? (
        <T variant="micro" tone="danger">{error}</T>
      ) : hint ? (
        <T variant="micro" tone="faint">{hint}</T>
      ) : null}
      {/* A focused field gets a faint underglow so it is obvious across a room. */}
      {focused ? (
        <View
          pointerEvents="none"
          style={{ height: 2, borderRadius: 2, backgroundColor: alpha(colors.primary, 0.5), marginTop: -4 }}
        />
      ) : null}
    </View>
  );
}

/** A row of mutually exclusive choices. */
export function ChoiceRow({ options, value, onChange, style }) {
  const { colors, radius, space, alpha } = useTheme();
  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }, style]}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Touchable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.value)}
            depth={0.94}
            style={{
              paddingVertical: 9,
              paddingHorizontal: space.md,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: active ? alpha(colors.primary, 0.6) : colors.line,
              backgroundColor: active ? alpha(colors.primary, 0.14) : 'transparent',
              minHeight: 38,
              justifyContent: 'center',
            }}
          >
            <T variant="label" style={{ color: active ? colors.primary : colors.textDim, fontWeight: active ? '700' : '500' }}>
              {option.label}
            </T>
          </Touchable>
        );
      })}
    </View>
  );
}

/** A label-and-value line, as used on every detail panel. */
export function Row({ label, value, tone, mono = false }) {
  const { space } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md, paddingVertical: 6 }}>
      <T variant="label" tone="dim">{label}</T>
      <T
        variant="label"
        tone={tone || 'text'}
        style={[{ flexShrink: 1, textAlign: 'right' }, mono ? { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' } : null]}
      >
        {value}
      </T>
    </View>
  );
}

export function Pill({ label, fg, bg, icon, style }) {
  const { radius, space, type } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: bg,
          borderRadius: radius.pill,
          paddingVertical: 5,
          paddingHorizontal: space.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
          alignSelf: 'flex-start',
        },
        style,
      ]}
    >
      {icon || null}
      <Text style={[type.micro, { color: fg, fontWeight: '700' }]}>{label}</Text>
    </View>
  );
}

export function StatusPill({ status, style }) {
  const { statusTone } = useTheme();
  const tone = statusTone(status);
  return <Pill label={tone.label} fg={tone.fg} bg={tone.bg} style={style} />;
}

/** A slow breathing dot. Used only where something is genuinely live. */
export function LiveDot({ color, size = 8 }) {
  const { reduceMotion } = useTheme();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  return (
    <View style={{ width: size * 2.2, height: size * 2.2, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={{
          position: 'absolute',
          width: size * 2.2,
          height: size * 2.2,
          borderRadius: size * 1.1,
          backgroundColor: color,
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.32, 0] }),
          transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
        }}
      />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}

export function Divider({ style }) {
  const { colors } = useTheme();
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: colors.lineSoft }, style]} />;
}

export function Banner({ tone = 'warn', title, message, action }) {
  const { colors, radius, space, alpha } = useTheme();
  const color = colors[tone] || colors.warn;
  return (
    <View
      style={{
        backgroundColor: alpha(color, 0.12),
        borderLeftWidth: 3,
        borderLeftColor: color,
        borderRadius: radius.sm,
        padding: space.md,
        gap: 4,
      }}
    >
      <T variant="bodyStrong" style={{ color }}>{title}</T>
      {message ? <T variant="label" tone="dim">{message}</T> : null}
      {action}
    </View>
  );
}

export function EmptyState({ icon, title, message, action }) {
  const { space } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.xxxl, gap: space.sm }}>
      {icon ? (
        <View style={{ opacity: 0.55, marginBottom: space.xs }}>
          {typeof icon === 'string' ? <T variant="title" tone="dim">{icon}</T> : icon}
        </View>
      ) : null}
      <T variant="subtitle">{title}</T>
      {message ? <T variant="label" tone="dim" style={{ textAlign: 'center', maxWidth: 300 }}>{message}</T> : null}
      {action}
    </View>
  );
}
