import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useData } from '../state/DataContext';
import { useAuth } from '../state/AuthContext';
import { useNav } from '../navigation/Navigator';
import { ScreenFrame } from '../components/ScreenFrame';
import { Banner, Card, EmptyState, LiveDot, MedButton, Pill, StatusPill, T, Touchable } from '../components/Primitives';
import { celsius, drugParts, etaLabel, relativeTime } from '../utils/format';

const FILTERS = [
  { key: 'open', label: 'Open', match: (item) => !['delivered', 'cancelled'].includes(item.status) },
  { key: 'transit', label: 'On the way', match: (item) => item.status === 'in-transit' },
  { key: 'attention', label: 'Needs attention', match: (item) => item.status === 'blocked' || item.status === 'requested' || Boolean(item.telemetry && item.telemetry.breached) },
  { key: 'all', label: 'All', match: () => true },
];

function IndentCard({ item, index, onPress, animate }) {
  const { colors, space, temperatureColor, alpha, reduceMotion } = useTheme();
  // Decided once, when the card mounts. If `animate` flipped later and restarted
  // the effect, stopping the running animation would leave the card half faded.
  const entering = useRef(animate && !reduceMotion).current;
  const enter = useRef(new Animated.Value(entering ? 0 : 1)).current;

  useEffect(() => {
    if (!entering) return undefined;
    const animation = Animated.timing(enter, {
      toValue: 1,
      duration: 320,
      delay: Math.min(index, 6) * 55,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => { if (!finished) enter.setValue(1); });
    return () => {
      animation.stop();
      enter.setValue(1);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per card, on mount
  }, []);

  const { head, tail } = drugParts(item.drug && item.drug.display);
  const telemetry = item.telemetry;
  const breached = Boolean(telemetry && telemetry.breached);
  const tint = telemetry ? temperatureColor(telemetry.currentCelsius, telemetry.minCelsius, telemetry.maxCelsius) : colors.textFaint;

  return (
    <Animated.View
      style={{
        opacity: enter,
        transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
      }}
    >
      <Touchable accessibilityRole="button" accessibilityLabel={`Open indent ${item.id}`} onPress={onPress}>
        <Card padded={false} tone={breached ? colors.danger : undefined}>
          <View style={{ flexDirection: 'row' }}>
            {/* A temperature spine, not decoration: the colour is the reading. */}
            <View style={{ width: 4, backgroundColor: telemetry ? tint : colors.lineSoft }} />

            <View style={{ flex: 1, padding: space.lg, gap: space.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <T variant="subtitle" numberOfLines={1}>{head}</T>
                  {tail ? <T variant="label" tone="dim" numberOfLines={1}>{tail}</T> : null}
                </View>
                <StatusPill status={item.status} />
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' }}>
                <T variant="label" tone="dim">{item.bedLabel}</T>
                <T variant="label" tone="faint">{item.id}</T>
                {item.dose ? <T variant="label" tone="dim">{item.dose}</T> : null}
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
                {item.status === 'in-transit' && item.delivery ? (
                  <>
                    <LiveDot color={breached ? colors.danger : colors.cold} />
                    <T variant="bodyStrong" tone={breached ? 'danger' : 'cold'}>{etaLabel(item.delivery.eta)}</T>
                    <T variant="label" tone="dim">{`with ${item.delivery.courier.name}`}</T>
                  </>
                ) : null}

                {telemetry ? (
                  <Pill
                    label={breached ? `Out of range ${celsius(telemetry.currentCelsius)}` : celsius(telemetry.currentCelsius)}
                    fg={tint}
                    bg={alpha(tint, 0.14)}
                  />
                ) : null}

                {item.status === 'blocked' ? (
                  <T variant="label" tone="danger" numberOfLines={2} style={{ flex: 1 }}>{item.blockedReason}</T>
                ) : null}

                {item.status === 'requested' ? (
                  <T variant="label" tone="warn">Not checked against the prescription yet</T>
                ) : null}

                {item.status === 'delivered' && item.delivery ? (
                  <T variant="label" tone="dim">{`Received ${relativeTime(item.delivery.deliveredAt)}`}</T>
                ) : null}
              </View>
            </View>
          </View>
        </Card>
      </Touchable>
    </Animated.View>
  );
}

export function IndentsScreen() {
  const { colors, space, radius, alpha } = useTheme();
  const { indents, loading, refresh, lastError, lastSyncedAt } = useData();
  const { user, can } = useAuth();
  const { push } = useNav();
  const [filter, setFilter] = useState('open');
  const firstLoad = useRef(true);

  const visible = useMemo(() => {
    const rule = FILTERS.find((f) => f.key === filter) || FILTERS[3];
    return indents.filter(rule.match);
  }, [indents, filter]);

  useEffect(() => {
    if (indents.length) firstLoad.current = false;
  }, [indents.length]);

  const attention = indents.filter((item) => item.status === 'blocked' || (item.telemetry && item.telemetry.breached)).length;

  return (
    <ScreenFrame
      title="Indents"
      subtitle={user ? `${user.name} \u00B7 ${user.role}${user.ward ? ` \u00B7 ${user.ward}` : ''}` : undefined}
      onRefresh={refresh}
      refreshing={loading}
    >
      {lastError ? (
        <Banner
          tone="danger"
          title="Cannot reach the pharmacy service"
          message={lastError}
          action={<MedButton label="Try again" variant="quiet" onPress={refresh} style={{ marginTop: 8 }} />}
        />
      ) : null}

      {can('indent:request') ? (
        <MedButton label="Request medication" onPress={() => push('request')} full />
      ) : null}

      {attention > 0 ? (
        <Banner
          tone="danger"
          title={attention === 1 ? '1 indent needs attention' : `${attention} indents need attention`}
          message="Blocked at the safety check or outside the 2-8 degree window."
        />
      ) : null}

      <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
        {FILTERS.map((item) => {
          const active = item.key === filter;
          return (
            <Touchable
              key={item.key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setFilter(item.key)}
              style={{
                paddingVertical: 7,
                paddingHorizontal: space.md,
                borderRadius: radius.pill,
                backgroundColor: active ? alpha(colors.primary, 0.16) : colors.surface,
                borderWidth: 1,
                borderColor: active ? alpha(colors.primary, 0.5) : colors.line,
              }}
            >
              <T variant="label" style={{ color: active ? colors.primary : colors.textDim, fontWeight: active ? '700' : '500' }}>
                {item.label}
              </T>
            </Touchable>
          );
        })}
      </View>

      {visible.length === 0 ? (
        <EmptyState
          icon={'\u2713'}
          title={filter === 'open' ? 'Nothing waiting' : 'Nothing here'}
          message={filter === 'open'
            ? 'Every indent on the ward has been received. New requests appear here as the pharmacy system sends them.'
            : 'Try a different filter.'}
        />
      ) : (
        visible.map((item, index) => (
          <IndentCard
            key={item.id}
            item={item}
            index={index}
            animate={firstLoad.current}
            onPress={() => push('indent', { id: item.id })}
          />
        ))
      )}

      {lastSyncedAt ? (
        <T variant="micro" tone="faint" style={{ textAlign: 'center' }}>{`Updated ${relativeTime(lastSyncedAt)}`}</T>
      ) : null}
    </ScreenFrame>
  );
}
