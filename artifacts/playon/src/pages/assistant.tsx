import { API_BASE } from "@/lib/api-base";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@clerk/react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Bot, Send, Plus, Trash2, MessageSquare, Loader2, ChevronLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";


interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface Conversation {
  id: number;
  title: string;
  isActive: boolean;
  lastMessageAt: string | null;
  createdAt: string;
  model: string;
}

interface ConversationWithMessages extends Conversation {
  messages: ChatMessage[];
}

function useAssistantApi() {
  const { getToken } = useAuth();

  const authFetch = useCallback(async (url: string, options: RequestInit = {}): Promise<Response> => {
    const token = await getToken();
    return fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
  }, [getToken]);

  const listConversations = useCallback(async (): Promise<Conversation[]> => {
    const res = await authFetch(`${API_BASE}/assistant/conversations`);
    if (!res.ok) throw new Error("Failed to load conversations");
    return res.json();
  }, [authFetch]);

  const createConversation = useCallback(async (): Promise<Conversation> => {
    const res = await authFetch(`${API_BASE}/assistant/conversations`, {
      method: "POST",
      body: JSON.stringify({ title: "New conversation" }),
    });
    if (!res.ok) throw new Error("Failed to create conversation");
    return res.json();
  }, [authFetch]);

  const getConversation = useCallback(async (id: number): Promise<ConversationWithMessages> => {
    const res = await authFetch(`${API_BASE}/assistant/conversations/${id}`);
    if (!res.ok) throw new Error("Failed to load conversation");
    return res.json();
  }, [authFetch]);

  const deleteConversation = useCallback(async (id: number): Promise<void> => {
    const res = await authFetch(`${API_BASE}/assistant/conversations/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to delete conversation");
  }, [authFetch]);

  const sendMessage = useCallback(async (
    conversationId: number,
    message: string,
  ): Promise<{ role: "assistant"; content: string; createdAt: string; conversationId: number; title: string }> => {
    const res = await authFetch(`${API_BASE}/assistant/conversations/${conversationId}/chat`, {
      method: "POST",
      body: JSON.stringify({ message }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? "AI service unavailable");
    }
    return res.json();
  }, [authFetch]);

  return { listConversations, createConversation, getConversation, deleteConversation, sendMessage };
}

// ── Conversation sidebar ───────────────────────────────────────────────────────

function ConversationSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  loading,
}: {
  conversations: Conversation[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onNew: () => void;
  onDelete: (id: number) => void;
  loading: boolean;
}) {
  return (
    <div className="flex flex-col h-full border-r bg-muted/30">
      <div className="p-3 border-b">
        <Button onClick={onNew} size="sm" className="w-full gap-2">
          <Plus className="h-4 w-4" />
          New chat
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {loading && (
            <>
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="h-10 w-full rounded-md" />
            </>
          )}
          {!loading && conversations.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6 px-2">
              No conversations yet. Start a new chat!
            </p>
          )}
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={cn(
                "group flex items-center gap-2 rounded-md px-3 py-2 cursor-pointer text-sm transition-colors hover:bg-accent",
                activeId === conv.id && "bg-accent text-accent-foreground font-medium",
              )}
              onClick={() => onSelect(conv.id)}
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-left min-w-0">{conv.title}</span>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={(e) => e.stopPropagation()}
                    title="Delete conversation"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete this conversation and all messages.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onDelete(conv.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Message bubble ─────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  const isAssistant = message.role === "assistant";
  return (
    <div className={cn("flex gap-3", isAssistant ? "justify-start" : "justify-end")}>
      {isAssistant && (
        <div className="shrink-0 h-8 w-8 rounded-full bg-primary flex items-center justify-center mt-1">
          <Bot className="h-4 w-4 text-primary-foreground" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
          isAssistant
            ? "bg-muted text-foreground rounded-tl-sm"
            : "bg-primary text-primary-foreground rounded-tr-sm",
        )}
      >
        {message.content}
      </div>
    </div>
  );
}

// ── Typing indicator ───────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex gap-3 justify-start">
      <div className="shrink-0 h-8 w-8 rounded-full bg-primary flex items-center justify-center">
        <Bot className="h-4 w-4 text-primary-foreground" />
      </div>
      <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
        <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
        <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
      </div>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyState({ onNew }: { onNew: () => void }) {
  const suggestions = [
    "When is my next game?",
    "How do I register for a camp?",
    "What do I owe?",
    "Show me unpaid registrations",
    "Draft a rainout announcement",
    "What are my assignments this week?",
  ];
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-4">
      <div className="flex flex-col items-center gap-3">
        <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
          <Bot className="h-8 w-8 text-primary" />
        </div>
        <div className="text-center">
          <h2 className="text-xl font-bold">PlayOn Assistant</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Ask me anything about schedules, registrations, payments, or operations.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={onNew}
            className="text-left text-sm px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function AssistantPage() {
  const { toast } = useToast();
  const api = useAssistantApi();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const loadConversations = useCallback(async () => {
    try {
      const convs = await api.listConversations();
      setConversations(convs);
    } catch {
      toast({ title: "Failed to load conversations", variant: "destructive" });
    } finally {
      setLoadingConvs(false);
    }
  }, [api, toast]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const selectConversation = useCallback(async (id: number) => {
    if (id === activeConversationId) return;
    setActiveConversationId(id);
    setLoadingMessages(true);
    setMessages([]);
    try {
      const conv = await api.getConversation(id);
      setMessages(conv.messages);
    } catch {
      toast({ title: "Failed to load conversation", variant: "destructive" });
    } finally {
      setLoadingMessages(false);
    }
  }, [activeConversationId, api, toast]);

  const startNewConversation = useCallback(async () => {
    try {
      const conv = await api.createConversation();
      setConversations((prev) => [conv, ...prev]);
      setActiveConversationId(conv.id);
      setMessages([]);
      textareaRef.current?.focus();
    } catch {
      toast({ title: "Failed to start conversation", variant: "destructive" });
    }
  }, [api, toast]);

  const deleteConversation = useCallback(async (id: number) => {
    try {
      await api.deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConversationId === id) {
        setActiveConversationId(null);
        setMessages([]);
      }
    } catch {
      toast({ title: "Failed to delete conversation", variant: "destructive" });
    }
  }, [activeConversationId, api, toast]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    let conversationId = activeConversationId;

    // If no conversation selected, create one first
    if (!conversationId) {
      try {
        const conv = await api.createConversation();
        setConversations((prev) => [conv, ...prev]);
        setActiveConversationId(conv.id);
        conversationId = conv.id;
      } catch {
        toast({ title: "Failed to start conversation", variant: "destructive" });
        return;
      }
    }

    const userMsg: ChatMessage = {
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);

    try {
      const reply = await api.sendMessage(conversationId, text);
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: reply.content,
        createdAt: reply.createdAt,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Update conversation title if it changed
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, title: reply.title, lastMessageAt: reply.createdAt }
            : c
        )
      );
    } catch (err: any) {
      toast({ title: err.message ?? "Failed to send message", variant: "destructive" });
      // Remove the optimistic user message on failure
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }, [input, sending, activeConversationId, api, toast]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const activeConversation = conversations.find((c) => c.id === activeConversationId);

  return (
    <Layout>
      <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
        {/* Sidebar — hidden on mobile when a conversation is open */}
        <div className={cn(
          "w-64 shrink-0 flex-col h-full transition-all duration-200",
          sidebarOpen ? "flex" : "hidden",
          activeConversationId ? "hidden md:flex" : "flex",
        )}>
          <ConversationSidebar
            conversations={conversations}
            activeId={activeConversationId}
            onSelect={(id) => {
              selectConversation(id);
              setSidebarOpen(false);
            }}
            onNew={startNewConversation}
            onDelete={deleteConversation}
            loading={loadingConvs}
          />
        </div>

        {/* Chat area */}
        <div className="flex flex-col flex-1 min-w-0 h-full">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b bg-background shrink-0">
            {activeConversationId && (
              <button
                className="md:hidden text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setActiveConversationId(null);
                  setMessages([]);
                  setSidebarOpen(true);
                }}
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <Bot className="h-5 w-5 text-primary shrink-0" />
            <span className="font-semibold truncate">
              {activeConversation?.title ?? "PlayOn Assistant"}
            </span>
            {!sidebarOpen && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto hidden md:flex gap-1"
                onClick={startNewConversation}
              >
                <Plus className="h-4 w-4" />
                New chat
              </Button>
            )}
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 px-4 py-6">
            {!activeConversationId && !loadingMessages && (
              <EmptyState onNew={startNewConversation} />
            )}
            {loadingMessages && (
              <div className="space-y-4">
                <Skeleton className="h-12 w-3/4 rounded-2xl" />
                <Skeleton className="h-12 w-1/2 ml-auto rounded-2xl" />
                <Skeleton className="h-16 w-2/3 rounded-2xl" />
              </div>
            )}
            {!loadingMessages && messages.length > 0 && (
              <div className="space-y-4 max-w-3xl mx-auto">
                {messages.map((msg, i) => (
                  <MessageBubble key={i} message={msg} />
                ))}
                {sending && <TypingIndicator />}
                <div ref={messagesEndRef} />
              </div>
            )}
            {!loadingMessages && activeConversationId && messages.length === 0 && !sending && (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
                <Bot className="h-10 w-10 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">Send a message to start the conversation.</p>
              </div>
            )}
          </ScrollArea>

          {/* Input area */}
          <div className="shrink-0 border-t bg-background px-4 py-3">
            <div className="max-w-3xl mx-auto flex gap-2 items-end">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything… (Enter to send, Shift+Enter for newline)"
                className="resize-none min-h-[44px] max-h-32 flex-1"
                rows={1}
                disabled={sending}
              />
              <Button
                onClick={sendMessage}
                disabled={!input.trim() || sending}
                size="icon"
                className="shrink-0 h-11 w-11"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground text-center mt-2">
              AI responses are based on your PlayOn data. Always verify before acting.
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
}
