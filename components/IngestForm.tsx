"use client";

import { useState } from "react";
import { useFormState } from "react-dom";

import { submitYoutubeUrl, type FormState } from "@/app/actions/ingest";
import { SubmitButton } from "@/components/SubmitButton";

const initialState: FormState = { status: "idle" };

function formatDuration(seconds?: number): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function IngestForm() {
  const [state, formAction] = useFormState(submitYoutubeUrl, initialState);
  const [clientError, setClientError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    const input = e.currentTarget.elements.namedItem(
      "youtubeUrl",
    ) as HTMLInputElement | null;
    const value = input?.value.trim() ?? "";
    // Client-side first-pass validation (server remains authoritative).
    if (value === "" || !/^https?:\/\//i.test(value)) {
      e.preventDefault();
      setClientError("올바른 YouTube URL을 입력해 주세요.");
      return;
    }
    setClientError(null);
  }

  const errorMessage =
    clientError ?? (state.status === "error" ? state.message : null);
  const duration =
    state.status === "success" ? formatDuration(state.durationSeconds) : null;

  return (
    <div className="mx-auto max-w-xl rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-bold text-gray-900">YouTube 영상 가져오기</h1>
      <p className="mt-1 text-sm text-gray-500">
        URL을 붙여넣으면 다운로드 후 처리 job을 생성합니다.
      </p>

      <form action={formAction} onSubmit={handleSubmit} className="mt-5 space-y-3">
        <div>
          <label htmlFor="youtubeUrl" className="sr-only">
            YouTube URL
          </label>
          <input
            id="youtubeUrl"
            name="youtubeUrl"
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://youtube.com/watch?v=..."
            aria-label="YouTube URL"
            aria-invalid={errorMessage ? "true" : undefined}
            aria-describedby={errorMessage ? "ingest-error" : undefined}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            onChange={() => clientError && setClientError(null)}
          />
        </div>
        <SubmitButton />
      </form>

      <div className="mt-4">
        {errorMessage ? (
          <div
            id="ingest-error"
            role="alert"
            aria-live="assertive"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {errorMessage}
          </div>
        ) : null}

        {state.status === "success" ? (
          <div
            role="status"
            aria-live="polite"
            className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"
          >
            <p className="font-semibold">
              Job 생성됨 (#{state.jobId.slice(0, 8)})
            </p>
            {state.title ? (
              <p className="mt-1 text-green-700">{state.title}</p>
            ) : null}
            {duration ? (
              <p className="mt-0.5 text-green-700">길이: {duration}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
