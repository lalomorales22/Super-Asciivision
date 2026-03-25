import { create } from "zustand";
import { api } from "../lib/tauri";
import type {
  AgentChatRequest,
  AgentEvent,
  ChatRequest,
  ConversationDetail,
  ConversationSummary,
  StreamEvent,
} from "../types";
import { useAppStore } from "./appStore";
import { useWorkspaceStore } from "./workspaceStore";

function summarizeTitle(input: string) {
  return input.trim().slice(0, 36) || "New chat";
}

interface ChatState {
  conversations: ConversationSummary[];
  activeConversation?: ConversationDetail;
  composer: string;
  sending: boolean;
  activeStreamId?: string;
  agentMode: boolean;
  agentToolCalls: Array<{
    toolName: string;
    args: string;
    result?: string;
    success?: boolean;
    isRunning: boolean;
  }>;
  refreshConversations: () => Promise<void>;
  setComposer: (value: string) => void;
  loadConversation: (conversationId: string) => Promise<void>;
  createConversation: () => Promise<void>;
  renameConversation: (conversationId: string, title: string) => Promise<void>;
  toggleConversationPin: (conversationId: string, pinned: boolean) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  sendMessage: () => Promise<void>;
  sendAgentMessage: () => Promise<void>;
  toggleAgentMode: () => void;
  stopStream: () => Promise<void>;
  handleStreamEvent: (event: StreamEvent) => void;
  handleAgentEvent: (event: AgentEvent) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  composer: "",
  sending: false,
  agentMode: false,
  agentToolCalls: [],

  refreshConversations: async () => {
    const conversations = await api.listConversations();
    set({ conversations });
  },

  setComposer: (value) => set({ composer: value }),

  loadConversation: async (conversationId) => {
    const detail = await api.loadConversation(conversationId);
    set({ activeConversation: detail });
    useWorkspaceStore.setState({ activeWorkspaceId: undefined, workspaceSelection: {} });
  },

  createConversation: async () => {
    const conversation = await api.createConversation({ title: "New chat" });
    await get().refreshConversations();
    await get().loadConversation(conversation.id);
  },

  renameConversation: async (conversationId, title) => {
    await api.renameConversation(conversationId, title);
    await get().refreshConversations();
    if (get().activeConversation?.conversation.id === conversationId) {
      await get().loadConversation(conversationId);
    }
  },

  toggleConversationPin: async (conversationId, pinned) => {
    await api.setConversationPinned(conversationId, pinned);
    await get().refreshConversations();
    if (get().activeConversation?.conversation.id === conversationId) {
      await get().loadConversation(conversationId);
    }
  },

  deleteConversation: async (conversationId) => {
    await api.deleteConversation(conversationId);
    await get().refreshConversations();
    if (get().activeConversation?.conversation.id === conversationId) {
      set({ activeConversation: undefined });
      const nextConversation = get().conversations[0];
      if (nextConversation) {
        await get().loadConversation(nextConversation.id);
      }
    }
  },

  sendMessage: async () => {
    const state = get();
    const userText = state.composer.trim();
    if (!userText || state.sending) {
      return;
    }

    let conversationId = state.activeConversation?.conversation.id;
    if (!conversationId) {
      const conversation = await api.createConversation({ title: summarizeTitle(userText) });
      conversationId = conversation.id;
      await get().refreshConversations();
    }

    const appState = useAppStore.getState();
    const provider = appState.selectedProvider;
    const modelId = appState.selectedModel;
    if (!modelId) {
      useAppStore.setState({ error: "No model is available." });
      return;
    }

    const request: ChatRequest = {
      conversationId,
      providerId: provider,
      modelId,
      userText,
      selectedWorkspaceItems: Object.entries(useWorkspaceStore.getState().workspaceSelection)
        .filter(([, selected]) => selected)
        .map(([itemId]) => itemId),
      maxOutputTokens: 2048,
    };

    set({ sending: true, composer: "" });
    useAppStore.setState({ error: undefined });
    const handle = await api.sendMessage(request);
    await get().refreshConversations();
    await get().loadConversation(conversationId);
    set({ activeStreamId: handle.streamId });
  },

