import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import { normalizePhone } from '../../src/services/firebase';
import { UserRole } from '../../src/types';

type Step = 'phone' | 'setup';

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'driver', label: 'Driver' },
  { value: 'salesman', label: 'Salesman' },
];

export default function LoginScreen() {
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>('driver');
  const [loading, setLoading] = useState(false);

  const { user, appUser, isReady, loginWithPhone, registerWithPhone, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isReady) return;

    // Firebase Auth account exists but no Firestore doc — orphaned state from a
    // previous failed registration. Only clean up when not mid-registration (loading).
    if (user && !appUser && !loading) {
      logout();
      return;
    }

    if (!user) return;

    const r = appUser?.role;
    if (r === 'admin') router.replace('/(admin)');
    else if (r === 'driver') router.replace('/(driver)');
    else if (r === 'salesman') router.replace('/(salesman)');
  }, [isReady, user, appUser, loading]);

  const handleContinue = async () => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length !== 10) {
      Alert.alert('Invalid Number', 'Please enter a valid 10-digit mobile number.');
      return;
    }
    const normalized = normalizePhone(digits);
    setLoading(true);
    try {
      const result = await loginWithPhone(normalized);
      if (result === 'new_user') {
        setStep('setup');
      }
      // if 'logged_in', useEffect handles the redirect
    } catch (error: any) {
      Alert.alert('Error', 'Could not sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!name.trim()) {
      Alert.alert('Required', 'Please enter your name.');
      return;
    }
    const normalized = normalizePhone(phone.replace(/\D/g, ''));
    setLoading(true);
    try {
      await registerWithPhone(normalized, name.trim(), role);
      // onAuthStateChanged fires → useEffect redirects
    } catch (error: any) {
      Alert.alert('Error', 'Could not create account. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Tracker</Text>

        {step === 'phone' ? (
          <>
            <Text style={styles.subtitle}>Enter your mobile number</Text>

            <View style={styles.form}>
              <View style={styles.phoneRow}>
                <View style={styles.countryCode}>
                  <Text style={styles.countryCodeText}>+91</Text>
                </View>
                <TextInput
                  style={styles.phoneInput}
                  placeholder="10-digit number"
                  placeholderTextColor="#999"
                  value={phone}
                  onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))}
                  keyboardType="number-pad"
                  maxLength={10}
                  editable={!loading}
                  autoFocus
                />
              </View>

              <TouchableOpacity
                style={[styles.button, (loading || phone.replace(/\D/g, '').length !== 10) && styles.buttonDisabled]}
                onPress={handleContinue}
                disabled={loading || phone.replace(/\D/g, '').length !== 10}
              >
                {loading ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.buttonText}>Continue</Text>
                )}
              </TouchableOpacity>

              <View style={styles.dividerRow}>
                <View style={styles.divider} />
                <Text style={styles.dividerText}>CUSTOMERS</Text>
                <View style={styles.divider} />
              </View>

              <TouchableOpacity
                style={styles.customerButton}
                onPress={() => router.push('/auth/customer-login')}
              >
                <Text style={styles.customerButtonText}>Track My Delivery</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.subtitle}>Set up your account</Text>
            <Text style={styles.phoneDisplay}>+91 {phone}</Text>

            <View style={styles.form}>
              <TextInput
                style={styles.input}
                placeholder="Your full name"
                placeholderTextColor="#999"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                editable={!loading}
                autoFocus
              />

              <Text style={styles.roleLabel}>I am a</Text>
              <View style={styles.roleRow}>
                {ROLES.map((r) => (
                  <TouchableOpacity
                    key={r.value}
                    style={[styles.roleBtn, role === r.value && styles.roleBtnActive]}
                    onPress={() => setRole(r.value)}
                    disabled={loading}
                  >
                    <Text style={[styles.roleBtnText, role === r.value && styles.roleBtnTextActive]}>
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleRegister}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.buttonText}>Create Account</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.backBtn}
                onPress={() => { setStep('phone'); setName(''); }}
                disabled={loading}
              >
                <Text style={styles.backBtnText}>Back</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  title: { fontSize: 36, fontWeight: '700', color: '#007AFF', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#666', textAlign: 'center', marginBottom: 8 },
  phoneDisplay: { fontSize: 18, fontWeight: '600', color: '#333', textAlign: 'center', marginBottom: 32 },
  form: { gap: 16 },
  phoneRow: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    overflow: 'hidden',
  },
  countryCode: {
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: '#E0E0E0',
    backgroundColor: '#F5F5F5',
  },
  countryCodeText: { fontSize: 16, color: '#333', fontWeight: '600' },
  phoneInput: { flex: 1, padding: 16, fontSize: 18, color: '#333', letterSpacing: 1 },
  input: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    color: '#333',
  },
  button: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#FFF', fontSize: 18, fontWeight: '600' },
  roleLabel: { fontSize: 14, color: '#666', fontWeight: '500' },
  roleRow: { flexDirection: 'row', gap: 10 },
  roleBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#D0D0D0',
    alignItems: 'center',
    backgroundColor: '#FFF',
  },
  roleBtnActive: { borderColor: '#007AFF', backgroundColor: '#EAF3FF' },
  roleBtnText: { fontSize: 14, fontWeight: '600', color: '#666' },
  roleBtnTextActive: { color: '#007AFF' },
  backBtn: { alignItems: 'center', padding: 12 },
  backBtnText: { color: '#007AFF', fontSize: 15, fontWeight: '500' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  divider: { flex: 1, height: 1, backgroundColor: '#D8D8D8' },
  dividerText: { color: '#777', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  customerButton: {
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#007AFF',
    backgroundColor: '#FFF',
  },
  customerButtonText: { color: '#007AFF', fontSize: 17, fontWeight: '600' },
});
