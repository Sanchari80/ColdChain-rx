import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useAuth } from '../state/AuthContext';
import { useData } from '../state/DataContext';
import { ScreenFrame } from '../components/ScreenFrame';
import { Banner, Card, ChoiceRow, Divider, EmptyState, Field, MedButton, PanelHeader, Pill, Row, T, Touchable } from '../components/Primitives';
import { BadgeIcon, GloveIcon, ShieldIcon } from '../components/MedicalIcons';
import { relativeTime } from '../utils/format';

const FILTERS = [
  { value: 'all', label: 'Everyone' },
  { value: 'nurse', label: 'Ward' },
  { value: 'pharmacist', label: 'Pharmacy' },
  { value: 'courier', label: 'Logistics' },
  { value: 'admin', label: 'Administration' },
  { value: 'suspended', label: 'Suspended' },
];

const ROLE_OPTIONS = [
  { value: 'nurse', label: 'Ward nurse' },
  { value: 'pharmacist', label: 'Pharmacist' },
  { value: 'courier', label: 'Courier' },
  { value: 'admin', label: 'Administrator' },
];

function AccountRow({ account, busy, onSuspend, onReinstate, onReissue }) {
  const { colors, space, alpha, roleTone } = useTheme();
  const [open, setOpen] = useState(false);
  const tone = roleTone(account.role);
  const suspended = account.status === 'suspended';

  return (
    <View>
      <Touchable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${account.name}, ${account.title}`}
        onPress={() => setOpen((value) => !value)}
        style={{ paddingVertical: space.md, flexDirection: 'row', alignItems: 'center', gap: space.md }}
      >
        <BadgeIcon size={28} tint={suspended ? colors.textFaint : tone.color} />
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="bodyStrong" numberOfLines={1} tone={suspended ? 'faint' : 'text'}>{account.name}</T>
          <T variant="label" tone="dim" numberOfLines={1}>
            {[account.id, account.ward || account.department].filter(Boolean).join(' · ')}
          </T>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Pill
            label={suspended ? 'Suspended' : account.locked ? 'Locked' : tone.label}
            fg={suspended ? colors.danger : account.locked ? colors.warn : tone.color}
            bg={alpha(suspended ? colors.danger : account.locked ? colors.warn : tone.color, 0.14)}
          />
          <T variant="micro" tone="faint">
            {account.lastSignInAt ? `Signed in ${relativeTime(account.lastSignInAt)}` : 'Never signed in'}
          </T>
        </View>
      </Touchable>

      {open ? (
        <View style={{ paddingBottom: space.md, gap: space.sm }}>
          <Row label="Role" value={account.title} />
          {account.department ? <Row label="Department" value={account.department} /> : null}
          <Row label="Sign-in" value={account.usesSingleSignOn ? 'Hospital single sign-on' : 'Staff ID and PIN'} />
          <Row label="Starter PIN" value={account.mustChangePin ? 'Not yet changed' : 'Changed by the holder'} tone={account.mustChangePin ? 'warn' : 'primary'} />
          <Row label="Provisioned by" value={account.provisionedBy} />
          <View style={{ gap: space.sm, marginTop: space.xs }}>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <MedButton
                label="Reissue PIN"
                variant="quiet"
                style={{ flex: 1 }}
                busy={busy === `pin:${account.id}`}
                onPress={() => onReissue(account)}
              />
              {suspended ? (
                <MedButton
                  label="Reinstate"
                  variant="ghost"
                  style={{ flex: 1 }}
                  busy={busy === `status:${account.id}`}
                  onPress={() => onReinstate(account)}
                />
              ) : (
                <MedButton
                  label="Suspend"
                  variant="danger"
                  style={{ flex: 1 }}
                  busy={busy === `status:${account.id}`}
                  onPress={() => onSuspend(account)}
                />
              )}
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function DirectoryScreen() {
  const { colors, space, alpha } = useTheme();
  const { user } = useAuth();
  const { loadDirectory, provisionAccount, setAccountStatus, reissuePin } = useData();

  const [accounts, setAccounts] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [issued, setIssued] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ id: '', name: '', role: 'nurse', ward: '', department: '', ssoSubject: '' });
  const [formError, setFormError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loadDirectory();
      setAccounts(result.accounts || []);
      setNotice(null);
    } catch (err) {
      setNotice({ tone: 'danger', title: 'Cannot read the staff directory', message: err.message });
    } finally {
      setLoading(false);
    }
  }, [loadDirectory]);

  useEffect(() => { refresh(); }, [refresh]);

  const visible = useMemo(() => {
    if (filter === 'all') return accounts;
    if (filter === 'suspended') return accounts.filter((account) => account.status === 'suspended');
    return accounts.filter((account) => account.role === filter);
  }, [accounts, filter]);

  const counts = useMemo(() => ({
    total: accounts.length,
    active: accounts.filter((account) => account.status === 'active').length,
    pending: accounts.filter((account) => account.mustChangePin).length,
  }), [accounts]);

  const update = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));

  const provision = async () => {
    setFormError(null);
    if (!form.id.trim() || !form.name.trim()) {
      setFormError('A staff ID and the full name as it appears on the staff list are both required.');
      return;
    }
    setBusy('provision');
    try {
      const result = await provisionAccount({
        id: form.id.trim(),
        name: form.name.trim(),
        role: form.role,
        ward: form.ward.trim() || undefined,
        department: form.department.trim() || undefined,
        ssoSubject: form.ssoSubject.trim() || undefined,
      });
      setIssued({ account: result.account, pin: result.issuedPin, reason: 'provisioned' });
      setForm({ id: '', name: '', role: 'nurse', ward: '', department: '', ssoSubject: '' });
      setFormOpen(false);
      await refresh();
    } catch (err) {
      setFormError(err.details && err.details.length ? err.details.map((d) => d.message).join(' ') : err.message);
    } finally {
      setBusy(null);
    }
  };

  const changeStatus = async (account, status) => {
    setBusy(`status:${account.id}`);
    try {
      await setAccountStatus(account.id, status);
      setNotice({
        tone: 'ok',
        title: status === 'suspended' ? `${account.name} is suspended` : `${account.name} is active again`,
        message: status === 'suspended'
          ? 'Their sessions stop working on the next request they make.'
          : 'They can sign in with their existing PIN.',
      });
      await refresh();
    } catch (err) {
      setNotice({ tone: 'danger', title: 'That did not go through', message: err.message });
    } finally {
      setBusy(null);
    }
  };

  const reissue = async (account) => {
    setBusy(`pin:${account.id}`);
    try {
      const result = await reissuePin(account.id);
      setIssued({ account: result.account, pin: result.issuedPin, reason: 'reissued' });
      await refresh();
    } catch (err) {
      setNotice({ tone: 'danger', title: 'That did not go through', message: err.message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScreenFrame
      title="Staff access"
      subtitle={user ? `${counts.active} active of ${counts.total} accounts` : undefined}
      icon={<BadgeIcon size={30} tint={colors.steel} />}
      onRefresh={refresh}
      refreshing={loading}
    >
      {notice ? (
        <Banner
          tone={notice.tone === 'ok' ? 'primary' : 'danger'}
          title={notice.title}
          message={notice.message}
        />
      ) : null}

      {issued ? (
        <Card accent={colors.warn} style={{ gap: space.sm }}>
          <PanelHeader
            title={issued.reason === 'reissued' ? 'PIN reissued' : `${issued.account.name} can now sign in`}
            subtitle="Shown once. Hand it over in person and ask them to change it."
            icon={<ShieldIcon size={26} tint={colors.warn} />}
          />
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: alpha(colors.warn, 0.12),
              borderRadius: 12,
              paddingHorizontal: space.lg,
              paddingVertical: space.md,
            }}
          >
            <T variant="bodyStrong">{issued.account.id}</T>
            <T variant="title" style={{ letterSpacing: 6, color: colors.warn }}>{issued.pin}</T>
          </View>
          <MedButton label="Done" variant="quiet" onPress={() => setIssued(null)} />
        </Card>
      ) : null}

      <Card style={{ gap: space.md }} accent={colors.primary}>
        <PanelHeader
          title="Provision an account"
          subtitle="The only way an account comes into existence"
          icon={<GloveIcon size={28} tint={colors.primary} />}
          right={
            <MedButton
              label={formOpen ? 'Close' : 'New'}
              variant={formOpen ? 'quiet' : 'ghost'}
              onPress={() => { setFormOpen((value) => !value); setFormError(null); }}
            />
          }
        />

        {formOpen ? (
          <>
            <T variant="label" tone="dim">
              Use the identity on the hospital staff list. The role you pick here is the whole of what this person will be
              able to do, and every account you create is written to the audit trail under your name.
            </T>

            <Field
              label="Staff ID"
              value={form.id}
              onChangeText={update('id')}
              placeholder="NUR7788"
              autoCapitalize="characters"
              maxLength={32}
              hint="Letters, digits and hyphens, as printed on their badge."
            />
            <Field
              label="Full name"
              value={form.name}
              onChangeText={update('name')}
              placeholder="Nadia Karim"
              autoCapitalize="words"
              maxLength={80}
            />

            <View style={{ gap: 6 }}>
              <T variant="label" tone="dim">Role</T>
              <ChoiceRow options={ROLE_OPTIONS} value={form.role} onChange={update('role')} />
            </View>

            {form.role === 'nurse' ? (
              <Field
                label="Ward"
                value={form.ward}
                onChangeText={update('ward')}
                placeholder="IPD-7B"
                autoCapitalize="characters"
                maxLength={24}
                hint="A nurse only sees indents for the ward they are assigned to."
              />
            ) : null}

            <Field
              label="Department"
              value={form.department}
              onChangeText={update('department')}
              placeholder="Inpatient pharmacy"
              autoCapitalize="words"
              maxLength={80}
            />

            <Field
              label="Single sign-on account (optional)"
              value={form.ssoSubject}
              onChangeText={update('ssoSubject')}
              placeholder="nadia.karim@hospital.example"
              keyboardType="email-address"
              maxLength={120}
              hint="Fill this in where the facility runs single sign-on, so their hospital login is accepted."
            />

            {formError ? <Banner tone="danger" title="Check the form" message={formError} /> : null}

            <MedButton label="Create the account" busy={busy === 'provision'} onPress={provision} full />
          </>
        ) : (
          <View style={{ flexDirection: 'row', gap: space.lg }}>
            <View style={{ flex: 1 }}>
              <T variant="micro" tone="faint">Accounts</T>
              <T variant="title">{counts.total}</T>
            </View>
            <View style={{ flex: 1 }}>
              <T variant="micro" tone="faint">Active</T>
              <T variant="title" tone="primary">{counts.active}</T>
            </View>
            <View style={{ flex: 1 }}>
              <T variant="micro" tone="faint">Starter PIN unchanged</T>
              <T variant="title" tone={counts.pending ? 'warn' : 'primary'}>{counts.pending}</T>
            </View>
          </View>
        )}
      </Card>

      <ChoiceRow options={FILTERS} value={filter} onChange={setFilter} />

      {visible.length === 0 ? (
        <EmptyState
          icon={<BadgeIcon size={44} />}
          title="No accounts here"
          message="Change the filter, or provision the first account for this group."
        />
      ) : (
        <Card padded={false} style={{ paddingHorizontal: space.lg }}>
          {visible.map((account, index) => (
            <View key={account.id}>
              {index > 0 ? <Divider /> : null}
              <AccountRow
                account={account}
                busy={busy}
                onSuspend={(item) => changeStatus(item, 'suspended')}
                onReinstate={(item) => changeStatus(item, 'active')}
                onReissue={reissue}
              />
            </View>
          ))}
        </Card>
      )}

      <T variant="micro" tone="faint" style={{ textAlign: 'center' }}>
        Accounts are never created by anyone signing in. Suspending one takes effect on that person{"'"}s next request.
      </T>
    </ScreenFrame>
  );
}
