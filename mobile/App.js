import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import { AuthProvider, useAuth } from './src/state/AuthContext';
import { DataProvider } from './src/state/DataContext';
import { Navigator } from './src/navigation/Navigator';
import { HospitalFloor } from './src/components/HospitalFloor';
import { LoginScreen } from './src/screens/LoginScreen';
import { IndentsScreen } from './src/screens/IndentsScreen';
import { IndentDetailScreen } from './src/screens/IndentDetailScreen';
import { RequestScreen } from './src/screens/RequestScreen';
import { AlertsScreen } from './src/screens/AlertsScreen';
import { AuditScreen } from './src/screens/AuditScreen';
import { DirectoryScreen } from './src/screens/DirectoryScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';

const TABS = {
  indents: IndentsScreen,
  alerts: AlertsScreen,
  directory: DirectoryScreen,
  audit: AuditScreen,
  settings: SettingsScreen,
};

const DETAIL = {
  indent: IndentDetailScreen,
  request: RequestScreen,
};

function Shell() {
  const { user } = useAuth();
  const { mode } = useTheme();

  return (
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      {user ? (
        <HospitalFloor>
          <DataProvider>
            <Navigator tabs={TABS} detail={DETAIL} />
          </DataProvider>
        </HospitalFloor>
      ) : (
        <HospitalFloor variant="hero">
          <LoginScreen />
        </HospitalFloor>
      )}
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
