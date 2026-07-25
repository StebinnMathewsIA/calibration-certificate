/**
 * Full-screen photo capture (#48) — used for proving-measure photos. Saves
 * the shot into the app's document directory and returns the file URI.
 */
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import React, { useRef, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { colors } from './ui';

export function CameraCaptureModal({
  visible,
  title,
  fileStem,
  onClose,
  onCaptured,
}: {
  visible: boolean;
  title: string;
  /** Basename for the stored photo, e.g. "measure-200L-<subject>". */
  fileStem: string;
  onClose: () => void;
  onCaptured: (uri: string) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);

  if (!visible) return null;

  const capture = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.5 });
      if (!photo?.uri) return;
      const dir = `${FileSystem.documentDirectory}measure-photos/`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
      const dest = `${dir}${fileStem}.jpg`;
      await FileSystem.copyAsync({ from: photo.uri, to: dest });
      onCaptured(dest);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {permission?.granted ? (
          <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <Text style={{ color: '#fff', textAlign: 'center', marginBottom: 16 }}>
              Camera access is needed to photograph your proving measures.
            </Text>
            <Pressable onPress={requestPermission}>
              <Text style={{ color: '#9ec5ff', fontSize: 16 }}>Allow camera</Text>
            </Pressable>
          </View>
        )}
        <View
          style={{
            position: 'absolute',
            top: 54,
            left: 16,
            right: 16,
            flexDirection: 'row',
            justifyContent: 'space-between',
          }}
        >
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={{ color: '#fff', fontSize: 16 }}>Cancel</Text>
          </Pressable>
        </View>
        {permission?.granted ? (
          <View style={{ position: 'absolute', bottom: 48, left: 0, right: 0, alignItems: 'center' }}>
            <Pressable
              onPress={capture}
              accessibilityRole="button"
              accessibilityLabel="Take photo"
              style={{
                width: 72,
                height: 72,
                borderRadius: 36,
                backgroundColor: busy ? colors.muted : '#fff',
                borderWidth: 4,
                borderColor: colors.green,
              }}
            />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
