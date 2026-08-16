import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADII, SHADOWS, FONT_SIZES } from '../constants/theme';
import { router } from 'expo-router';

type Message = {
  id: string;
  sender: 'buyer' | 'farmer';
  text: string;
  time: string;
};

const INITIAL_MESSAGES: Message[] = [
  {
    id: '1', sender: 'buyer',
    text: "Hello Raju, I'm interested in 50 kg Tomato. Can you do ₹18/kg?",
    time: '5m ago',
  },
  {
    id: '2', sender: 'farmer',
    text: 'Hello Anil, I can do ₹19/kg. Price is a bit low today.',
    time: '3m ago',
  },
  {
    id: '3', sender: 'buyer',
    text: 'Okay, ₹19/kg works for me.',
    time: '2m ago',
  },
  {
    id: '4', sender: 'farmer',
    text: "Great! Let's confirm the order.",
    time: 'Just now',
  },
];

export default function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [inputText, setInputText] = useState('');

  const sendMessage = () => {
    if (!inputText.trim()) return;
    const newMsg: Message = {
      id: String(Date.now()),
      sender: 'buyer',
      text: inputText.trim(),
      time: 'Just now',
    };
    setMessages((prev) => [...prev, newMsg]);
    setInputText('');
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── Top Header ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textDark} />
        </TouchableOpacity>
        <View style={{ marginLeft: 12, flex: 1 }}>
          <Text style={styles.title}>50 kg Tomato</Text>
          <Text style={styles.subtitle}>from Raju S.</Text>
        </View>
        <View style={styles.pendingBadge}>
          <Text style={styles.pendingText}>PENDING</Text>
        </View>
      </View>

      {/* ── Negotiation Summary Bar ── */}
      <View style={styles.summaryBar}>
        <View style={styles.summaryBlock}>
          <Text style={styles.summaryLabel}>Your Offer</Text>
          <Text style={[styles.summaryVal, { color: COLORS.primaryDark }]}>₹18</Text>
        </View>
        <View style={styles.summaryBlock}>
          <Text style={styles.summaryLabel}>Farmer Ask</Text>
          <Text style={styles.summaryVal}>₹20</Text>
        </View>
        <View style={styles.summaryBlock}>
          <Text style={styles.summaryLabel}>Gap</Text>
          <Text style={[styles.summaryVal, { color: COLORS.accentRed }]}>₹2</Text>
        </View>
      </View>

      <View style={styles.timeTagRow}>
        <Ionicons name="time-outline" size={13} color={COLORS.textMuted} />
        <Text style={styles.timeTagText}>5m ago</Text>
      </View>

      {/* ── Chat Messages ── */}
      <ScrollView contentContainerStyle={styles.chatScroll} showsVerticalScrollIndicator={false}>
        {messages.map((m) => {
          const isBuyer = m.sender === 'buyer';
          return (
            <View
              key={m.id}
              style={[
                styles.bubbleContainer,
                isBuyer ? styles.bubbleRight : styles.bubbleLeft,
              ]}
            >
              <View
                style={[
                  styles.bubble,
                  isBuyer ? styles.bubbleBuyer : styles.bubbleFarmer,
                ]}
              >
                <Text
                  style={[
                    styles.bubbleText,
                    isBuyer ? styles.bubbleTextBuyer : styles.bubbleTextFarmer,
                  ]}
                >
                  {m.text}
                </Text>
                <View style={styles.bubbleFooter}>
                  <Text
                    style={[
                      styles.bubbleTime,
                      isBuyer ? styles.bubbleTimeBuyer : styles.bubbleTimeFarmer,
                    ]}
                  >
                    {m.time}
                  </Text>
                  {isBuyer && <Ionicons name="checkmark-done" size={14} color={COLORS.primaryDark} />}
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* ── Input Bar ── */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.inputBar}>
          <TextInput
            style={styles.textInput}
            placeholder="Type a message..."
            placeholderTextColor={COLORS.textMuted}
            value={inputText}
            onChangeText={setInputText}
          />
          <TouchableOpacity style={styles.sendBtn} onPress={sendMessage} activeOpacity={0.8}>
            <Ionicons name="paper-plane" size={18} color={COLORS.textWhite} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bgApp },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.xl, paddingTop: 16, paddingBottom: 12 },
  title: { fontSize: 18, fontWeight: '800', color: COLORS.textDark },
  subtitle: { fontSize: 11, color: COLORS.textMuted, marginTop: 1 },
  pendingBadge: { backgroundColor: '#FEF3C7', paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADII.pill },
  pendingText: { fontSize: 10, fontWeight: '800', color: COLORS.accentAmber },

  // Summary Bar
  summaryBar: {
    flexDirection: 'row', backgroundColor: COLORS.bgCard,
    borderRadius: RADII.lg, padding: SPACING.md, marginHorizontal: SPACING.xl,
    borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.card,
  },
  summaryBlock: { flex: 1, alignItems: 'center' },
  summaryLabel: { fontSize: 10, color: COLORS.textMuted, fontWeight: '600' },
  summaryVal: { fontSize: 16, fontWeight: '800', marginTop: 2 },
  timeTagRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginHorizontal: SPACING.xl, marginTop: 8, marginBottom: 12 },
  timeTagText: { fontSize: 11, color: COLORS.textMuted, fontWeight: '600' },

  // Chat Scroll
  chatScroll: { paddingHorizontal: SPACING.xl, paddingBottom: 20 },
  bubbleContainer: { width: '100%', marginBottom: 12 },
  bubbleRight: { alignItems: 'flex-end' },
  bubbleLeft: { alignItems: 'flex-start' },
  bubble: { maxWidth: '82%', borderRadius: RADII.lg, padding: SPACING.md, ...SHADOWS.card },
  bubbleBuyer: { backgroundColor: '#E8F5E9', borderBottomRightRadius: 4 },
  bubbleFarmer: { backgroundColor: COLORS.bgCard, borderWidth: 1, borderColor: COLORS.border, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 13, lineHeight: 18 },
  bubbleTextBuyer: { color: COLORS.primaryDark, fontWeight: '600' },
  bubbleTextFarmer: { color: COLORS.textDark },
  bubbleFooter: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 4, marginTop: 4 },
  bubbleTime: { fontSize: 10 },
  bubbleTimeBuyer: { color: COLORS.primary },
  bubbleTimeFarmer: { color: COLORS.textMuted },

  // Input Bar
  inputBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.bgCard, paddingHorizontal: SPACING.xl, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  textInput: {
    flex: 1, backgroundColor: COLORS.bgSubtle, borderRadius: RADII.pill,
    paddingHorizontal: 16, paddingVertical: 10, fontSize: 13, color: COLORS.textDark,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: COLORS.primaryDark, justifyContent: 'center', alignItems: 'center',
    ...SHADOWS.card,
  },
});
