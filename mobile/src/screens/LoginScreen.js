import React, { useEffect, useRef, useState } from 'react';
import { Animated, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { useAuth } from '../state/AuthContext';
import { Banner, Card, Divider, Field, MedButton, T, Touchable } from '../components/Primitives';
import { ShieldIcon, VialIcon } from '../components/MedicalIcons';

/**
 * The one piece of motion that is not answering a press: the sign-in panel
 * rises into place as the screen arrives, once per mount.
 */
function useArrival() {
  const { reduceMotion } = useTheme();
  const rise = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) return undefined;
    const animation = Animated.timing(rise, { toValue: 1, duration: 650, useNativeDriver: true });
    animation.start();
    return () => {
      animation.stop();
      rise.setValue(1);
    };
  }, [rise, reduceMotion]);

  return {
    opacity: rise,
    transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
  };
}

function Brand({ facility }) {
  const { colors, space, radius, alpha } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: space.md, paddingTop: space.xl, paddingBottom: space.lg }}>
      <View
        style={{
          width: 84,
          height: 84,
          borderRadius: radius.xl,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: alpha(colors.surface, 0.9),
          borderWidth: 1,
          borderColor: alpha(colors.primary, 0.45),
          shadowColor: colors.primary,
          shadowOpacity: 0.35,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 6 },
          elevation: 6,
        }}
      >
        <VialIcon size={52} tint={colors.cold} fill={0.65} />
      </View>
      <View style={{ alignItems: 'center', gap: 6 }}>
        <T variant="display" style={{ textAlign: 'center' }}>ColdChain Rx</T>
        {facility ? (
          <T variant="label" tone="primary" style={{ fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' }}>
            {facility.name}
          </T>
        ) : null}
        <T variant="body" tone="dim" style={{ textAlign: 'center', maxWidth: 340 }}>
          Refrigerated medicines from the pharmacy fridge to the bedside, checked against the prescription.
        </T>
      </View>
    </View>
  );
}

export function LoginScreen() {
  const { colors, space, gutter, contentWidth } = useTheme();
  const insets = useSafeAreaInsets();
  const arrival = useArrival();
  const {
    signIn, signingIn, error, clearError, baseUrl, setBaseUrl,
    access, accessError, loadAccess, startSingleSignOn,
  } = useAuth();

  const [staffId, setStaffId] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [draftUrl, setDraftUrl] = useState(baseUrl);

  useEffect(() => setDraftUrl(baseUrl), [baseUrl]);

  const submit = async () => {
    try {
      await signIn(staffId, pin);
    } catch {
      // The reason is already on screen, from the auth context.
    }
  };

  const sso = access ? access.singleSignOn : null;
  const facility = access ? access.facility : null;
  const support = access ? access.support : null;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          padding: gutter,
          paddingTop: insets.top + space.lg,
          paddingBottom: insets.bottom + space.xxl,
          gap: space.lg,
          width: '100%',
          maxWidth: contentWidth,
          alignSelf: 'center',
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Brand facility={facility} />

        <Animated.View style={[{ gap: space.lg }, arrival]}>
          <Card style={{ gap: space.md, padding: space.xl }}>
            <View style={{ gap: 2 }}>
              <T variant="title">Sign in</T>
              <T variant="label" tone="dim">Use the staff ID and PIN issued by hospital IT.</T>
            </View>

            <Field
              label="Staff ID"
              value={staffId}
              onChangeText={(value) => { setStaffId(value); if (error) clearError(); }}
              placeholder="As printed on your hospital badge"
              autoCapitalize="characters"
              maxLength={32}
            />

            <Field
              label="PIN"
              value={pin}
              onChangeText={(value) => { setPin(value); if (error) clearError(); }}
              placeholder="4 digits"
              keyboardType="number-pad"
              secure={!showPin}
              maxLength={12}
              returnKeyType="go"
              onSubmitEditing={submit}
              right={(
                <Touchable
                  accessibilityRole="button"
                  accessibilityLabel={showPin ? 'Hide PIN' : 'Show PIN'}
                  onPress={() => setShowPin((value) => !value)}
                  hitSlop={10}
                  style={{ paddingVertical: 6, paddingHorizontal: 4 }}
                >
                  <T variant="label" tone="primary" style={{ fontWeight: '700' }}>{showPin ? 'Hide' : 'Show'}</T>
                </Touchable>
              )}
            />

            {error ? <Banner tone="danger" title="Cannot sign in" message={error} /> : null}

            <MedButton label="Sign in" onPress={submit} busy={signingIn} disabled={!staffId || !pin} full />

            {sso && sso.configured ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <Divider style={{ flex: 1 }} />
                  <T variant="micro" tone="faint">OR</T>
                  <Divider style={{ flex: 1 }} />
                </View>
                <MedButton
                  label={`Continue with ${sso.displayName}`}
                  variant="quiet"
                  full
                  icon={<ShieldIcon size={18} tint={colors.cold} />}
                  onPress={startSingleSignOn}
                />
              </>
            ) : null}
          </Card>

          {/* Only shown when the service cannot be reached, so staff can fix it. */}
          {accessError ? (
            <Card style={{ gap: space.md }} accent={colors.danger}>
              <View style={{ gap: 2 }}>
                <T variant="subtitle">Cannot reach the pharmacy service</T>
                <T variant="label" tone="dim">Check the Wi-Fi connection, or enter the address hospital IT gave you.</T>
              </View>
              <Field
                label="Address"
                value={draftUrl}
                onChangeText={setDraftUrl}
                placeholder="https://coldchain.hospital.example"
                keyboardType="url"
              />
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <MedButton
                  label="Save"
                  variant="ghost"
                  style={{ flex: 1 }}
                  disabled={!draftUrl || draftUrl === baseUrl}
                  onPress={() => setBaseUrl(draftUrl)}
                />
                <MedButton label="Retry" variant="quiet" style={{ flex: 1 }} onPress={loadAccess} />
              </View>
            </Card>
          ) : null}

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, justifyContent: 'center' }}>
            <ShieldIcon size={16} tint={colors.textDim} />
            <T variant="micro" tone="dim" style={{ textAlign: 'center' }}>
              {support ? `Need help signing in? ${support.desk} · ${support.phone}` : 'Accounts are issued by hospital IT.'}
            </T>
          </View>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
