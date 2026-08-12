/**
 * Error boundary for the reporting tree (#148).
 *
 * The tree is the newest and most recursive thing on two screens. If it
 * ever fails to render, the failure must be a message in its place, with
 * the rest of the screen and the tab bar alive, and the error must land
 * in the crash journal so it can be diagnosed rather than guessed at.
 */
import React from 'react';
import { Text } from 'react-native';
import { writeCache } from '../db/cache';
import { colors } from './ui';

interface State {
  failed: boolean;
}

export class TreeBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    try {
      writeCache('crash:last', {
        message: `Tree render failed: ${error.name}: ${error.message}`,
        stack: error.stack ?? null,
        isFatal: false,
        at: new Date().toISOString(),
      });
    } catch {
      // The boundary must never make a failure worse.
    }
  }

  render(): React.ReactNode {
    if (this.state.failed) {
      return (
        <Text style={{ color: colors.red, fontSize: 12 }}>
          The team tree could not be drawn. The error has been recorded for an
          administrator; the rest of the app is unaffected.
        </Text>
      );
    }
    return this.props.children;
  }
}
