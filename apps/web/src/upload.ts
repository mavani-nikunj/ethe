import { ApiError, type UploadProgress } from './api';
import { formatBytes } from './imageShrink';

/** Same ceiling as the API and nginx for thesis uploads. */
export const THESIS_MAX_BYTES = 5 * 1024 * 1024 * 1024;

/** Problem with a picked thesis file, or null. */
export function thesisFileProblem(file: File): string | null {
  if (!file.size) return 'This file could not be read. Please choose the file again.';
  if (file.size > THESIS_MAX_BYTES) return `This file is ${formatBytes(file.size)}. The thesis file must be 5 GB or smaller.`;
  return null;
}

/** Friendly text for a failed upload; validation messages from the server are shown as they are. */
export function uploadFailureMessage(err: any): string {
  const status = err instanceof ApiError ? err.status : -1;
  const ref = err instanceof ApiError && err.ref ? ` Reference: ${err.ref}` : '';
  if (status === 0) return 'Could not reach the server. Check your internet connection and try again.';
  if (status === 413) return 'The file is larger than the server allows. Thesis files must be 5 GB or smaller.';
  if (status === 500 || status === 501) return `Something went wrong while saving. Please try again.${ref}`;
  if (status >= 502) return `The server is temporarily unavailable. Please try again in a few minutes.${ref}`;
  return err?.message || 'Upload failed. Please try again.';
}

export function progressLabel(p: UploadProgress) {
  return `Uploading… ${p.percent}% (${formatBytes(p.loaded)} of ${formatBytes(p.total)})`;
}
