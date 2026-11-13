/**
 * Owner devices for a folder (RFD-005): tick the cameras that belong to this folder's owner. Duplicate
 * preselection then prefers the copy in the folder whose owner took the photo (rule order in Settings).
 * Lists the make/model values actually found in the folder's photos, so names match EXIF exactly.
 */
import { LoaderCircle, Smartphone } from "lucide-react";
import { type ReactElement, useState } from "react";
import { useAction } from "../../external/use-action";
import { useRead } from "../../external/use-read";
import { type FolderDevice, listFolderDevices, saveFolderOwnerDevices } from "../../services/owner-devices-service";
import { notifyReviewDataChanged } from "../../state/review-events";
import { ICON } from "./format";

const keyOf = (d: FolderDevice) => `${d.cameraMake ?? ""}|${d.cameraModel}`;
const label = (d: FolderDevice) => (d.cameraMake ? `${d.cameraMake} ${d.cameraModel}` : d.cameraModel);

function DeviceList({
  scanFolderId,
  devices,
  onClose,
}: {
  scanFolderId: number;
  devices: FolderDevice[];
  onClose: () => void;
}): ReactElement {
  const [owned, setOwned] = useState(() => new Set(devices.filter((d) => d.owned).map(keyOf)));
  const save = useAction(async (devicesToSave: Array<Pick<FolderDevice, "cameraMake" | "cameraModel">>) => {
    await saveFolderOwnerDevices(scanFolderId, devicesToSave);
    return true;
  });
  const toggle = (key: string) =>
    setOwned((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const onSave = async () => {
    const chosen = devices.filter((d) => owned.has(keyOf(d)));
    const saved = await save.run(chosen.map(({ cameraMake, cameraModel }) => ({ cameraMake, cameraModel })));
    if (saved) {
      notifyReviewDataChanged();
      onClose();
    }
  };
  return (
    <>
      <div className="px-6 py-4 max-h-80 overflow-y-auto">
        {devices.length === 0 ? (
          <p className="text-sm text-fg-muted">
            No camera models found in this folder's photos yet. Scan and process it first.
          </p>
        ) : (
          <ul className="space-y-1">
            {devices.map((d) => (
              <li key={keyOf(d)}>
                <label className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-surface-hover cursor-pointer">
                  <input
                    type="checkbox"
                    aria-label={label(d)}
                    checked={owned.has(keyOf(d))}
                    onChange={() => toggle(keyOf(d))}
                  />
                  <span className="flex-1 text-sm text-fg-2">{label(d)}</span>
                  <span className="text-xs text-fg-faint">{`${d.photos.toLocaleString()} photos`}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {save.failure && <p className="mt-2 text-sm text-accent-red">{save.failure.message}</p>}
      </div>
      <div className="flex justify-end gap-3 px-6 py-4 border-t border-edge">
        <button
          type="button"
          className="px-4 py-2 rounded-lg text-sm font-medium bg-surface-inset hover:bg-surface-active text-fg-2"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className="px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-500 text-white flex items-center gap-2"
          disabled={save.pending}
          onClick={() => void onSave()}
        >
          {save.pending && <LoaderCircle size="1em" className="animate-spin" />}
          Save
        </button>
      </div>
    </>
  );
}

export function OwnerDevicesDialog({
  folder,
  onClose,
}: {
  folder: { id: number; path: string };
  onClose: () => void;
}): ReactElement {
  const devices = useRead(`owner-devices:${folder.id}`, () => listFolderDevices(folder.id));
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-dismiss, as in the other dialogs
    // biome-ignore lint/a11y/useKeyWithClickEvents: Cancel button is the keyboard path
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-surface-card rounded-xl border border-edge shadow-2xl max-w-lg w-full"
        role="dialog"
        aria-modal="true"
        aria-labelledby="owner-devices-title"
      >
        <div className="px-6 py-4 border-b border-edge flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-violet-500/20 text-violet-400 flex items-center justify-center">
            <Smartphone size="1em" className={`${ICON} text-xl`} />
          </div>
          <div className="min-w-0">
            <h3 id="owner-devices-title" className="text-lg font-semibold text-fg">
              Owner Devices
            </h3>
            <p className="text-sm text-fg-muted truncate" title={folder.path}>
              {`Photos from these cameras belong to ${folder.path}`}
            </p>
          </div>
        </div>
        {devices.value === undefined ? (
          <div className="px-6 py-8 text-sm text-fg-muted flex items-center gap-2">
            {devices.failure ? (
              <span className="text-accent-red">{devices.failure.message}</span>
            ) : (
              <>
                <LoaderCircle size="1em" className="animate-spin" /> Loading cameras…
              </>
            )}
          </div>
        ) : (
          <DeviceList scanFolderId={folder.id} devices={devices.value} onClose={onClose} />
        )}
      </div>
    </div>
  );
}
