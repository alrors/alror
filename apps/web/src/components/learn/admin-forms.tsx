"use client";

import { useRef, useState } from "react";
import { Link2 } from "lucide-react";
import { useResultToast } from "@/components/admin/admin-action";
import { Spinner } from "@/components/console/loader";
import { buttonClass, FormField, inputClass } from "@/components/console/primitives";
import { useRetryableAction } from "@/components/console/shell-toast";
import type { ActionResult } from "@/lib/console/action-types";
import { youtubeId, youtubeThumb } from "@/lib/learn/youtube";
import { cn } from "@/lib/site";
import { addLectureAction, createCourseAction, updateCourseAction, updateLectureAction } from "@/app/admin/learn/actions";

const textareaClass = cn(inputClass, "h-auto min-h-[84px] resize-y py-2 leading-relaxed");

function Submit({ pending, children, className }: { pending: boolean; children: React.ReactNode; className?: string }) {
  return (
    <button type="submit" disabled={pending} className={cn(buttonClass.primary, className)}>
      {pending && <Spinner size={13} />}
      {children}
    </button>
  );
}

export function NewCourseForm() {
  const [state, action, pending, retry] = useRetryableAction<ActionResult>(createCourseAction, undefined);
  useResultToast(state, retry);
  return (
    <form action={action} className="space-y-3">
      <FormField label="Title" htmlFor="c-title">
        <input id="c-title" name="title" required maxLength={160} placeholder="Shipping safely with Alror" className={inputClass} />
      </FormField>
      <FormField label="Summary" htmlFor="c-summary" hint="One or two lines shown on the course card.">
        <textarea id="c-summary" name="summary" rows={3} className={textareaClass} />
      </FormField>
      <Submit pending={pending}>Create course</Submit>
    </form>
  );
}

export function CourseSettingsForm({ course }: { course: { id: string; title: string; summary: string; slug: string } }) {
  const [state, action, pending, retry] = useRetryableAction<ActionResult>(updateCourseAction, undefined);
  useResultToast(state, retry);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="course" value={course.id} />
      <FormField label="Title" htmlFor="s-title">
        <input id="s-title" name="title" required maxLength={160} defaultValue={course.title} className={inputClass} />
      </FormField>
      <FormField label="URL" htmlFor="s-slug" hint="alror.com/learn/…">
        <input id="s-slug" name="slug" defaultValue={course.slug} className={cn(inputClass, "font-mono")} />
      </FormField>
      <FormField label="Summary" htmlFor="s-summary">
        <textarea id="s-summary" name="summary" rows={3} defaultValue={course.summary} className={textareaClass} />
      </FormField>
      <Submit pending={pending}>Save</Submit>
    </form>
  );
}

/** Paste a YouTube link; the title comes from YouTube when left blank. */
export function AddLectureForm({ courseId }: { courseId: string }) {
  const form = useRef<HTMLFormElement>(null);
  const [url, setUrl] = useState("");
  const [state, submit, pending, retry] = useRetryableAction<ActionResult>(async (prev: ActionResult, fd: FormData) => {
    const r = await addLectureAction(prev, fd);
    if (r?.ok) {
      form.current?.reset();
      setUrl("");
    }
    return r;
  }, undefined);
  useResultToast(state, retry);
  const id = url.trim() ? youtubeId(url) : null;
  const bad = Boolean(url.trim()) && !id;

  return (
    <form ref={form} action={submit} className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
      <input type="hidden" name="course" value={courseId} />
      <div className="space-y-3">
        <FormField label="YouTube link" htmlFor="l-url" error={bad ? "That does not look like a YouTube link." : undefined}>
          <div className="relative">
            <Link2 size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-con-fg3" />
            <input
              id="l-url"
              name="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-invalid={bad}
              placeholder="https://www.youtube.com/watch?v=…"
              className={cn(inputClass, "pl-8")}
            />
          </div>
        </FormField>
        <FormField label="Title" htmlFor="l-title" hint="Leave blank to use the YouTube title.">
          <input id="l-title" name="title" maxLength={160} className={inputClass} />
        </FormField>
        <FormField label="Notes" htmlFor="l-desc" hint="Shown under the video. Optional.">
          <textarea id="l-desc" name="description" rows={3} className={textareaClass} />
        </FormField>
        <div className="flex flex-wrap items-center gap-4">
          <Submit pending={pending}>Add lecture</Submit>
          <label className="inline-flex items-center gap-2 text-[13px] text-con-fg2">
            <input type="checkbox" name="publish" defaultChecked className="h-3.5 w-3.5 accent-white" />
            Publish now
          </label>
        </div>
      </div>
      <div className="hidden md:block">
        <p className="mb-1.5 text-[13px] text-con-fg2">Preview</p>
        <div className="aspect-video overflow-hidden rounded-md border border-con-line bg-con-bg">
          {id ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={youtubeThumb(id)} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full place-items-center text-[12px] text-con-fg3">Paste a link</div>
          )}
        </div>
      </div>
    </form>
  );
}

export function EditLectureForm({
  lecture,
  onDone,
}: {
  lecture: { id: string; title: string; description: string; youtubeId: string };
  onDone?: () => void;
}) {
  const [state, submit, pending, retry] = useRetryableAction<ActionResult>(async (prev: ActionResult, fd: FormData) => {
    const r = await updateLectureAction(prev, fd);
    if (r?.ok) onDone?.();
    return r;
  }, undefined);
  useResultToast(state, retry);
  return (
    <form action={submit} className="space-y-3">
      <input type="hidden" name="lecture" value={lecture.id} />
      <FormField label="Title" htmlFor={`t-${lecture.id}`}>
        <input id={`t-${lecture.id}`} name="title" required maxLength={160} defaultValue={lecture.title} className={inputClass} />
      </FormField>
      <FormField label="YouTube link" htmlFor={`u-${lecture.id}`}>
        <input id={`u-${lecture.id}`} name="url" defaultValue={`https://youtu.be/${lecture.youtubeId}`} className={inputClass} />
      </FormField>
      <FormField label="Notes" htmlFor={`d-${lecture.id}`}>
        <textarea id={`d-${lecture.id}`} name="description" rows={4} defaultValue={lecture.description} className={textareaClass} />
      </FormField>
      <div className="flex gap-2">
        <Submit pending={pending}>Save</Submit>
        {onDone && (
          <button type="button" onClick={onDone} className={buttonClass.secondary}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
