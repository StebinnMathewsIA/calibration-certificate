/** Discarding an unissued certificate (#182): the repo row goes, then the
 * rendered PDFs on disk. States that may be discarded are enforced in the
 * repo (DRAFT, READY_TO_SIGN, QUEUED_FOR_SIGNING); issued documents are
 * retention items and never deletable from the app. */
import * as FileSystem from 'expo-file-system/legacy';
import * as repo from '../db/certificateRepo';

export async function discardCertificate(id: string): Promise<void> {
  const rec = repo.discard(id);
  for (const uri of [rec.pdfUri, rec.signedPdfUri]) {
    if (uri) {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
  }
}
