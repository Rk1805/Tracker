import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '../src/context/AuthContext';
import 'react-native-reanimated';

export const unstable_settings = {
  initialRouteName: 'index',
};

export default function RootLayout() {
  return (
    <AuthProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="auth/login" />
        <Stack.Screen name="auth/customer-login" />
        <Stack.Screen name="(admin)" />
        <Stack.Screen name="(driver)" />
        <Stack.Screen name="(salesman)" />
        <Stack.Screen name="(customer)" />
      </Stack>
      <StatusBar style="auto" />
    </AuthProvider>
  );
}
