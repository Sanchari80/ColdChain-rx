import React, { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useAuth } from '../state/AuthContext';
import { useData } from '../state/DataContext';
import { ScreenFrame } from '../components/ScreenFrame';
import { Banner, Card, ChoiceRow, Divider, Field, MedButton, PanelHeader, Pill, Row, T } from '../components/Primitives';
import { BadgeIcon, ColdBoxIcon, DialIcon, PulseIcon, ShieldIcon, SyringeIcon } from '../components/MedicalIcons';

const APPEARANCE = [
  { value: 'system', label: 'Follow device' },
  { value: 'dark', label: 'Night ward' },
  { value: 'light', label: 'Day ward' },
];

/** Reads the acknowledgement code out of an ACK so it can be said in words. */
function acknowledgement(ack) {
  const line = String(ack || '').split(/\r\n|\r|\n/).find((segment) => segment.startsWith('MSA'));
  const code = line ? line.split('|')[1] : null;
  if (code === 'AA') return { code, label: 'Accepted' };
  if (code === 'AE') return { code, label: 'Rejected, application error' };
  if (code === 'AR') return { code, label: 'Rejected' };
  return { code: code || '--', label: 'Acknowledged' };
}

export function SettingsScreen() {
  const { colors, space, mode, toggleMode, followSystem, usingSystem, alpha, roleTone } = useTheme();
  const { user, signOut, baseUrl, setBaseUrl, can, changePin } = useAuth();
  const { capabilities, restoreBaseline, ingestHl7, loadOrderTemplates } = useData();

  const [draftUrl, setDraftUrl] = useState(baseUrl);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState(null);

  const [templates, setTemplates] = useState([]);
  const [templateKey, setTemplateKey] = useState(null);
  const [message, setMessage] = useState('');
  const [ack, setAck] = useState(null);

  const tone = roleTone(user ? user.role : 'nurse');
  const appearance = usingSystem ? 'system' : mode;

  useEffect(() => {
    if (!can('hl7:ingest')) return;
    let alive = true;
    loadOrderTemplates()
      .then((result) => {
        if (!alive) return;
        setTemplates((result.templates || []).filter((template) => template.category === 'order'));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [can, loadOrderTemplates]);

  const chooseAppearance = (value) => {
    if (value === 'system') return followSystem();
    if (value !== mode) return toggleMode();
    return undefined;
  };

  const submitPin = async () => {
    setPinError(null);
    if (newPin !== confirmPin) {
      setPinError('The two new PINs do not match.');
      return;
    }
    setBusy('pin');
    try {
      await changePin(currentPin, newPin);
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      setNotice({ tone: 'ok', title: 'PIN changed', message: 'Use the new PIN the next time you sign in.' });
    } catch (err) {
      setPinError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const sendMessage = async () => {
    setBusy('send');
    setNotice(null);
    setAck(null);
    try {
      const result = await ingestHl7(message.trim());
      setAck({ tone: 'ok', indentId: result.indent.id, ...acknowledgement(result.ack), raw: result.ack });
    } catch (err) {
      setNotice({ tone: 'danger', title: 'The interface rejected the message', message: err.message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScreenFrame
      title="Settings"
      subtitle={user ? user.name : undefined}
      icon={<DialIcon size={30} tint={colors.primary} />}
    >
      {notice ? (
        <Banner tone={notice.tone === 'ok' ? 'primary' : 'danger'} title={notice.title} message={notice.message} />
      ) : null}

      {user ? (
        <Card accent={tone.color} style={{ gap: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <BadgeIcon size={40} tint={tone.color} />
            <View style={{ flex: 1, gap: 2 }}>
              <T variant="subtitle">{user.name}</T>
              <T variant="label" tone="dim">
                {[user.title || user.role, user.ward || user.department].filter(Boolean).join(' · ')}
              </T>
            </View>
            <Pill label={user.id} fg={tone.color} bg={alpha(tone.color, 0.14)} />
          </View>
          <Divider />
          <Row label="Signed in with" value={user.method === 'sso' ? 'Hospital single sign-on' : 'Staff ID and PIN'} />
          <Row label="Account issued by" value="Hospital IT" />
          <T variant="micro" tone="faint">
            This session lives in memory only. Closing the app signs you out, so the next person on this device starts clean.
          </T>
        </Card>
      ) : null}

      {user && user.method !== 'sso' ? (
        <Card style={{ gap: space.md }}>
          <PanelHeader
            title="Your PIN"
            subtitle={user.mustChangePin ? 'Still the PIN hospital IT issued' : 'Change it whenever you need to'}
            icon={<ShieldIcon size={26} tint={user.mustChangePin ? colors.warn : colors.primary} />}
          />
          {user.mustChangePin ? (
            <Banner
              tone="warn"
              title="Set a PIN only you know"
              message="Your account is still on the PIN that was handed to you. Anyone who saw it can sign in as you."
            />
          ) : null}
          <Field label="Current PIN" value={currentPin} onChangeText={setCurrentPin} secure keyboardType="number-pad" maxLength={12} />
          <Field
            label="New PIN"
            value={newPin}
            onChangeText={setNewPin}
            secure
            keyboardType="number-pad"
            maxLength={12}
            hint="Four to twelve digits. Not a run of digits, not the same digit repeated."
          />
          <Field label="New PIN again" value={confirmPin} onChangeText={setConfirmPin} secure keyboardType="number-pad" maxLength={12} error={pinError} />
          <MedButton
            label="Change PIN"
            busy={busy === 'pin'}
            disabled={!currentPin || !newPin || !confirmPin}
            onPress={submitPin}
            full
          />
        </Card>
      ) : null}

      <Card style={{ gap: space.sm }}>
        <PanelHeader title="Appearance" subtitle="Night ward keeps the screen off the ceiling" icon={<PulseIcon size={24} color={colors.cold} />} />
        <ChoiceRow options={APPEARANCE} value={appearance} onChange={chooseAppearance} />
      </Card>

      <Card style={{ gap: space.sm }}>
        <PanelHeader title="Pharmacy service" subtitle="Where this device sends its requests" icon={<ColdBoxIcon size={26} tint={colors.cold} />} />
        <Field
          label="Address"
          value={draftUrl}
          onChangeText={setDraftUrl}
          keyboardType="url"
          hint="Supplied by hospital IT. Changing it signs you out of this device."
        />
        <MedButton
          label="Save and sign in again"
          variant="quiet"
          disabled={!draftUrl || draftUrl === baseUrl}
          onPress={() => setBaseUrl(draftUrl)}
        />
      </Card>

      {can('hl7:ingest') ? (
        <Card style={{ gap: space.md }}>
          <PanelHeader
            title="Order interface"
            subtitle="Send an OMP^O09 into the pharmacy queue"
            icon={<SyringeIcon size={26} tint={colors.primary} />}
          />
          <T variant="label" tone="dim">
            Orders normally arrive from the hospital order system over the interface engine. This console puts a message
            through the same parser and answers with the acknowledgement the sender would receive.
          </T>

          {templates.length ? (
            <View style={{ gap: 6 }}>
              <T variant="label" tone="dim">Start from a template</T>
              <ChoiceRow
                options={templates.map((template) => ({ value: template.key, label: template.label }))}
                value={templateKey}
                onChange={(key) => {
                  const template = templates.find((item) => item.key === key);
                  setTemplateKey(key);
                  setMessage(template ? template.message : '');
                  setAck(null);
                }}
              />
              {templateKey ? (
                <T variant="micro" tone="faint">
                  {(templates.find((item) => item.key === templateKey) || {}).note}
                </T>
              ) : null}
            </View>
          ) : null}

          <Field
            label="Message"
            value={message}
            onChangeText={(value) => { setMessage(value); setAck(null); }}
            placeholder="MSH|^~\&|..."
            multiline
            monospace
            hint="Segments may be separated by carriage returns or newlines."
          />

          <MedButton label="Send to the pharmacy queue" busy={busy === 'send'} disabled={message.trim().length < 8} onPress={sendMessage} full />

          {ack ? (
            <View style={{ gap: 6, backgroundColor: alpha(colors.primary, 0.1), borderRadius: 12, padding: space.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <T variant="bodyStrong" tone="primary">{ack.label}</T>
                <Pill label={ack.code} fg={colors.primary} bg={alpha(colors.primary, 0.16)} />
              </View>
              <T variant="label" tone="dim">{`${ack.indentId} is on the pharmacy queue.`}</T>
              <T
                variant="micro"
                tone="faint"
                style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}
                numberOfLines={2}
              >
                {ack.raw.split(/\r\n|\r|\n/).join('  ')}
              </T>
            </View>
          ) : null}
        </Card>
      ) : null}

      {capabilities ? (
        <Card style={{ gap: 2 }}>
          <PanelHeader title="System status" icon={<ShieldIcon size={26} tint={colors.steel} />} />
          <View style={{ height: space.sm }} />
          <Row label="Facility" value={capabilities.facility.name} />
          <Row label="Clinical record" value={capabilities.clinicalRecord.source} />
          <Row label="Record standard" value={capabilities.clinicalRecord.release} />
          <Row label="Formulary" value={capabilities.formulary.source} />
          {capabilities.formulary.updated ? (
            <Row label="Formulary pulled" value={new Date(capabilities.formulary.updated).toLocaleDateString()} />
          ) : null}
          <Row label="Products held" value={String(capabilities.formulary.productCount ?? '--')} />
          <Row label="Cold-chain window" value={`${capabilities.coldChain.minCelsius}° to ${capabilities.coldChain.maxCelsius}°C`} />
          <Row label="Version" value={capabilities.version} />
          <Divider style={{ marginVertical: space.sm }} />
          <T variant="micro" tone="faint" style={{ marginBottom: space.sm }}>Standards in use</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {capabilities.standards.map((standard) => (
              <Pill key={standard} label={standard} fg={colors.textDim} bg={alpha(colors.textDim, 0.12)} />
            ))}
          </View>
        </Card>
      ) : null}

      {can('system:manage') ? (
        <Card style={{ gap: space.sm }}>
          <PanelHeader title="Ward queue" subtitle="Administration only" icon={<ColdBoxIcon size={26} tint={colors.warn} />} />
          <T variant="label" tone="dim">
            Returns the queue, the alerts and the audit trail to their starting state.
          </T>
          <MedButton
            label="Reset the ward queue"
            variant="quiet"
            busy={busy === 'restore'}
            onPress={async () => {
              setBusy('restore');
              try {
                await restoreBaseline();
                setNotice({ tone: 'ok', title: 'Baseline restored', message: 'The ward queue is back to its starting state.' });
              } catch (err) {
                setNotice({ tone: 'danger', title: 'That did not go through', message: err.message });
              } finally {
                setBusy(null);
              }
            }}
          />
        </Card>
      ) : null}

      <MedButton label="Sign out" variant="danger" onPress={signOut} full />
    </ScreenFrame>
  );
}
