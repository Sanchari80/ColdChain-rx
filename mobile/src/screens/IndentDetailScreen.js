import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { useData } from '../state/DataContext';
import { useAuth } from '../state/AuthContext';
import { Banner, Card, Divider, MedButton, Pill, StatusPill, T, Touchable } from '../components/Primitives';
import { ColdChainVial, CustodyRail, TempTrace } from '../components/ColdChain';
import { celsius, clockTime, drugParts, etaLabel } from '../utils/format';

const COURIERS = [
  { id: 'CUR-01', name: 'Rakib Mia' },
  { id: 'CUR-02', name: 'Shila Akter' },
  { id: 'CUR-03', name: 'Jamal Uddin' },
  { id: 'CUR-04', name: 'Transport unit T-3' },
];

function CheckRow({ check }) {
  const { colors, space } = useTheme();
  const tone = { pass: colors.primary, warn: colors.warn, fail: colors.danger }[check.severity] || colors.textDim;
  const glyph = { pass: '\u2713', warn: '\u25B3', fail: '\u2715' }[check.severity] || '\u00B7';

  return (
    <View style={{ flexDirection: 'row', gap: space.md, paddingVertical: space.sm }}>
      <T style={{ color: tone, fontSize: 15, width: 18, fontWeight: '800' }}>{glyph}</T>
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="bodyStrong" style={{ color: check.severity === 'pass' ? colors.text : tone }}>{check.label}</T>
        <T variant="label" tone="dim">{check.message}</T>
      </View>
    </View>
  );
}

function ActionResult({ result, onDismiss }) {
  if (!result) return null;
  return (
    <Banner
      tone={result.tone}
      title={result.title}
      message={result.message}
      action={<MedButton label="Dismiss" variant="quiet" onPress={onDismiss} style={{ marginTop: 8 }} />}
    />
  );
}

