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
  /** Accumulated reasoning/thinking text from xAI reasoning models. */
  reasoningText: string;
  /** Whether the reasoning panel is expanded by the user. */
  reasoningExpanded: boolean;
  agentThinking?: { message: string; phase?: string };
  agentToolCalls: Array<{
    toolName: string;
    args: string;
    result?: string;
    success?: boolean;
    isRunning: boolean;
  }>;
  subAgents: Array<{
    agentId: string;
    label: string;
    status: "running" | "complete" | "error";
    summary?: string;
  }>;
  agentProgress?: {
    iteration: number;
    maxIterations: number;
    elapsedMs: number;
  };
  /** Pending permission request the user needs to approve/deny */
  pendingApproval?: {
    callId: string;
    toolName: string;
    toolArgs: string;
    reason: string;
  };
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
  handleReasoningEvent: (text: string) => void;
  toggleReasoningExpanded: () => void;
  handleAgentEvent: (event: AgentEvent) => void;
  respondToApproval: (approved: boolean) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  composer: "",
  sending: false,
  agentMode: false,
  reasoningText: "",
  reasoningExpanded: false,
  agentToolCalls: [],
  subAgents: [],

  refreshConversations: async () => {
    const conversations = await api.listConversations();
    set({ conversations });
  },

  setComposer: (value) => set({ composer: value }),

  loadConversation: async (conversationId) => {
    const detail = await api.loadConversation(conversationId);
    set({ activeConversation: detail });
    useWorkspaceStore.getState().clearChatSelection();
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
      selectedWorkspaceItems: Object.entries(useWorkspaceStore.getState().chatSelection)
        .filter(([, selected]) => selected)
        .map(([itemId]) => itemId),
      maxOutputTokens: 2048,
    };

    set({ sending: true, composer: "", reasoningText: "" });
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
      selectedWorkspaceItems: Object.entries(useWorkspaceStore.getState().chatSelection)
        .filter(([, selected]) => selected)
        .map(([itemId]) => itemId),
      maxOutputTokens: 4096,
      maxIterations: 25,
    };

    set({ sending: true, composer: "", agentToolCalls: [], subAgents: [], agentProgress: undefined, reasoningText: "" });
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

  handleReasoningEvent: (text: string) => {
    set((state) => ({ reasoningText: state.reasoningText + text }));
  },

  toggleReasoningExpanded: () => {
    set((state) => ({ reasoningExpanded: !state.reasoningExpanded }));
  },

  handleAgentEvent: (event: AgentEvent) => {
    set((state) => {
      const detail = state.activeConversation;

      if (event.kind === "thinking") {
        return {
          agentThinking: {
            message: event.thinkingMessage ?? event.error ?? "Thinking...",
            phase: event.phase ?? undefined,
          },
        };
      }

      if (event.kind === "reasoning_delta") {
        return { reasoningText: state.reasoningText + (event.textDelta ?? "") };
      }

      if (event.kind === "permission_request") {
        return {
          pendingApproval: {
            callId: event.callId ?? "",
            toolName: event.toolName ?? "unknown",
            toolArgs: event.toolArgs ?? "{}",
            reason: event.reason ?? "This tool requires approval.",
          },
          agentThinking: {
            message: `Waiting for approval: ${event.toolName}`,
            phase: "tool_exec",
          },
        };
      }

      if (event.kind === "tool_call") {
        return {
          pendingApproval: undefined,
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

      if (event.kind === "sub_agent_started") {
        return {
          subAgents: [
            ...state.subAgents,
            {
              agentId: event.agentId ?? "",
              label: event.label ?? "Sub-agent",
              status: "running" as const,
            },
          ],
        };
      }

      if (event.kind === "sub_agent_complete") {
        return {
          subAgents: state.subAgents.map((sa) =>
            sa.agentId === event.agentId
              ? {
                  ...sa,
                  status: (event.toolSuccess !== false ? "complete" : "error") as "complete" | "error",
                  summary: event.summary ?? undefined,
                }
              : sa,
          ),
        };
      }

      if (event.kind === "progress") {
        return {
          agentProgress: {
            iteration: event.iteration ?? 0,
            maxIterations: event.maxIterations ?? 0,
            elapsedMs: event.elapsedMs ?? 0,
          },
        };
      }

      if (event.kind === "complete") {
        return {
          sending: false,
          activeStreamId: undefined,
          agentThinking: undefined,
          pendingApproval: undefined,
          subAgents: [],
          agentProgress: undefined,
        };
      }

      if (event.kind === "error") {
        useAppStore.setState({ error: event.error ?? "Agent execution failed." });
        return {
          sending: false,
          activeStreamId: undefined,
          agentThinking: undefined,
          pendingApproval: undefined,
          subAgents: [],
          agentProgress: undefined,
        };
      }

      return {};
    });
  },

  respondToApproval: async (approved: boolean) => {
    const state = get();
    const streamId = state.activeStreamId;
    const pending = state.pendingApproval;
    if (!streamId || !pending) return;
    await api.approveToolCall(streamId, pending.callId, approved);
    set({ pendingApproval: undefined });
  },
}));