  sendAgentMessage: async () => {
    const state = get();
    const userText = state.composer.trim();
    if (!userText || state.sending) return;

    let conversationId = state.activeConversation?.conversation.id;
    if (!conversationId) {
      const conversation = await api.createConversation({ title: summarizeTitle(userText) });
      conversationId = conversation.id;
      await get().refreshConversations();
    }

    const appState = useAppStore.getState();
    const provider = appState.selectedProvider;
    const modelId = appState.selectedModel;
    if (!modelId) {
      useAppStore.setState({ error: "No model is available." });
      return;
    }

    const request: AgentChatRequest = {
      conversationId,
      providerId: provider,
      modelId,
      userText,
      selectedWorkspaceItems: Object.entries(useWorkspaceStore.getState().workspaceSelection)
        .filter(([, selected]) => selected)
        .map(([itemId]) => itemId),
      maxOutputTokens: 4096,
      maxIterations: 25,
    };

    set({ sending: true, composer: "", agentToolCalls: [] });
    useAppStore.setState({ error: undefined });
    const handle = await api.sendAgentMessage(request);
    await get().refreshConversations();
    await get().loadConversation(conversationId);
    set({ activeStreamId: handle.streamId });
  },

  toggleAgentMode: () => set((state) => ({ agentMode: !state.agentMode })),

  stopStream: async () => {
    const streamId = get().activeStreamId;
    if (!streamId) {
      return;
    }
    await api.cancelStream(streamId);
    set({ sending: false, activeStreamId: undefined });
  },

  handleStreamEvent: (event: StreamEvent) => {
    set((state) => {
      const detail = state.activeConversation;
      if (!detail) {
        return {
          sending:
            event.kind === "started" || event.kind === "delta"
              ? true
              : event.kind === "completed" || event.kind === "cancelled" || event.kind === "error"
                ? false
                : state.sending,
          activeStreamId:
            event.kind === "completed" || event.kind === "cancelled" || event.kind === "error"
              ? undefined
              : state.activeStreamId,
        };
      }

      const messages = detail.messages.map((message) => {
        if (message.id !== event.messageId) {
          return message;
        }
        if (event.kind === "delta") {
          return {
            ...message,
            content: `${message.content}${event.textDelta ?? ""}`,
            status: "streaming",
          };
        }
        if (event.kind === "completed") {
          return { ...message, status: "complete", usage: event.usage ?? undefined };
        }
        if (event.kind === "cancelled") {
          return { ...message, status: "cancelled" };
        }
        if (event.kind === "error") {
          return { ...message, status: "error", error: event.error };
        }
        return message;
      });

      if (event.kind === "error") {
        useAppStore.setState({ error: event.error ?? "Streaming failed." });
      }

      return {
        activeConversation: { ...detail, messages },
        sending:
          event.kind === "started" || event.kind === "delta"
            ? true
            : event.kind === "completed" || event.kind === "cancelled" || event.kind === "error"
              ? false
              : state.sending,
        activeStreamId:
          event.kind === "completed" || event.kind === "cancelled" || event.kind === "error"
            ? undefined
            : state.activeStreamId,
      };
    });
  },

  handleAgentEvent: (event: AgentEvent) => {
    set((state) => {
      const detail = state.activeConversation;

      if (event.kind === "tool_call") {
        return {
          agentToolCalls: [
            ...state.agentToolCalls,
            {
              toolName: event.toolName ?? "unknown",
              args: event.toolArgs ?? "{}",
              isRunning: true,
            },
          ],
        };
      }

      if (event.kind === "tool_result") {
        const calls = [...state.agentToolCalls];
        let lastRunning = -1;
        for (let i = calls.length - 1; i >= 0; i--) {
          if (calls[i].isRunning) { lastRunning = i; break; }
        }
        if (lastRunning >= 0) {
          calls[lastRunning] = {
            ...calls[lastRunning],
            result: event.toolResult ?? "",
            success: event.toolSuccess ?? false,
            isRunning: false,
          };
        }
        return { agentToolCalls: calls };
      }

      if (event.kind === "text_delta" && detail) {
        const messageId = event.messageId;
        if (!messageId) return {};
        const messages = detail.messages.map((msg) => {
          if (msg.id !== messageId) return msg;
          return {
            ...msg,
            content: `${msg.content}${event.textDelta ?? ""}`,
            status: "streaming",
          };
        });
        return { activeConversation: { ...detail, messages } };
      }

      if (event.kind === "complete") {
        return {
          sending: false,
          activeStreamId: undefined,
        };
      }

      if (event.kind === "error") {
        useAppStore.setState({ error: event.error ?? "Agent execution failed." });
        return {
          sending: false,
          activeStreamId: undefined,
        };
      }

      return {};
    });
  },
}));
