import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, useColorScheme, useWindowDimensions } from 'react-native';
import { palette, space, radius, type, statusTone, verdictTone, roleTone, temperatureColor, withAlpha } from './tokens';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const scheme = useColorScheme();
  const { width } = useWindowDimensions();
  const [override, setOverride] = useState(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (alive) setReduceMotion(Boolean(value));
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      if (subscription && subscription.remove) subscription.remove();
    };
  }, []);

  const value = useMemo(() => {
    const mode = override || (scheme === 'light' ? 'light' : 'dark');
    const colors = palette[mode];
    // One content column that never gets uncomfortably wide on a tablet or on web.
    const contentWidth = Math.min(width, 620);
    return {
      mode,
      colors,
      space,
      radius,
      type,
      reduceMotion,
      isCompact: width < 380,
      isWide: width >= 720,
      contentWidth,
      gutter: width < 360 ? space.md : space.lg,
      setMode: setOverride,
      toggleMode: () => setOverride(mode === 'dark' ? 'light' : 'dark'),
      followSystem: () => setOverride(null),
      usingSystem: override === null,
      statusTone: (status) => statusTone(colors, status),
      roleTone: (role) => roleTone(colors, role),
      verdictTone: (verdict) => verdictTone(colors, verdict),
      temperatureColor: (celsius, min, max) => temperatureColor(colors, celsius, min, max),
      alpha: withAlpha,
    };
  }, [override, scheme, width, reduceMotion]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
