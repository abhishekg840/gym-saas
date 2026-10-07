import { POST as reportPost } from '@/app/api/hardware/fingerprint/report/route';

/**
 * POST /api/hardware/report-enrollment — compatibility alias.
 *
 * The firmware contract for enrollment progress and success reports has been
 * spelled both ways. The real handler lives at
 * /api/hardware/fingerprint/report; boards and test harnesses instructed to
 * POST /api/hardware/report-enrollment were receiving a 404 for every
 * progress stage and for the final success payload, which left the desk's
 * enrollment stepper frozen on "Connecting to terminal…". Both paths now run
 * the identical handler — there is exactly one place where reports land.
 */
export async function POST(request: Request) {
  return reportPost(request);
}