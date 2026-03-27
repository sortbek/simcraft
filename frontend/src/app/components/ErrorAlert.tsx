export default function ErrorAlert({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
      {message}
    </div>
  );
}
