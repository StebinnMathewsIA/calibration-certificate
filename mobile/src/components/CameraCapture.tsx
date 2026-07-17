import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useRef, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { colors } from './ui';

/**
 * Full-screen camera modal used two ways:
 * - mode="barcode": fires onBarcode once with the first code seen (serial
 *   number scan — QR and the 1D symbologies common on dispenser plates);
 * - mode="photo": shutter button, fires onPhoto with the capture's temp URI.
 */
export function CameraCaptureModal({
  mode,
  visible,
  title,
  onClose,
  onBarcode,
  onPhoto,
}: {
  mode: 'barcode' | 'photo';
  visible: boolean;
  title: string;
  onClose: () => void;
  onBarcode?: (data: string) => void;
  onPhoto?: (uri: string) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const camRef = useRef<CameraView>(null);
  const firedRef = useRef(false);
  const [busy, setBusy] = useState(false);

  if (!visible) return null;

  const take = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const photo = await camRef.current?.takePictureAsync({ quality: 0.7 });
      if (photo?.uri) onPhoto?.(photo.uri);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {permission?.granted ? (
          <CameraView
            ref={camRef}
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={
              mode === 'barcode'
                ? {
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
                  }
                : undefined
            }
            onBarcodeScanned={
              mode === 'barcode'
                ? ({ data }) => {
                    if (firedRef.current || !data) return;
                    firedRef.current = true;
                    onBarcode?.(data);
                  }
                : undefined
            }
          />
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
            <Text style={{ color: '#fff', textAlign: 'center', marginBottom: 16 }}>
              Camera access is needed to {mode === 'barcode' ? 'scan the serial number' : 'take photos'}.
            </Text>
            <Pressable
              onPress={requestPermission}
              style={{ backgroundColor: colors.green, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 24 }}
            >
              <Text style={{ color: '#fff', fontWeight: '600' }}>Allow camera</Text>
            </Pressable>
          </View>
        )}

        <View
          style={{
            position: 'absolute',
            top: 48,
            left: 0,
            right: 0,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>{title}</Text>
        </View>

        <View
          style={{
            position: 'absolute',
            bottom: 40,
            left: 0,
            right: 0,
            flexDirection: 'row',
            justifyContent: 'space-evenly',
            alignItems: 'center',
          }}
        >
          <Pressable onPress={onClose} style={{ padding: 14 }}>
            <Text style={{ color: '#fff', fontSize: 16 }}>Cancel</Text>
          </Pressable>
          {mode === 'photo' && permission?.granted ? (
            <Pressable
              onPress={take}
              disabled={busy}
              style={{
                width: 68,
                height: 68,
                borderRadius: 34,
                borderWidth: 5,
                borderColor: '#fff',
                backgroundColor: busy ? '#999' : '#fff',
              }}
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
