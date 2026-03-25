import { describe, expect, it, beforeEach, vi } from "vitest";
import { useChatStore } from "./chatStore";

// Mock the tauri API
vi.mock("../lib/tauri", () => ({
  api: {
    listConversations: vi.fn().mockResolvedValue([
      { id: "c1", title: "Chat 1", updatedAt: "2024-01-01", pinned: false },
    ]),
    loadConversation: vi.fn().mockResolvedValue({
      conversation: { id: "c1", title: "Chat 1", createdAt: "2024-01-01", updatedAt: "2024-01-01", pinned: false },
      messages: [],
    }),
    createConversation: vi.fn().mockResolvedValue({ id: "c2", title: "New chat" }),
    renameConversation: vi.fn().mockResolvedValue(undefined),
    setConversationPinned: vi.fn().mockResolvedValue(undefined),
    deleteConversation: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue({ streamId: "s1" }),
    sendAgentMessage: vi.fn().mockResolvedValue({ streamId: "s2" }),
    cancelStream: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock dependent stores
vi.mock("./appStore", () => ({
  useAppStore: {
    getState: vi.fn().mockReturnValue({
      selectedProvider: "xai",
      selectedModel: "grok-code-fast-1",
    }),
    setState: vi.fn(),
  },
}));

vi.mock("./workspaceStore", () => ({
  useWorkspaceStore: {
    getState: vi.fn().mockReturnValue({ workspaceSelection: {} }),
    setState: vi.fn(),
  },
}));

describe("chatStore", () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: [],
      activeConversation: undefined,
      composer: "",
      sending: false,
      activeStreamId: undefined,
      agentMode: false,
      agentToolCalls: [],
    });
  });

  it("has correct initial state", () => {
    const state = useChatStore.getState();
    expect(state.conversations).toEqual([]);
    expect(state.composer).toBe("");
    expect(state.sending).toBe(false);
    expect(state.agentMode).toBe(false);
  });

  it("sets composer text", () => {
    useChatStore.getState().setComposer("Hello world");
    expect(useChatStore.getState().composer).toBe("Hello world");
  });

  it("toggles agent mode", () => {
    useChatStore.getState().toggleAgentMode();
    expect(useChatStore.getState().agentMode).toBe(true);
    useChatStore.getState().toggleAgentMode();
    expect(useChatStore.getState().agentMode).toBe(false);
  });

  it("refreshes conversations", async () => {
    await useChatStore.getState().refreshConversations();
    expect(useChatStore.getState().conversations).toHaveLength(1);
    expect(useChatStore.getState().conversations[0].id).toBe("c1");
  });

  it("loads a conversation", async () => {
    await useChatStore.getState().loadConversation("c1");
    const state = useChatStore.getState();
    expect(state.activeConversation).toBeDefined();
    expect(state.activeConversation?.conversation.id).toBe("c1");
  });

  it("handles stream event — delta", () => {
    useChatStore.setState({
      activeConversation: {
        conversation: { id: "c1", title: "Test", createdAt: "", updatedAt: "", pinned: false },
        messages: [{ id: "m1", conversationId: "c1", role: "assistant", content: "Hello", status: "streaming", createdAt: "", updatedAt: "" }],
      },
      sending: true,
    });

    useChatStore.getState().handleStreamEvent({
      kind: "delta",
      messageId: "m1",
      textDelta: " world",
    });

    const msg = useChatStore.getState().activeConversation?.messages[0];
    expect(msg?.content).toBe("Hello world");
  });

  it("handles stream event — completed", () => {
    useChatStore.setState({
      activeConversation: {
        conversation: { id: "c1", title: "Test", createdAt: "", updatedAt: "", pinned: false },
        messages: [{ id: "m1", conversationId: "c1", role: "assistant", content: "Done", status: "streaming", createdAt: "", updatedAt: "" }],
      },
      sending: true,
      activeStreamId: "s1",
    });

    useChatStore.getState().handleStreamEvent({
      kind: "completed",
      messageId: "m1",
    });

    expect(useChatStore.getState().sending).toBe(false);
    expect(useChatStore.getState().activeStreamId).toBeUndefined();
  });

  it("handles agent event — tool_call", () => {
    useChatStore.getState().handleAgentEvent({
      kind: "tool_call",
      toolName: "read_file",
      toolArgs: '{"path": "/tmp"}',
    });

    const calls = useChatStore.getState().agentToolCalls;
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe("read_file");
    expect(calls[0].isRunning).toBe(true);
  });

  it("handles agent event — tool_result", () => {
    useChatStore.setState({
      agentToolCalls: [{ toolName: "read_file", args: "{}", isRunning: true }],
    });

    useChatStore.getState().handleAgentEvent({
      kind: "tool_result",
      toolResult: "file contents",
      toolSuccess: true,
    });

    const calls = useChatStore.getState().agentToolCalls;
    expect(calls[0].isRunning).toBe(false);
    expect(calls[0].result).toBe("file contents");
    expect(calls[0].success).toBe(true);
  });

  it("stops a stream", async () => {
    useChatStore.setState({ sending: true, activeStreamId: "s1" });
    await useChatStore.getState().stopStream();
    expect(useChatStore.getState().sending).toBe(false);
    expect(useChatStore.getState().activeStreamId).toBeUndefined();
  });

  it("stopStream does nothing without active stream", async () => {
    useChatStore.setState({ sending: false, activeStreamId: undefined });
    await useChatStore.getState().stopStream();
    expect(useChatStore.getState().sending).toBe(false);
  });
});
