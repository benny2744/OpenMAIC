'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { createLogger } from '@/lib/logger';

const log = createLogger('ClassroomJobPage');

interface JobState {
  status?: 'queued' | 'running' | 'succeeded' | 'failed';
  step?: string;
  progress?: number;
  message?: string;
  scenesGenerated?: number;
  totalScenes?: number;
  result?: { classroomId?: string; url?: string };
  error?: string;
  done?: boolean;
  pollIntervalMs?: number;
}

const STEP_LABELS: Record<string, string> = {
  queued: 'Queued',
  initializing: 'Initializing',
  researching: 'Researching',
  generating_outlines: 'Generating outline',
  generating_scenes: 'Generating scenes',
  generating_media: 'Generating media',
  generating_tts: 'Generating narration',
  persisting: 'Saving classroom',
  completed: 'Completed',
  failed: 'Failed',
};

function JobWatcher() {
  const params = useParams<{ jobId: string }>();
  const router = useRouter();
  const jobId = params.jobId;
  const [job, setJob] = useState<JobState>({});
  const [fatal, setFatal] = useState<string | null>(null);
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      if (stopped.current) return;
      try {
        const res = await fetch(`/api/generate-classroom/${jobId}`, { cache: 'no-store' });
        const data = (await res.json().catch(() => ({}))) as JobState;
        if (!res.ok) {
          setFatal(data.error || `Job lookup failed (${res.status})`);
          return;
        }
        setJob(data);
        if (data.status === 'succeeded' && data.result?.classroomId) {
          stopped.current = true;
          router.replace(`/classroom/${data.result.classroomId}`);
          return;
        }
        if (data.status === 'failed') {
          setFatal(data.error || data.message || 'Classroom generation failed');
          return;
        }
        timer = setTimeout(poll, data.pollIntervalMs ?? 5000);
      } catch (e) {
        log.error('poll failed', e);
        timer = setTimeout(poll, 5000);
      }
    };

    poll();
    return () => {
      stopped.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, router]);

  const progress = Math.max(0, Math.min(100, job.progress ?? 0));
  const stepLabel = STEP_LABELS[job.step ?? ''] ?? job.step ?? 'Working';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
        <h1 className="text-lg font-semibold">Generating your classroom</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This runs on the server — you can close this tab and come back to this same URL anytime.
        </p>

        {fatal ? (
          <div className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {fatal}
          </div>
        ) : (
          <>
            <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-foreground">{stepLabel}</span>
              <span className="tabular-nums text-muted-foreground">{progress}%</span>
            </div>
            {job.totalScenes ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Scene {job.scenesGenerated ?? 0} of {job.totalScenes}
              </p>
            ) : null}
            {job.message ? (
              <p className="mt-2 text-xs text-muted-foreground">{job.message}</p>
            ) : null}
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Job <span className="font-mono">{jobId}</span>
      </p>
    </div>
  );
}

export default function ClassroomJobPage() {
  return (
    <ThemeProvider>
      <JobWatcher />
    </ThemeProvider>
  );
}
