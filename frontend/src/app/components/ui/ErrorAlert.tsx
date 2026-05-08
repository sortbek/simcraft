export default function ErrorAlert({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="rounded-lg bg-error-container/10 px-4 py-3 text-sm text-error">{message}</div>
  );
}