export function IndentDetailScreen({ id, onClose }) {
  const { colors, space, radius, gutter, alpha, verdictTone } = useTheme();
  const insets = useSafeAreaInsets();
  const { getIndent, verify, dispense, receive, loadTelemetry } = useData();
  const { user, can } = useAuth();

  const indent = getIndent(id);
  const [telemetry, setTelemetry] = useState(null);
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const [courierId, setCourierId] = useState('CUR-01');
  const [overrideReason, setOverrideReason] = useState('');

  const pullTelemetry = useCallback(async () => {
    try {
      const data = await loadTelemetry(id);
      setTelemetry(data);
    } catch {
      setTelemetry(null);
    }
  }, [id, loadTelemetry]);

  useEffect(() => {
    pullTelemetry();
    const timer = setInterval(pullTelemetry, 6000);
    return () => clearInterval(timer);
  }, [pullTelemetry]);

  if (!indent) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: gutter }}>
        <T variant="subtitle">That indent is no longer on the list</T>
        <MedButton label="Back to indents" variant="quiet" onPress={onClose} />
      </View>
    );
  }

  const verification = indent.verification;
  const verdict = verification ? verification.verdict : null;
  const tone = verdictTone(verdict);
  const { head, tail } = drugParts(indent.drug && indent.drug.display);
  const summary = telemetry ? telemetry.summary : indent.telemetry;
  const needsOverride = verdict === 'review';

  const run = async (kind, fn, success) => {
    setBusy(kind);
    setResult(null);
    try {
      await fn();
      setResult(success);
      pullTelemetry();
    } catch (err) {
      setResult({
        tone: 'danger',
        title: 'That did not go through',
        message: err.details && err.details.warnings ? err.details.warnings.join(' ') : err.message,
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View
        style={{
          paddingTop: insets.top + space.sm,
          paddingBottom: space.md,
          paddingHorizontal: gutter,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.lineSoft,
        }}
      >
        <Touchable
          accessibilityRole="button"
          accessibilityLabel="Back to indents"
          onPress={onClose}
          hitSlop={12}
          style={{ paddingVertical: 6, paddingRight: 6 }}
        >
          <T variant="subtitle" tone="primary">{'\u2190'}</T>
        </Touchable>
        <View style={{ flex: 1 }}>
          <T variant="subtitle" numberOfLines={1}>{indent.id}</T>
          <T variant="label" tone="dim">{indent.bedLabel}</T>
        </View>
        <StatusPill status={indent.status} />
      </View>

      <ScrollView contentContainerStyle={{ padding: gutter, paddingBottom: insets.bottom + 60, gap: space.md }}>
        <ActionResult result={result} onDismiss={() => setResult(null)} />

        <Card style={{ gap: space.sm }}>
          <T variant="title">{head}</T>
          {tail ? <T variant="body" tone="dim">{tail}</T> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: 4 }}>
            {indent.dose ? <Pill label={indent.dose} fg={colors.text} bg={alpha(colors.textDim, 0.14)} /> : null}
            {indent.drug && indent.drug.route ? <Pill label={indent.drug.route} fg={colors.text} bg={alpha(colors.textDim, 0.14)} /> : null}
            {indent.drug && indent.drug.rxcui ? (
              <Pill label={`RxCUI ${indent.drug.rxcui}`} fg={colors.cold} bg={alpha(colors.cold, 0.14)} />
            ) : null}
          </View>
          <Divider style={{ marginVertical: space.sm }} />
          <T variant="micro" tone="faint">
            {`Patient shown as ${indent.subjectToken}. Confirm identity from the chart at the bedside \u2014 this screen carries no patient details on purpose.`}
          </T>
        </Card>

        {summary ? (
          <Card style={{ gap: space.lg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <T variant="subtitle">Cold chain</T>
              {summary.breached ? <Pill label="Excursion recorded" fg={colors.danger} bg={alpha(colors.danger, 0.15)} /> : null}
            </View>

            <View style={{ flexDirection: 'row', gap: space.lg, alignItems: 'center' }}>
              <ColdChainVial summary={summary} />
              <View style={{ flex: 1, gap: space.sm }}>
                <View>
                  <T variant="micro" tone="faint">Highest seen</T>
                  <T variant="bodyStrong">{celsius(summary.highestCelsius)}</T>
                </View>
                <View>
                  <T variant="micro" tone="faint">Mean kinetic temperature</T>
                  <T variant="bodyStrong">{celsius(summary.meanKineticCelsius)}</T>
                </View>
                <View>
                  <T variant="micro" tone="faint">Time outside 2-8</T>
                  <T variant="bodyStrong" tone={summary.breached ? 'danger' : 'text'}>
                    {`${summary.approxMinutesOutOfRange} min`}
                  </T>
                </View>
              </View>
            </View>

            <TempTrace readings={telemetry ? telemetry.readings : []} summary={summary} />

            {summary.breached ? (
              <Banner
                tone="danger"
                title="Do not administer without pharmacy clearance"
                message="This product left the 2-8 degree window in transit. The dispense record is held on-hold until pharmacy assesses it."
              />
            ) : null}
          </Card>
        ) : null}

        <Card style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <T variant="subtitle">Prescription check</T>
            <Pill label={tone.label} fg={tone.fg} bg={tone.bg} />
          </View>

          {!verification ? (
            <T variant="label" tone="dim">
              Nothing has been checked yet. Verification reads the doctor{"'"}s order from the EHR and compares it by RxNorm code, not by name.
            </T>
          ) : (
            <>
              <T variant="micro" tone="faint">
                {`Checked ${clockTime(verification.checkedAt)} by ${verification.checkedBy.name}`}
              </T>
              <Divider style={{ marginVertical: 4 }} />
              {verification.checks.map((check) => (
                <CheckRow key={`${check.code}-${check.label}`} check={check} />
              ))}

              {verification.rxnorm && verification.rxnorm.prescribed ? (
                <>
                  <Divider style={{ marginVertical: space.sm }} />
                  <T variant="micro" tone="faint">RxNorm evidence</T>
                  <View style={{ gap: 6, marginTop: 4 }}>
                    <View>
                      <T variant="micro" tone="faint">Prescribed</T>
                      <T variant="label">{`${verification.rxnorm.prescribed.name} (${verification.rxnorm.prescribed.rxcui})`}</T>
                    </View>
                    {verification.rxnorm.requested ? (
                      <View>
                        <T variant="micro" tone="faint">Requested by the ward</T>
                        <T variant="label">{`${verification.rxnorm.requested.name} (${verification.rxnorm.requested.rxcui})`}</T>
                      </View>
                    ) : null}
                  </View>
                </>
              ) : null}
            </>
          )}
        </Card>

        <Card style={{ gap: space.md }}>
          <T variant="subtitle">Chain of custody</T>
          <CustodyRail status={indent.status} verdict={verdict} />
          {indent.delivery ? (
            <>
              <Divider />
              <View style={{ gap: 4 }}>
                <T variant="label" tone="dim">{`Carried by ${indent.delivery.courier.name}, ${indent.delivery.courier.role.toLowerCase()}`}</T>
                <T variant="label" tone="dim">
                  {indent.status === 'delivered'
                    ? `Received at ${clockTime(indent.delivery.deliveredAt)}`
                    : `${etaLabel(indent.delivery.eta)} \u00B7 packed ${clockTime(indent.delivery.preparedAt)}`}
                </T>
                {indent.delivery.overrideReason ? (
                  <T variant="label" tone="warn">{`Override: ${indent.delivery.overrideReason}`}</T>
                ) : null}
                <T variant="micro" tone="faint">{`MedicationDispense/${indent.delivery.medicationDispenseId}`}</T>
              </View>
            </>
          ) : null}
        </Card>

        {indent.hl7 ? (
          <Card style={{ gap: 6 }}>
            <T variant="subtitle">Source message</T>
            <T variant="label" tone="dim">{`HL7 v2 OMP^O09 \u00B7 control id ${indent.hl7.messageControlId}`}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
              {indent.hl7.segments.map((segment, index) => (
                <Pill key={`${segment}-${index}`} label={segment} fg={colors.cold} bg={alpha(colors.cold, 0.12)} />
              ))}
            </View>
          </Card>
        ) : null}

        {can('indent:dispense') && needsOverride && !['in-transit', 'delivered'].includes(indent.status) ? (
          <Card style={{ gap: space.sm }}>
            <T variant="subtitle">Pharmacist override</T>
            <T variant="label" tone="dim">The check raised warnings. Record why it is still safe to send.</T>
            <TextInput
              value={overrideReason}
              onChangeText={setOverrideReason}
              placeholder="Evening dose is separately charted and due now"
              placeholderTextColor={colors.textFaint}
              multiline
              accessibilityLabel="Override reason"
              style={{
                backgroundColor: colors.bgDeep,
                borderRadius: radius.md,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: colors.line,
                color: colors.text,
                padding: space.md,
                minHeight: 74,
                textAlignVertical: 'top',
              }}
            />
          </Card>
        ) : null}

        {can('indent:dispense') && ['verified', 'requested'].includes(indent.status) ? (
          <Card style={{ gap: space.sm }}>
            <T variant="subtitle">Courier</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {COURIERS.map((courier) => {
                const active = courier.id === courierId;
                return (
                  <Touchable
                    key={courier.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => setCourierId(courier.id)}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: space.md,
                      borderRadius: radius.pill,
                      borderWidth: 1,
                      borderColor: active ? alpha(colors.primary, 0.6) : colors.line,
                      backgroundColor: active ? alpha(colors.primary, 0.14) : 'transparent',
                    }}
                  >
                    <T variant="label" style={{ color: active ? colors.primary : colors.textDim }}>{courier.name}</T>
                  </Touchable>
                );
              })}
            </View>
          </Card>
        ) : null}

        <View style={{ gap: space.sm }}>
          {can('indent:verify') && !['in-transit', 'delivered', 'cancelled'].includes(indent.status) ? (
            <MedButton
              label={verification ? 'Check again' : 'Check against the prescription'}
              variant="cold"
              busy={busy === 'verify'}
              full
              onPress={() => run('verify', () => verify(indent.id), {
                tone: 'ok',
                title: 'Check complete',
                message: 'The result is in the prescription check card above.',
              })}
            />
          ) : null}

          {can('indent:dispense') && ['verified', 'requested'].includes(indent.status) ? (
            <MedButton
              label="Pack and dispatch"
              busy={busy === 'dispense'}
              disabled={verdict === 'fail' || (needsOverride && overrideReason.trim().length < 8)}
              full
              onPress={() => run('dispense', () => dispense(indent.id, {
                courierId,
                overrideReason: overrideReason.trim() ? overrideReason.trim() : undefined,
              }), {
                tone: 'ok',
                title: 'Packed and on the way',
                message: 'The ward has been alerted. The alert carries no patient details.',
              })}
            />
          ) : null}

          {can('indent:receive') && indent.status === 'in-transit' ? (
            <MedButton
              label="Confirm received at the bedside"
              busy={busy === 'receive'}
              full
              onPress={() => run('receive', () => receive(indent.id, {
                receivedBy: user ? { id: user.id, name: user.name, role: user.role } : undefined,
              }), {
                tone: summary && summary.breached ? 'warn' : 'ok',
                title: summary && summary.breached ? 'Received, and quarantined' : 'Received',
                message: summary && summary.breached
                  ? 'The dispense record is on-hold because of the temperature excursion.'
                  : 'The dispense record is now complete in the EHR.',
              })}
            />
          ) : null}

          {verdict === 'fail' ? (
            <Banner
              tone="danger"
              title="This indent is blocked"
              message={`${indent.blockedReason} Ask the prescriber to correct the order, then check again.`}
            />
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
