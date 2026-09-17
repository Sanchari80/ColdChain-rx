import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { T } from './Primitives';
import { celsius } from '../utils/format';

/**
 * The vial.
 *
 * This is the one place the app spends its boldness. A nurse glancing at a
 * phone from two metres away should be able to tell whether the medicine is
 * still cold without reading a number: the liquid level is the temperature
 * inside the 2-8 window, and the colour leaves green the moment it is not.
 */
export function ColdChainVial({ summary, height = 168, width = 78 }) {
  const { colors, radius, reduceMotion, temperatureColor, alpha } = useTheme();
  const min = summary?.minCelsius ?? 2;
  const max = summary?.maxCelsius ?? 8;
  const current = summary?.currentCelsius;
  const breached = Boolean(summary?.breachedNow || summary?.breached);

  // The visible scale runs a little either side of the safe window so a
  // breach has somewhere to go.
  const floor = min - 4;
  const ceiling = max + 6;
  const ratio = current === null || current === undefined
    ? 0.5
    : Math.min(1, Math.max(0, (current - floor) / (ceiling - floor)));

  const level = useRef(new Animated.Value(ratio)).current;
  const alarm = useRef(new Animated.Value(0)).current;
  const tint = temperatureColor(current, min, max);

  useEffect(() => {
    Animated.timing(level, {
      toValue: ratio,
      duration: reduceMotion ? 0 : 900,
      useNativeDriver: false,
    }).start();
  }, [ratio, level, reduceMotion]);

  useEffect(() => {
    if (!breached || reduceMotion) {
      alarm.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(alarm, { toValue: 1, duration: 900, useNativeDriver: false }),
        Animated.timing(alarm, { toValue: 0, duration: 900, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breached, alarm, reduceMotion]);

  const safeTop = ((ceiling - max) / (ceiling - floor)) * height;
  const safeHeight = ((max - min) / (ceiling - floor)) * height;

  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <View
        style={{
          width,
          height,
          borderRadius: radius.lg,
          borderWidth: 2,
          borderColor: colors.line,
          backgroundColor: colors.bgDeep,
          overflow: 'hidden',
          justifyContent: 'flex-end',
        }}
      >
        {/* The safe window, drawn behind the liquid. */}
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: safeTop,
            height: safeHeight,
            backgroundColor: alpha(colors.primary, 0.1),
            borderTopWidth: StyleSheet.hairlineWidth,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderColor: alpha(colors.primary, 0.45),
          }}
        />

        <Animated.View
          style={{
            height: level.interpolate({ inputRange: [0, 1], outputRange: [6, height] }),
            backgroundColor: alpha(tint, 0.75),
            borderTopWidth: 2,
            borderTopColor: tint,
          }}
        />

        <Animated.View
          pointerEvents="none"
          style={{
            ...StyleSheet.absoluteFillObject,
            borderRadius: radius.lg,
            borderWidth: 2,
            borderColor: colors.danger,
            opacity: alarm,
          }}
        />
      </View>

      <T variant="reading" style={{ color: tint }}>{celsius(current)}</T>
      <T variant="micro" tone="faint">{`safe ${min}\u00B0 to ${max}\u00B0`}</T>
    </View>
  );
}

/**
 * The journey so far, as a column chart. Bars rather than a smoothed line: each
 * bar is one probe reading, and pretending there is data between readings would
 * be a small lie in a record that may end up in an incident report.
 */
export function TempTrace({ readings = [], summary, height = 92 }) {
  const { colors, temperatureColor, alpha, radius } = useTheme();
  const min = summary?.minCelsius ?? 2;
  const max = summary?.maxCelsius ?? 8;

  const { floor, ceiling, series } = useMemo(() => {
    const values = readings.map((r) => r.celsius);
    const lo = Math.min(min - 2, ...(values.length ? values : [min]));
    const hi = Math.max(max + 2, ...(values.length ? values : [max]));
    return { floor: lo, ceiling: hi, series: readings.slice(-48) };
  }, [readings, min, max]);

  if (!series.length) {
    return (
      <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
        <T variant="label" tone="faint">No probe readings yet</T>
      </View>
    );
  }

  const span = Math.max(ceiling - floor, 1);
  const bandTop = ((ceiling - max) / span) * height;
  const bandHeight = ((max - min) / span) * height;

  return (
    <View>
      <View style={{ height, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: bandTop,
            height: bandHeight,
            backgroundColor: alpha(colors.primary, 0.09),
            borderTopWidth: StyleSheet.hairlineWidth,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderColor: alpha(colors.primary, 0.4),
          }}
        />
        {series.map((reading, index) => {
          const value = Math.min(Math.max(reading.celsius, floor), ceiling);
          const barHeight = Math.max(3, ((value - floor) / span) * height);
          return (
            <View
              key={`${reading.ts}-${index}`}
              style={{
                flex: 1,
                height: barHeight,
                borderRadius: radius.sm,
                backgroundColor: temperatureColor(reading.celsius, min, max),
                opacity: index === series.length - 1 ? 1 : 0.65,
              }}
            />
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        <T variant="micro" tone="faint">{`${series.length} readings`}</T>
        <T variant="micro" tone="faint">now</T>
      </View>
    </View>
  );
}

/**
 * Chain of custody. Numbered because this genuinely is a sequence: an indent
 * cannot reach step four without passing through step two.
 */
export function CustodyRail({ status, verdict }) {
  const { colors, space, alpha } = useTheme();

  const steps = [
    { key: 'requested', label: 'Ward raised the indent' },
    { key: 'verified', label: verdict === 'fail' ? 'Blocked at the safety check' : 'Checked against the prescription' },
    { key: 'in-transit', label: 'Packed and on the way' },
    { key: 'delivered', label: 'Received at the bedside' },
  ];

  const order = ['requested', 'verified', 'in-transit', 'delivered'];
  const reached = (key) => {
    if (status === 'blocked') return key === 'requested' || key === 'verified';
    if (status === 'cancelled') return key === 'requested';
    const currentIndex = order.indexOf(status === 'packed' ? 'in-transit' : status);
    return order.indexOf(key) <= (currentIndex === -1 ? 0 : currentIndex);
  };

  return (
    <View style={{ gap: 0 }}>
      {steps.map((step, index) => {
        const done = reached(step.key);
        const failed = step.key === 'verified' && verdict === 'fail';
        const color = failed && done ? colors.danger : done ? colors.primary : colors.lineSoft;
        return (
          <View key={step.key} style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ alignItems: 'center', width: 26 }}>
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  borderWidth: 2,
                  borderColor: color,
                  backgroundColor: done ? alpha(color, 0.2) : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <T variant="micro" style={{ color: done ? color : colors.textFaint, fontWeight: '700' }}>
                  {index + 1}
                </T>
              </View>
              {index < steps.length - 1 ? (
                <View style={{ width: 2, flex: 1, minHeight: 22, backgroundColor: done ? alpha(color, 0.5) : colors.lineSoft }} />
              ) : null}
            </View>
            <View style={{ flex: 1, paddingBottom: index < steps.length - 1 ? space.lg : 0 }}>
              <T variant={done ? 'bodyStrong' : 'body'} tone={done ? 'text' : 'faint'}>{step.label}</T>
            </View>
          </View>
        );
      })}
    </View>
  );
}
