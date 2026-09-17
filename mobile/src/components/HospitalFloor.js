import React from 'react';
import { ImageBackground, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeProvider';

const WARD = require('../../assets/hospital-ward.jpg');

/**
 * The room the app is standing in: a photograph of an inpatient ward behind
 * everything, washed with the theme colour so the panels on top stay readable.
 *
 * `hero` lets more of the ward through at the top, for the sign-in screen.
 * Everywhere else the photo is softened and pushed further back, because the
 * contrast belongs to temperature readings and safety verdicts, not wallpaper.
 */
export function HospitalFloor({ variant = 'plain', children }) {
  const { colors, alpha, mode } = useTheme();
  const hero = variant === 'hero';
  const dark = mode === 'dark';

  const wash = hero
    ? [alpha(colors.bg, dark ? 0.15 : 0.1), alpha(colors.bg, dark ? 0.62 : 0.55), alpha(colors.bg, dark ? 0.94 : 0.92)]
    : [alpha(colors.bg, dark ? 0.66 : 0.62), alpha(colors.bg, dark ? 0.76 : 0.72), alpha(colors.bg, dark ? 0.9 : 0.88)];

  return (
    <View style={{ flex: 1, backgroundColor: colors.floor }}>
      <ImageBackground
        source={WARD}
        resizeMode="cover"
        blurRadius={hero ? 0 : 3}
        style={StyleSheet.absoluteFill}
      >
        {/* A clinical teal cast so the photo sits inside the palette. */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: alpha(colors.coldDeep, dark ? 0.18 : 0.08) }]} />
        <LinearGradient colors={wash} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
      </ImageBackground>
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}
