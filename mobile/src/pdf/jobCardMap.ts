/** Bundle to printable document, shared by the job card screen and the
 * work order detail's signed-PDF row (#159). Tasks ride the bundle since
 * #152; the template prints its task page only when real tasks exist. */
import { JobCardBundle } from '../api/client';
import { JobCard } from './jobCardHtml';

export const toJobCard = (b: JobCardBundle): JobCard => ({
  workOrderCode: b.workOrderCode ?? '',
  siteCode: b.document.siteCode ?? '',
  siteName: b.siteName ?? '',
  siteAddress: b.document.siteAddress,
  sitePhone: b.document.sitePhone,
  oilCompany: b.document.oilCompany,
  assetCode: b.document.assetCode,
  assetDescription: b.document.assetDescription,
  importance: b.document.importance,
  requester: b.document.customerName,
  workRequired: b.workRequired,
  workPerformed: b.jobCard?.workPerformed ?? null,
  visits: b.jobCard?.visits ?? [],
  lines: b.document.lines,
  tasks: (b.tasks ?? []).map((t) => ({
    description: t.description ?? '',
    done: t.done,
    passed: t.passed,
    completedOn: t.completedOn,
  })),
  technicianName: b.document.technicianName ?? '',
  clientName: b.jobCard?.clientName ?? null,
  clientContact: b.jobCard?.clientContact ?? null,
  signedAt: b.jobCard?.signedAt ?? null,
});
