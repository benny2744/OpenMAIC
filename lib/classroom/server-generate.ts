export interface ServerGenerationProgress {
  step?: string;
  progress?: number;
  message?: string;
  scenesGenerated?: number;
  totalScenes?: number;
}

export interface ServerGenerationResult {
  classroomId: string;
  url?: string;
  scenesCount?: number;
}

interface JobResponse {
  success?: boolean;
  jobId?: string;
  status?: 'queued' | 'running' | 'succeeded' | 'failed';
  step?: string;
  progress?: number;
  message?: string;
  scenesGenerated?: number;
  totalScenes?: number;
  result?: ServerGenerationResult;
  error?: string;
  done?: boolean;
  pollIntervalMs?: number;
}

export interface ServerGenerateInput {
  requirement: string;
  pdfContent?: { text: string; images: string[] };
  enableWebSearch?: boolean;
  enableImageGeneration?: boolean;
  enableVideoGeneration?: boolean;
  enableTTS?: boolean;
  agentMode?: 'default' | 'generate';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Submit a server-side generation job and return its jobId immediately. The
 * caller can then route to a durable status page (or poll) without waiting for
 * completion — the job runs entirely on the server.
 */
export async function startServerSideGeneration(input: ServerGenerateInput): Promise<string> {
  const submit = await fetch('/api/generate-classroom', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const submitJson = (await submit.json().catch(() => ({}))) as JobResponse & { jobId?: string };
  if (!submit.ok || !submitJson.jobId) {
    throw new Error(
      (submitJson as { error?: string }).error || `Failed to start generation (${submit.status})`,
    );
  }
  return submitJson.jobId;
}

/**
 * Server-side classroom generation (#structural-fix): submits the async job to
 * /api/generate-classroom and polls until done. The entire pipeline (outlines,
 * scenes, media, TTS, persistence) runs on the server, so the browser tab can
 * be backgrounded or the machine allowed to sleep without stalling generation.
 */
export async function generateClassroomServerSide(
  input: ServerGenerateInput,
  onProgress?: (p: ServerGenerationProgress) => void,
  signal?: AbortSignal,
): Promise<ServerGenerationResult> {
  const submit = await fetch('/api/generate-classroom', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  const submitJson = (await submit.json().catch(() => ({}))) as JobResponse & { jobId?: string };
  if (!submit.ok || !submitJson.jobId) {
    throw new Error(
      (submitJson as { error?: string }).error || `Failed to start generation (${submit.status})`,
    );
  }

  const jobId = submitJson.jobId;
  const interval = submitJson.pollIntervalMs ?? 5000;

  for (;;) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    await sleep(interval);
    const res = await fetch(`/api/generate-classroom/${jobId}`, { signal });
    const job = (await res.json().catch(() => ({}))) as JobResponse;
    if (!res.ok) {
      throw new Error(job.error || `Polling failed (${res.status})`);
    }
    onProgress?.({
      step: job.step,
      progress: job.progress,
      message: job.message,
      scenesGenerated: job.scenesGenerated,
      totalScenes: job.totalScenes,
    });
    if (job.status === 'succeeded' && job.result?.classroomId) {
      return job.result;
    }
    if (job.status === 'failed') {
      throw new Error(job.error || job.message || 'Classroom generation failed');
    }
    // otherwise queued/running: keep polling
  }
}
