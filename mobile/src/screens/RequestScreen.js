import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { useData } from '../state/DataContext';
import { useNav } from '../navigation/Navigator';
import { Banner, Card, ChoiceRow, Field, MedButton, Pill, StatusPill, T, Touchable } from '../components/Primitives';
import { ColdBoxIcon, VialIcon } from '../components/MedicalIcons';
import { drugParts } from '../utils/format';

const DOSES = [1, 2, 3].map((value) => ({ value, label: value === 1 ? '1 dose' : `${value} doses` }));
const PRIORITY = [
  { value: 'routine', label: 'Routine' },
  { value: 'urgent', label: 'Urgent' },
];

function PrescriptionCard({ item, selected, onPress }) {
  const { colors, space, alpha } = useTheme();
  const { head, tail } = drugParts(item.drug.display);

  return (
    <Touchable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${item.drug.display}, ${item.bedLabel}`}
      onPress={onPress}
    >
      <Card padded={false} accent={selected ? colors.primary : undefined} tone={selected ? colors.primary : undefined}>
        <View style={{ padding: space.lg, gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <T variant="subtitle" numberOfLines={1}>{head}</T>
              {tail ? <T variant="label" tone="dim" numberOfLines={2}>{tail}</T> : null}
            </View>
            {selected ? <Pill label="Selected" fg={colors.primary} bg={alpha(colors.primary, 0.16)} /> : null}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md }}>
            <T variant="label" tone="dim">{item.bedLabel}</T>
            <T variant="label" tone="faint">{item.subjectToken}</T>
            <Pill label={`RxCUI ${item.drug.rxcui}`} fg={colors.cold} bg={alpha(colors.cold, 0.12)} />
          </View>
          {item.instructions ? <T variant="label" tone="dim">{item.instructions}</T> : null}
          {item.openIndent ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <T variant="micro" tone="warn">{`Already requested as ${item.openIndent.id}`}</T>
              <StatusPill status={item.openIndent.status} />
            </View>
          ) : null}
        </View>
      </Card>
    </Touchable>
  );
}

/**
 * A ward nurse asks the pharmacy for a refrigerated product.
 *
 * The list is the ward's active prescriptions, so a nurse can only ask for what
 * a doctor has ordered. The server sends the request on as an HL7 v2 OMP^O09
 * and the result screen says so, with the acknowledgement it got back.
 */
export function RequestScreen({ onClose }) {
  const { colors, space, gutter, alpha } = useTheme();
  const insets = useSafeAreaInsets();
  const { loadOrderable, requestMedication } = useData();
  const { push } = useNav();

  const [items, setItems] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [doses, setDoses] = useState(1);
  const [priority, setPriority] = useState('routine');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const result = await loadOrderable();
      setItems(result.items || []);
    } catch (err) {
      setLoadError(err.message);
      setItems([]);
    }
  }, [loadOrderable]);

  useEffect(() => { load(); }, [load]);

  const choice = items && items.find((item) => item.prescriptionId === selected);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await requestMedication({
        prescriptionId: selected,
        doses,
        priority,
        note: note.trim() || undefined,
      });
      setSent(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const startAgain = () => {
    setSent(null);
    setSelected(null);
    setDoses(1);
    setPriority('routine');
    setNote('');
    load();
  };

  return (
    <View style={{ flex: 1 }}>
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
          backgroundColor: alpha(colors.bg, 0.9),
        }}
      >
        <Touchable
          accessibilityRole="button"
          accessibilityLabel="Back to indents"
          onPress={onClose}
          hitSlop={12}
          style={{ paddingVertical: 6, paddingRight: 6 }}
        >
          <T variant="subtitle" tone="primary">{'←'}</T>
        </Touchable>
        <View style={{ flex: 1 }}>
          <T variant="subtitle">Request medication</T>
          <T variant="label" tone="dim">Refrigerated products on this ward{'’'}s prescriptions</T>
        </View>
        <ColdBoxIcon size={28} tint={colors.cold} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: gutter, paddingBottom: insets.bottom + 120, gap: space.md }}
        keyboardShouldPersistTaps="handled"
      >
        {sent ? (
          <>
            <Card accent={colors.primary} style={{ gap: space.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                <VialIcon size={36} tint={colors.primary} fill={0.7} />
                <View style={{ flex: 1, gap: 2 }}>
                  <T variant="subtitle">Sent to the pharmacy</T>
                  <T variant="label" tone="dim">{`${sent.indent.id} is waiting for the pharmacist to check it.`}</T>
                </View>
                <StatusPill status={sent.indent.status} />
              </View>
              <T variant="label" tone="dim">
                You will get a notification when it is packed, with who is bringing it and when it will arrive.
              </T>
            </Card>

            <Card style={{ gap: 6 }}>
              <T variant="subtitle">How it was sent</T>
              <T variant="label" tone="dim">
                {`HL7 v${sent.hl7.version} ${sent.hl7.messageType} · control id ${sent.hl7.messageControlId}`}
              </T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {sent.hl7.segments.map((segment, index) => (
                  <Pill key={`${segment}-${index}`} label={segment} fg={colors.cold} bg={alpha(colors.cold, 0.12)} />
                ))}
              </View>
              <T variant="micro" tone={sent.hl7.acknowledgementCode === 'AA' ? 'primary' : 'warn'} style={{ marginTop: 4 }}>
                {sent.hl7.acknowledgementCode === 'AA'
                  ? 'Acknowledged by the pharmacy system (ACK AA)'
                  : `ACK ${sent.hl7.acknowledgementCode || '--'}`}
              </T>
              <T variant="micro" tone="faint">
                Patient identifiers travel inside the message to the pharmacy system only. They are never sent back to this device.
              </T>
            </Card>

            <MedButton label="Open the indent" onPress={() => push('indent', { id: sent.indent.id })} full />
            <MedButton label="Request something else" variant="quiet" onPress={startAgain} full />
          </>
        ) : (
          <>
            {loadError ? (
              <Banner
                tone="danger"
                title="Cannot load this ward's prescriptions"
                message={loadError}
                action={<MedButton label="Try again" variant="quiet" onPress={load} style={{ marginTop: 8 }} />}
              />
            ) : null}

            {items === null ? (
              <View style={{ paddingVertical: space.xxl, alignItems: 'center' }}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : null}

            {items && !items.length && !loadError ? (
              <Card>
                <T variant="subtitle">Nothing to request</T>
                <T variant="label" tone="dim">No patient on this ward has an active prescription for a refrigerated product.</T>
              </Card>
            ) : null}

            {items && items.length ? (
              <>
                <T variant="label" tone="dim">1. Choose the prescription</T>
                {items.map((item) => (
                  <PrescriptionCard
                    key={item.prescriptionId}
                    item={item}
                    selected={item.prescriptionId === selected}
                    onPress={() => { setSelected(item.prescriptionId); setError(null); }}
                  />
                ))}
              </>
            ) : null}

            {choice ? (
              <Card style={{ gap: space.md }}>
                <T variant="label" tone="dim">2. Details</T>
                <View style={{ gap: 6 }}>
                  <T variant="label" tone="dim">How many doses</T>
                  <ChoiceRow options={DOSES} value={doses} onChange={setDoses} />
                </View>
                <View style={{ gap: 6 }}>
                  <T variant="label" tone="dim">Priority</T>
                  <ChoiceRow options={PRIORITY} value={priority} onChange={setPriority} />
                </View>
                <Field
                  label="Note for the pharmacy (optional)"
                  value={note}
                  onChangeText={setNote}
                  placeholder="For example: needed before 8 pm"
                  maxLength={140}
                  hint="Do not write patient names or numbers here."
                />
                {choice.openIndent ? (
                  <Banner
                    tone="warn"
                    title={`${choice.openIndent.id} is still open`}
                    message="Send another request only if the ward needs a further supply."
                  />
                ) : null}
                {error ? <Banner tone="danger" title="The request did not go through" message={error} /> : null}
                <MedButton label="Send to pharmacy" onPress={send} busy={busy} full />
              </Card>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}
