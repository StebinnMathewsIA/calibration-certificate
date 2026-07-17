import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Button, colors } from './ui';

const WIDTH = 320;
const HEIGHT = 160;

/**
 * Touchscreen signature capture for the CLIENT acknowledgement. The customer
 * has no credentials — they draw here; the strokes are embedded into the
 * certificate PDF (as inline SVG) BEFORE the technician's cryptographic
 * signature, so tampering with the drawing breaks the VO signature.
 *
 * `onChange` yields a standalone SVG string (or '' when cleared).
 */
export function SignaturePad({ onChange }: { onChange: (svg: string) => void }) {
  // Committed strokes + the one currently being drawn. The ref mirrors the
  // state so event handlers (memoised PanResponder) always see the latest
  // strokes WITHOUT reading them inside a setState updater — calling the
  // parent's onChange from an updater fires a state update while React is
  // rendering this component ("Cannot update a component (SignatureScreen)
  // while rendering a different component (SignaturePad)") and the update
  // can be dropped, losing strokes (issue #21).
  const [, setStrokes] = useState<string[]>([]);
  const strokesRef = useRef<string[]>([]);
  const [live, setLive] = useState<string>('');
  const liveRef = useRef<string>('');

  const emit = (all: string[]) => {
    if (all.length === 0) return onChange('');
    const body = all
      .map(
        (d) =>
          `<path d="${d}" fill="none" stroke="#111" stroke-width="2.5" ` +
          `stroke-linecap="round" stroke-linejoin="round"/>`,
      )
      .join('');
    onChange(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" ` +
        `width="${WIDTH}" height="${HEIGHT}">${body}</svg>`,
    );
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          liveRef.current = `M ${locationX.toFixed(1)} ${locationY.toFixed(1)}`;
          setLive(liveRef.current);
        },
        onPanResponderMove: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          liveRef.current += ` L ${locationX.toFixed(1)} ${locationY.toFixed(1)}`;
          setLive(liveRef.current);
        },
        onPanResponderRelease: () => {
          const finished = liveRef.current;
          liveRef.current = '';
          setLive('');
          if (!finished) return;
          strokesRef.current = [...strokesRef.current, finished];
          setStrokes(strokesRef.current);
          emit(strokesRef.current);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const clear = () => {
    liveRef.current = '';
    setLive('');
    strokesRef.current = [];
    setStrokes([]);
    emit([]);
  };

  const rendered = live ? [...strokesRef.current, live] : strokesRef.current;

  return (
    <View>
      <View style={styles.pad} {...responder.panHandlers}>
        <Svg width={WIDTH} height={HEIGHT}>
          {rendered.map((d, i) => (
            <Path
              key={i}
              d={d}
              fill="none"
              stroke={colors.ink}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </Svg>
      </View>
      <Button title="Clear signature" kind="secondary" onPress={clear} />
    </View>
  );
}

const styles = StyleSheet.create({
  pad: {
    width: WIDTH,
    height: HEIGHT,
    alignSelf: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
  },
});
