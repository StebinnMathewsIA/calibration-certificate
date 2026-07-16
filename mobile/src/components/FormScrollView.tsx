import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { styles } from './ui';

/**
 * Scrollable form container that keeps the focused input (and the buttons
 * below it) above the on-screen keyboard. Wraps a ScrollView in a
 * KeyboardAvoidingView sized to the keyboard, offset by the navigation header
 * so the maths is correct on notched devices.
 */
export function FormScrollView({ children }: { children: React.ReactNode }) {
  const headerHeight = useHeaderHeight();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={headerHeight}
    >
      <ScrollView
        style={styles.screen}
        contentContainerStyle={{ paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
