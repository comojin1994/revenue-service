import { IngestForm } from "@/components/IngestForm";

// The ingest server action uses child_process/fs — keep this route on Node.
export const runtime = "nodejs";

export default function IngestPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <IngestForm />
    </main>
  );
}
