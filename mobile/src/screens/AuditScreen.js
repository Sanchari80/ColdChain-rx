import React, { useEffect } from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useData } from '../state/DataContext';
import { ScreenFrame } from '../components/ScreenFrame';
import { Card, Divider, EmptyState, Pill, T } from '../components/Primitives';
import { clockTime, relativeTime } from '../utils/format';

const ACTION_LABEL = { C: 'created', R: 'read', U: 'updated', D: 'deleted', E: 'executed' };

export function AuditScreen() {
  const { colors, space, alpha } = useTheme();
  const { audit, refreshAudit, loading } = useData();

  useEffect(() => {
    refreshAudit();
  }, [refreshAudit]);

  const integrity = audit.integrity;

  return (
    <ScreenFrame
      title="Audit"
      subtitle="Every read and write, in order"
      onRefresh={refreshAudit}
      refreshing={loading}
    >
      {integrity ? (
        <Card
          style={{
            gap: 4,
            backgroundColor: alpha(integrity.valid ? colors.primary : colors.danger, 0.08),
            borderColor: alpha(integrity.valid ? colors.primary : colors.danger, 0.35),
          }}
        >
          <T variant="bodyStrong" tone={integrity.valid ? 'primary' : 'danger'}>
            {integrity.valid ? 'Trail intact' : `Trail broken at entry ${integrity.brokenAt}`}
          </T>
          <T variant="label" tone="dim">
            {integrity.valid
              ? `${integrity.length} entries, each hashed onto the one before it. Editing or deleting any of them breaks every hash that follows.`
              : 'An entry has been changed or removed since it was written. Escalate to information governance.'}
          </T>
          {integrity.headHash ? (
            <T variant="micro" tone="faint" numberOfLines={1}>{`head ${integrity.headHash.slice(0, 32)}...`}</T>
          ) : null}
        </Card>
      ) : null}

      {audit.entries.length === 0 ? (
        <EmptyState icon={'\u2263'} title="Nothing recorded yet" message="Audit entries appear as soon as a chart is read or written." />
      ) : (
        <Card padded={false}>
          {audit.entries.map((entry, index) => (
            <View key={`${entry.sequence}-${entry.hash}`}>
              {index > 0 ? <Divider /> : null}
              <View style={{ padding: space.lg, gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <Pill
                    label={`#${entry.sequence}`}
                    fg={colors.textDim}
                    bg={alpha(colors.textDim, 0.14)}
                  />
                  <T variant="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>{entry.summary || entry.subtype}</T>
                </View>
                <T variant="label" tone="dim">
                  {`${entry.actorRole || 'staff'} ${entry.actorId} ${ACTION_LABEL[entry.action] || entry.action} \u00B7 ${clockTime(entry.recorded)} \u00B7 ${relativeTime(entry.recorded)}`}
                </T>
                {entry.entities && entry.entities.length ? (
                  <T variant="micro" tone="faint" numberOfLines={2}>{entry.entities.join('  ')}</T>
                ) : null}
                {entry.pendingSync ? <T variant="micro" tone="warn">Waiting to sync to the FHIR server</T> : null}
              </View>
            </View>
          ))}
        </Card>
      )}
    </ScreenFrame>
  );
}
