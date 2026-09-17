import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { T } from './Primitives';

/**
 * Shared page chrome.
 *
 * A frosted header bar over the ward floor, a scrolling body, and room at the
 * bottom for the tab bar. The frame itself is transparent: the floor is the
 * background of the whole app, and panels sit on it.
 */
export function ScreenFrame({ title, subtitle, icon, right, children, onRefresh, refreshing, scroll = true, footer }) {
  const { colors, space, gutter, alpha, mode } = useTheme();
  const insets = useSafeAreaInsets();

  const header = (
    <View
      style={{
        paddingTop: insets.top + space.md,
        paddingBottom: space.md,
        paddingHorizontal: gutter,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.lineSoft,
        backgroundColor: alpha(colors.bg, mode === 'dark' ? 0.88 : 0.92),
      }}
    >
      {icon ? <View style={{ opacity: 0.9 }}>{icon}</View> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="display">{title}</T>
        {subtitle ? <T variant="label" tone="dim">{subtitle}</T> : null}
      </View>
      {right}
    </View>
  );

  const body = scroll ? (
    <ScrollView
      contentContainerStyle={{ padding: gutter, paddingBottom: space.xxxl, gap: space.md }}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1, padding: gutter, gap: space.md }}>{children}</View>
  );

  return (
    <View style={{ flex: 1 }}>
      {header}
      {body}
      {footer}
    </View>
  );
}
