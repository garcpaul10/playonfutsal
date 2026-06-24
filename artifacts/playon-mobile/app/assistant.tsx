import { palette } from "@workspace/brand";
import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { fetch } from "expo/fetch";
import * as Haptics from "expo-haptics";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
};

const SUGGESTIONS = [
  "When's my next game?",
  "How do I register for a league?",
  "What drop-in sessions are coming up?",
  "How do standings work?",
];

export default function AssistantScreen() {
  const { getToken } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  const baseUrl = domain ? `https://${domain}` : "";

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      setInput("");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const userMsg: Message = {
        id: Date.now().toString() + "_user",
        role: "user",
        content: trimmed,
      };

      const assistantId = Date.now().toString() + "_assistant";
      const assistantMsg: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
        streaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);

      try {
        const token = await getToken();
        const response = await fetch(`${baseUrl}/api/assistant`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ message: trimmed }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("text/event-stream") && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let accumulated = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6);
                if (data === "[DONE]") break;
                try {
                  const parsed = JSON.parse(data);
                  const delta = parsed.delta?.text || parsed.choices?.[0]?.delta?.content || "";
                  accumulated += delta;
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId ? { ...m, content: accumulated } : m
                    )
                  );
                } catch {}
              }
            }
          }
        } else {
          const data = await response.json();
          const content =
            data.response ||
            data.message ||
            data.content ||
            data.text ||
            "I'm sorry, I couldn't get a response. Please try again.";
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content } : m
            )
          );
        }
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content:
                    "Sorry, I couldn't connect right now. Please check your connection and try again.",
                }
              : m
          )
        );
      } finally {
        setIsStreaming(false);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false } : m
          )
        );
      }
    },
    [getToken, baseUrl, isStreaming]
  );

  const renderMessage = ({ item }: { item: Message }) => {
    const isUser = item.role === "user";
    return (
      <View
        style={[
          styles.msgRow,
          isUser ? styles.msgRowUser : styles.msgRowAssistant,
        ]}
      >
        {!isUser && (
          <View style={[styles.botAvatar, { backgroundColor: colors.primary }]}>
            <Text style={styles.botAvatarText}>P</Text>
          </View>
        )}
        <View
          style={[
            styles.bubble,
            isUser
              ? [styles.bubbleUser, { backgroundColor: colors.primary }]
              : [styles.bubbleAssistant, { backgroundColor: colors.card, borderColor: colors.border }],
          ]}
        >
          {item.streaming && !item.content ? (
            <View style={styles.typingRow}>
              <View style={[styles.typingDot, { backgroundColor: colors.mutedForeground }]} />
              <View style={[styles.typingDot, { backgroundColor: colors.mutedForeground }]} />
              <View style={[styles.typingDot, { backgroundColor: colors.mutedForeground }]} />
            </View>
          ) : (
            <Text
              style={[
                styles.bubbleText,
                { color: isUser ? palette.neutral50 : colors.foreground },
              ]}
            >
              {item.content}
            </Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 60}
    >
      {messages.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.primary }]}>
            <Feather name="message-square" size={28} color={palette.neutral50} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            PlayOn AI Assistant
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Ask anything about schedules, standings, registration, or upcoming events.
          </Text>
          <View style={styles.suggestions}>
            {SUGGESTIONS.map((s) => (
              <Pressable
                key={s}
                style={({ pressed }) => [
                  styles.chip,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  pressed && { opacity: 0.7 },
                ]}
                onPress={() => sendMessage(s)}
              >
                <Text style={[styles.chipText, { color: colors.foreground }]}>{s}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          inverted
          contentContainerStyle={[
            styles.list,
            { paddingTop: insets.bottom + 80 },
          ]}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          scrollEnabled={messages.length > 0}
        />
      )}

      {/* Input bar */}
      <View
        style={[
          styles.inputBar,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom || 16,
          },
        ]}
      >
        <TextInput
          ref={inputRef}
          style={[
            styles.textInput,
            { backgroundColor: colors.accent, color: colors.foreground },
          ]}
          value={input}
          onChangeText={setInput}
          placeholder="Ask PlayOn anything..."
          placeholderTextColor={colors.mutedForeground}
          multiline
          maxLength={500}
          onSubmitEditing={() => sendMessage(input)}
          returnKeyType="send"
          blurOnSubmit={false}
        />
        <Pressable
          style={({ pressed }) => [
            styles.sendBtn,
            { backgroundColor: isStreaming || !input.trim() ? colors.muted : colors.primary },
            pressed && { opacity: 0.8 },
          ]}
          onPress={() => sendMessage(input)}
          disabled={isStreaming || !input.trim()}
        >
          {isStreaming ? (
            <ActivityIndicator color={palette.neutral50} size="small" />
          ) : (
            <Feather name="send" size={18} color={palette.neutral50} />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 22, fontFamily: "Outfit_700Bold", textAlign: "center" },
  emptyText: {
    fontSize: 15,
    fontFamily: "Outfit_400Regular",
    textAlign: "center",
    marginTop: 8,
    lineHeight: 22,
    marginBottom: 24,
  },
  suggestions: { width: "100%", gap: 8 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  chipText: { fontSize: 14, fontFamily: "Outfit_500Medium" },
  list: { paddingHorizontal: 16, paddingBottom: 8 },
  msgRow: { marginBottom: 12, flexDirection: "row", alignItems: "flex-end" },
  msgRowUser: { justifyContent: "flex-end" },
  msgRowAssistant: { justifyContent: "flex-start", gap: 8 },
  botAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  botAvatarText: { color: palette.neutral50, fontSize: 13, fontFamily: "Outfit_700Bold" },
  bubble: {
    maxWidth: "78%",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: { borderBottomRightRadius: 4 },
  bubbleAssistant: { borderBottomLeftRadius: 4, borderWidth: 1 },
  bubbleText: { fontSize: 15, fontFamily: "Outfit_400Regular", lineHeight: 22 },
  typingRow: { flexDirection: "row", gap: 4, paddingVertical: 4 },
  typingDot: { width: 6, height: 6, borderRadius: 3 },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    gap: 8,
  },
  textInput: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Outfit_400Regular",
    maxHeight: 120,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});
