"use client";

import { Upload } from "lucide-react";

export function UploadLogo({ onFile }: { onFile: (url: string) => void }) {
  return (
    <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center border border-dashed border-neutral-300 bg-white p-4 text-center text-sm text-neutral-500">
      <Upload size={20} className="mb-2 text-black" />
      Upload logo hoặc hình in
      <span className="mt-1 text-xs">File càng rõ thì bản in càng đẹp.</span>
      <input
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(URL.createObjectURL(file));
        }}
      />
    </label>
  );
}
