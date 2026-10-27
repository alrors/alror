"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ExternalLink, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { AdminAction } from "@/components/admin/admin-action";
import { buttonClass, Pill } from "@/components/console/primitives";
import { youtubeThumb } from "@/lib/learn/youtube";
import { cn } from "@/lib/site";
import { deleteLectureAction, moveLectureForm, publishLectureAction } from "@/app/admin/learn/actions";
import { EditLectureForm } from "./admin-forms";

type Row = { id: string; title: string; description: string; youtubeId: string; slug: string; published: boolean };

const iconBtn = cn(buttonClass.secondary, "h-7 w-7 px-0");

export function LectureRow({ lecture, index, count, courseSlug }: { lecture: Row; index: number; count: number; courseSlug: string }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="border-b border-con-line px-5 py-3 last:border-0">
      <div className="flex items-center gap-3">
        <span className="w-5 shrink-0 text-right text-[12px] tabular-nums text-con-fg3">{index + 1}</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={youtubeThumb(lecture.youtubeId)} alt="" className="h-10 w-[72px] shrink-0 rounded object-cover" loading="lazy" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-con-fg">{lecture.title}</p>
          <p className="truncate font-mono text-[11px] text-con-fg3">youtu.be/{lecture.youtubeId}</p>
        </div>
        {!lecture.published && <Pill>Draft</Pill>}
        <div className="flex shrink-0 items-center gap-1.5">
          <AdminAction
            action={publishLectureAction}
            fields={{ lecture: lecture.id, publish: lecture.published ? "0" : "1" }}
            label={lecture.published ? "Unpublish" : "Publish"}
            size="sm"
          />
          <form action={moveLectureForm} className="contents">
            <input type="hidden" name="lecture" value={lecture.id} />
            <button name="dir" value="up" disabled={index === 0} title="Move up" className={iconBtn}>
              <ArrowUp size={13} />
            </button>
            <button name="dir" value="down" disabled={index === count - 1} title="Move down" className={iconBtn}>
              <ArrowDown size={13} />
            </button>
          </form>
          <button type="button" onClick={() => setEditing((v) => !v)} title="Edit" className={iconBtn}>
            <Pencil size={13} />
          </button>
          <Link href={`/learn/${courseSlug}/${lecture.slug}`} target="_blank" title="Open" className={iconBtn}>
            <ExternalLink size={13} />
          </Link>
          <AdminAction
            action={deleteLectureAction}
            fields={{ lecture: lecture.id }}
            label=""
            icon={<Trash2 size={13} />}
            confirm="Delete this lecture?"
            confirmLabel="Delete"
            tone="danger"
            size="sm"
          />
        </div>
      </div>
      {editing && (
        <div className="con-fade mt-3 rounded-md border border-con-line bg-con-bg p-4 sm:ml-[108px]">
          <EditLectureForm lecture={lecture} onDone={() => setEditing(false)} />
        </div>
      )}
    </li>
  );
}
