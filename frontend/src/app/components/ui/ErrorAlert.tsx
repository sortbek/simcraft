/** Negative callout box, shared with banners that add their own content. */
export const ERROR_ALERT =
  'rounded-[8px] border border-negative/25 bg-negative/[0.08] px-4 py-3 text-sm text-negative';

export default function ErrorAlert({ message }: { message: string }) {
  if (!message) return null;
  return <div className={ERROR_ALERT}>{message}</div>;
}
