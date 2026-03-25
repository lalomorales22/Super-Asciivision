import clsx from "clsx";
import { MessageSquarePlus, Pencil, Pin, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { useAppStore } from "../../store/appStore";
import { EmptyPanel } from "../EmptyPanel";

interface ConversationContextMenuState {
  conversation: {
    id: string;
    title: string;
    pinned: boolean;
  };
  x: number;
  y: number;
}

interface ConversationRenameState {
  id: string;
  title: string;
}

export function HistoryRail() {
  const conversations = useAppStore((state) => state.conversations);
  const activeConversationId = useAppStore((state) => state.activeConversation?.conversation.id);
  const createConversation = useAppStore((state) => state.createConversation);
  const loadConversation = useAppStore((state) => state.loadConversation);
  const renameConversation = useAppStore((state) => state.renameConversation);
  const toggleConversationPin = useAppStore((state) => state.toggleConversationPin);
  const deleteConversation = useAppStore((state) => state.deleteConversation);
  const [contextMenu, setContextMenu] = useState<ConversationContextMenuState>();
  const [renameDialog, setRenameDialog] = useState<ConversationRenameState>();
  const [renameDraft, setRenameDraft] = useState("");

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }
    const dismiss = () => setContextMenu(undefined);
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("blur", dismiss);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("resize", dismiss);
    };
  }, [contextMenu]);

  const openRenameDialog = (conversationId: string, title: string) => {
    setRenameDraft(title);
    setRenameDialog({ id: conversationId, title });
  };

  const submitRename = async () => {
    if (!renameDialog) {
      return;
    }
    const nextTitle = renameDraft.trim();
    if (!nextTitle) {
      return;
    }
    await renameConversation(renameDialog.id, nextTitle);
    setRenameDialog(undefined);
  };

  return (
    <aside className="flex min-h-0 flex-col bg-[linear-gradient(180deg,rgba(8,9,11,0.98),rgba(5,6,8,0.95))]">
      <div className="border-b border-white/6 px-2.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-[0.35em] text-[#84a09b]">History</p>
            <h2 className="mt-1 text-[12px] font-semibold text-stone-100">Chats</h2>
          </div>
          <button
            type="button"
            onClick={() => void createConversation()}
            className="inline-flex items-center gap-1 rounded-xl border border-white/8 bg-white/5 px-2 py-1 text-[10px] text-stone-200 transition hover:bg-white/10"
          >
            <MessageSquarePlus className="h-3 w-3" />
            New
          </button>
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-2 py-2">
        {conversations.length ? (
          conversations.map((conversation) => (
            <ConversationCard
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === activeConversationId}
              onOpen={() => void loadConversation(conversation.id)}
              onTogglePin={() => void toggleConversationPin(conversation.id, !conversation.pinned)}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenu({
                  conversation: {
                    id: conversation.id,
                    title: conversation.title,
                    pinned: conversation.pinned,
                  },
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
            />
          ))
        ) : (
          <EmptyPanel
            eyebrow="No chats"
            title="Start a new thread."
            body="Every chat is kept in this rail so you can jump back into older coding sessions."
          />
        )}
      </div>
      {contextMenu ? (
        <div
          className="fixed z-50 w-44 rounded-[18px] border border-white/8 bg-[#0b0c0d] p-1.5 shadow-[0_18px_60px_rgba(0,0,0,0.45)]"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 188),
            top: Math.min(contextMenu.y, window.innerHeight - 156),
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              setContextMenu(undefined);
              void toggleConversationPin(contextMenu.conversation.id, !contextMenu.conversation.pinned);
            }}
            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[11px] text-stone-200 transition hover:bg-white/7"
          >
            <Pin className="h-3.5 w-3.5" />
            {contextMenu.conversation.pinned ? "Unpin" : "Pin"}
          </button>
          <button
            type="button"
            onClick={() => {
              const { id, title } = contextMenu.conversation;
              setContextMenu(undefined);
              openRenameDialog(id, title);
            }}
            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[11px] text-stone-200 transition hover:bg-white/7"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              setContextMenu(undefined);
              void deleteConversation(contextMenu.conversation.id);
            }}
            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[11px] text-rose-100 transition hover:bg-rose-500/15"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      ) : null}
      {renameDialog ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onPointerDown={() => setRenameDialog(undefined)}
        >
          <div
            className="w-full max-w-sm rounded-[24px] border border-white/10 bg-[#0b0c0d] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.5)]"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <p className="text-[10px] uppercase tracking-[0.28em] text-[#84a09b]">Rename Chat</p>
            <h3 className="mt-2 text-[15px] font-semibold text-stone-100">Edit conversation title</h3>
            <input
              autoFocus
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submitRename();
                }
                if (event.key === "Escape") {
                  setRenameDialog(undefined);
                }
              }}
              className="mt-4 w-full rounded-xl border border-white/8 bg-black/30 px-3 py-2.5 text-[12px] text-stone-100 outline-none placeholder:text-stone-600 focus:border-emerald-300/35"
              placeholder="Conversation title"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameDialog(undefined)}
                className="rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-[10px] text-stone-300 transition hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitRename()}
                disabled={!renameDraft.trim()}
                className="rounded-xl border border-emerald-300/20 bg-emerald-300/12 px-3 py-2 text-[10px] font-semibold text-emerald-50 transition hover:bg-emerald-300/20 disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-white/5 disabled:text-stone-500"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function ConversationCard({
  conversation,
  active,
  onOpen,
  onTogglePin,
  onContextMenu,
}: {
  conversation: { id: string; title: string; pinned: boolean; previewText?: string | null; modelId?: string | null };
  active: boolean;
  onOpen: () => void;
  onTogglePin: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      onContextMenu={onContextMenu}
      className={clsx(
        "group w-full rounded-[16px] border px-2 py-2 text-left transition",
        active
          ? "border-emerald-200/18 bg-emerald-300/8"
          : "border-white/6 bg-white/[0.025] hover:bg-white/[0.05]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[11px] font-semibold text-stone-100">{conversation.title}</p>
            {conversation.pinned ? (
              <span className="rounded-full border border-amber-300/18 bg-amber-300/10 px-1.5 py-0.5 font-['IBM_Plex_Mono'] text-[8px] uppercase tracking-[0.18em] text-amber-100">
                Pinned
              </span>
            ) : null}
          </div>
          <p className="mt-1 line-clamp-2 text-[10px] leading-[1.1rem] text-stone-500">
            {conversation.previewText ?? "No preview yet"}
          </p>
          <p className="mt-2 font-['IBM_Plex_Mono'] text-[9px] text-stone-600">
            {conversation.modelId ?? "awaiting model"}
          </p>
        </div>
        <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onTogglePin();
            }}
            className="rounded-lg border border-white/8 bg-black/30 p-1 text-stone-300 hover:bg-white/8"
            aria-label={conversation.pinned ? "Unpin conversation" : "Pin conversation"}
          >
            <Pin className="h-3 w-3" />
          </button>
        </div>
      </div>
    </button>
  );
}
