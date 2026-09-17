import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, BackHandler, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { T, Touchable } from '../components/Primitives';
import { MedIcon } from '../components/MedicalIcons';
import { HospitalFloor } from '../components/HospitalFloor';
import { useData } from '../state/DataContext';
import { useAuth } from '../state/AuthContext';
import { onNotificationOpened } from '../utils/notifications';

const NavContext = createContext(null);

export function useNav() {
  const value = useContext(NavContext);
  if (!value) throw new Error('useNav must be used inside Navigator');
  return value;
}

/**
 * The tab bar is built from the signed-in role, not from a fixed list.
 *
 * A courier carries deliveries and never sees the audit trail; only an
 * administrator sees the staff directory. The server refuses those routes for
 * the wrong role anyway — this is so nobody is shown a door they cannot open.
 */
const TAB_DEFINITIONS = [
  {
    key: 'indents',
    scope: 'indent:read',
    label: (role) => (role === 'courier' ? 'Deliveries' : 'Indents'),
    icon: (role) => (role === 'courier' ? 'trolley' : 'clipboard'),
  },
  { key: 'alerts', scope: 'notification:read', label: () => 'Alerts', icon: () => 'bell' },
  { key: 'directory', scope: 'directory:read', label: () => 'Staff', icon: () => 'badge' },
  { key: 'audit', scope: 'audit:read', label: () => 'Audit', icon: () => 'shield' },
  { key: 'settings', scope: null, label: () => 'Settings', icon: () => 'dial' },
];

export function Navigator({ tabs, detail }) {
  const { colors, space, radius, reduceMotion, alpha, contentWidth, mode } = useTheme();
  const insets = useSafeAreaInsets();
  const { unread } = useData();
  const { user, can } = useAuth();

  const visibleTabs = useMemo(() => {
    const role = user ? user.role : 'nurse';
    return TAB_DEFINITIONS
      .filter((item) => tabs[item.key] && (!item.scope || can(item.scope)))
      .map((item) => ({ key: item.key, label: item.label(role), icon: item.icon(role) }));
  }, [tabs, can, user]);

  const [tab, setTab] = useState(visibleTabs.length ? visibleTabs[0].key : 'settings');
  const [stack, setStack] = useState([]);
  const fade = useRef(new Animated.Value(1)).current;
  const slide = useRef(new Animated.Value(0)).current;

  // If the role changes under us, never leave the app pointing at a tab that
  // role is not allowed to open.
  useEffect(() => {
    if (!visibleTabs.some((item) => item.key === tab)) {
      setTab(visibleTabs.length ? visibleTabs[0].key : 'settings');
      setStack([]);
    }
  }, [visibleTabs, tab]);

  const pop = useCallback(() => {
    setStack((current) => current.slice(0, -1));
  }, []);

  const push = useCallback((name, params) => {
    setStack((current) => [...current, { name, params }]);
  }, []);

  const switchTab = useCallback((next) => {
    setStack([]);
    setTab((current) => {
      if (current === next) return current;
      if (!reduceMotion) {
        fade.setValue(0);
        Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
      }
      return next;
    });
  }, [fade, reduceMotion]);

  const top = stack[stack.length - 1] || null;

  // Tapping a ward alert notification opens the indent it is about.
  useEffect(() => onNotificationOpened((indentId) => {
    setStack([{ name: 'indent', params: { id: indentId } }]);
  }), []);

  useEffect(() => {
    if (!top || reduceMotion) {
      slide.setValue(0);
      return;
    }
    slide.setValue(1);
    Animated.spring(slide, { toValue: 0, useNativeDriver: true, speed: 16, bounciness: 2 }).start();
  }, [top, slide, reduceMotion]);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length) {
        pop();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [stack.length, pop]);

  const value = useMemo(() => ({ tab, push, pop, switchTab, stack }), [tab, push, pop, switchTab, stack]);

  const ActiveTab = tabs[tab] || tabs.settings;

  return (
    <NavContext.Provider value={value}>
      <View style={{ flex: 1 }}>
        <Animated.View style={{ flex: 1, opacity: fade }}>
          <View style={{ flex: 1, width: '100%', maxWidth: contentWidth, alignSelf: 'center' }}>
            <ActiveTab />
          </View>
        </Animated.View>

        {top ? (
          <Animated.View
            style={[
              StyleSheet.absoluteFillObject,
              {
                transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [0, 420] }) }],
              },
            ]}
          >
            <HospitalFloor>
              <View style={{ flex: 1, width: '100%', maxWidth: contentWidth, alignSelf: 'center' }}>
                {React.createElement(detail[top.name], { ...top.params, onClose: pop })}
              </View>
            </HospitalFloor>
          </Animated.View>
        ) : null}

        <View
          style={{
            flexDirection: 'row',
            paddingTop: space.sm,
            paddingBottom: Math.max(insets.bottom, space.sm),
            paddingHorizontal: space.sm,
            backgroundColor: alpha(colors.surface, mode === 'dark' ? 0.96 : 0.98),
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.line,
          }}
        >
          {visibleTabs.map((item) => {
            const active = item.key === tab && !top;
            const tint = active ? colors.primary : colors.textFaint;
            return (
              <Touchable
                key={item.key}
                containerStyle={{ flex: 1 }}
                depth={0.92}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={item.label}
                onPress={() => switchTab(item.key)}
                style={{
                  alignItems: 'center',
                  paddingVertical: space.xs,
                  borderRadius: radius.md,
                  backgroundColor: active ? alpha(colors.primary, 0.12) : 'transparent',
                  gap: 2,
                }}
              >
                <View>
                  <MedIcon name={item.icon} size={24} color={tint} tint={active ? colors.primary : colors.textFaint} />
                  {item.key === 'alerts' && unread > 0 ? (
                    <View
                      style={{
                        position: 'absolute',
                        top: -2,
                        right: -8,
                        minWidth: 16,
                        height: 16,
                        paddingHorizontal: 4,
                        borderRadius: 8,
                        backgroundColor: colors.danger,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <T variant="micro" style={{ color: '#fff', fontWeight: '800' }}>{unread > 9 ? '9+' : unread}</T>
                    </View>
                  ) : null}
                </View>
                <T variant="micro" style={{ color: tint, fontWeight: active ? '700' : '500' }}>
                  {item.label}
                </T>
              </Touchable>
            );
          })}
        </View>
      </View>
    </NavContext.Provider>
  );
}
