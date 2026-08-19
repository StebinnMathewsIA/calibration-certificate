/** In-app job card preview (#191): the exact template the PDF is built
 * from, rendered in a WebView with signatures and the Incomplete
 * watermark, pinch-zoomable, with the share flow underneath. The route
 * name returns from #162's removal, now as a viewer rather than an
 * editor: the job card is edited on the work order page. */
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { WebView } from 'react-native-webview';
import { getJobCard, JobCardBundle } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { Button, colors } from '../../src/components/ui';
import { jobCardHtml } from '../../src/pdf/jobCardHtml';
import { toJobCard } from '../../src/pdf/jobCardMap';
import { renderJobCardPdf } from '../../src/pdf/renderPdf';

export default function JobCardPreviewScreen() {
  const { id, wm } = useLocalSearchParams<{ id: string; wm?: string }>();
  const { accessToken } = useAuth();
  const [bundle, setBundle] = useState<JobCardBundle | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getJobCard(accessToken, String(id), { onFresh: setBundle })
        .then(setBundle)
        .catch(() => {});
    }, [accessToken, id]),
  );

  const options = {
    customerSignatureSvg: bundle?.jobCard?.clientSignature ?? undefined,
    technicianSignatureSvg: bundle?.jobCard?.techSignature ?? undefined,
    watermark: wm ? 'Incomplete' : undefined,
  };

  // The template is A4 print CSS (~794 px wide at 96 dpi); the viewport
  // meta scales it to the phone width and leaves pinch zoom on.
  const html = bundle
    ? jobCardHtml(toJobCard(bundle), options).replace(
        '<head>',
        '<head><meta name="viewport" content="width=820, user-scalable=yes">',
      )
    : null;

  const share = async () => {
    if (!bundle) return;
    setBusy(true);
    try {
      const { uri } = await renderJobCardPdf(toJobCard(bundle), options);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
      } else {
        Alert.alert('Job card ready', uri);
      }
    } catch (err) {
      Alert.alert('Could not build the job card', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {html ? (
        <WebView
          source={{ html }}
          originWhitelist={['about:blank']}
          setSupportMultipleWindows={false}
          style={{ flex: 1, backgroundColor: '#fff' }}
        />
      ) : null}
      <View style={{ padding: 12 }}>
        <Button title="Share PDF" onPress={() => void share()} busy={busy} disabled={!bundle} />
      </View>
    </View>
  );
}
