import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useEffect, useRef } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { colors } from './ui';

/**
 * Full-screen barcode/QR scanner modal for serial-number entry — fires
 * onScanned once with the first code seen (QR plus the 1D symbologies common
 * on dispenser data plates).
 */
export function BarcodeScannerModal({
  visible,
  title,
  onClose,
  onScanned,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  onScanned: (data: string) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const firedRef = useRef(false);

  // Re-arm the one-shot each time the modal opens.
  useEffect(() => {
    if (visible) firedRef.current = false;
  }, [visible]);

  if (!visible) return null;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {permission?.granted ? (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{
              barcodeTypes: [
                'qr',
                'code128',
                'code39',
                'code93',
                'ean13',
                'ean8',
                'upc_a',
                'upc_e',
                'itf14',
                'datamatrix',
              ],
            }}
            onBarcodeScanned={({ data }) => {
              if (firedRef.current || !data) return;
              firedRef.current = true;
              onScanned(data);
            }}
          />
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
            <Text style={{ color: '#fff', textAlign: 'center', marginBottom: 16 }}>
              Camera access is needed to scan the serial number.
            </Text>
            <Pressable
              onPress={requestPermission}
              style={{
                backgroundColor: colors.green,
                borderRadius: 8,
                paddingVertical: 12,
                paddingHorizontal: 24,
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '600' }}>Allow camera</Text>
            </Pressable>
          </View>
        )}
        <View style={{ position: 'absolute', top: 48, left: 0, right: 0, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>{title}</Text>
        </View>
        <View style={{ position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center' }}>
          <Pressable onPress={onClose} style={{ padding: 14 }}>
            <Text style={{ color: '#fff', fontSize: 16 }}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
