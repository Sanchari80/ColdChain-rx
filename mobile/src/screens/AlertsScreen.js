import React, { useEffect } from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useData } from '../state/DataContext';
import { useNav } from '../navigation/Navigator';
import { ScreenFrame } from '../components/ScreenFrame';
import { Card, EmptyState, LiveDot, Pill, T, Touchable } from '../components/Primitives';
import { celsius, etaLabel, relativeTime } from '../utils/format';

const SEVERITY = {
  critical: { glyph: '\u2715', tone: 'danger' },
  warn: { glyph: '\u25B3', tone: 'warn' },
  success: { glyph: '\u2713', tone: 'primary' },
  info: { glyph: '\u25C9', tone: 'cold' },
};

export function AlertsScreen() {
  const { colors, space, alpha } = useTheme();
  const { alerts, loading, refresh, markAlertsRead } = useData();
  const { push } = useNav();

  useEffect(() => {
    const timer = setTimeout(markAlertsRead, 900);
    return () => clearTimeout(timer);
  }, [markAlertsRead]);

  return (
    <ScreenFrame
      title="Alerts"
      subtitle="What the ward device is told, and nothing more"
      onRefresh={refresh}
      refreshing={loading}
    >
      <Card style={{ gap: 4, backgroundColor: alpha(colors.cold, 0.08), borderColor: alpha(colors.cold, 0.3) }}>
        <T variant="bodyStrong" tone="cold">No patient details on this screen</T>
        <T variant="label" tone="dim">
          Every alert is stripped of name, MRN, date of birth, phone and address before it leaves the server, and the server
          refuses to send one that still carries any of them.
        </T>
      </Card>

      {alerts.length === 0 ? (
        <EmptyState icon={'\u25CB'} title="No alerts yet" message="Alerts arrive when the pharmacy packs something for this ward." />
      ) : (
        alerts.map((alert) => {
          const severity = SEVERITY[alert.severity] || SEVERITY.info;
          const color = colors[severity.tone] || colors.cold;
          const breached = alert.coldChain && alert.coldChain.breached;

          return (
            <Touchable
              key={alert.id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${alert.indentId}`}
              onPress={() => push('indent', { id: alert.indentId })}
            >
              <Card style={{ gap: space.sm }} tone={alert.severity === 'critical' ? colors.danger : undefined}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <T style={{ color, fontSize: 15, fontWeight: '800' }}>{severity.glyph}</T>
                  <T variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{alert.drug}</T>
                  <T variant="micro" tone="faint">{relativeTime(alert.createdAt)}</T>
                </View>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' }}>
                  <Pill label={`${alert.ward} \u00B7 ${alert.bed}`} fg={colors.text} bg={alpha(colors.textDim, 0.14)} />
                  {alert.dose ? <T variant="label" tone="dim">{alert.dose}</T> : null}
                </View>

                {alert.status === 'in-transit' ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    <LiveDot color={breached ? colors.danger : colors.cold} />
                    <T variant="bodyStrong" tone={breached ? 'danger' : 'cold'}>{etaLabel(alert.eta)}</T>
                    <T variant="label" tone="dim">{`with ${alert.courier.staffName}`}</T>
                  </View>
                ) : (
                  <T variant="label" tone="dim">
                    {alert.status === 'blocked'
                      ? 'Blocked at the pharmacy safety check'
                      : alert.status === 'delivered-quarantine'
                        ? 'Delivered, but quarantined after a temperature excursion'
                        : alert.status === 'delivered'
                          ? `Received at the bedside from ${alert.courier.staffName}`
                          : alert.status}
                  </T>
                )}

                {alert.coldChain && alert.coldChain.currentCelsius !== null ? (
                  <T variant="micro" tone={breached ? 'danger' : 'faint'}>
                    {`${celsius(alert.coldChain.currentCelsius)} \u00B7 window ${alert.coldChain.minCelsius}\u00B0 to ${alert.coldChain.maxCelsius}\u00B0`}
                  </T>
                ) : null}

                <T variant="micro" tone="faint">{alert.subjectToken}</T>
              </Card>
            </Touchable>
          );
        })
      )}
    </ScreenFrame>
  );
}
