/**
 * Privacy Policy — Mandi (buyer app). Mirrors Upaj's policy with the
 * data-collected list tuned to buyer flows.
 */
import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { COLORS, SPACING } from '../../constants/theme';

export default function PrivacyScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={22} color={COLORS.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>Privacy Policy</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.updated}>Last updated: 14 September 2026</Text>

        <Section title="What we collect" titleKn="ನಾವು ಸಂಗ್ರಹಿಸುವ ವಿಷಯ">
          To make Mandi work for you, we collect:
          {'\n'}• Phone number — to sign you in via OTP
          {'\n'}• Shop name and shop type — shown to farmers when you make an offer
          {'\n'}• Sourcing radius (km) — used to filter which listings you see
          {'\n'}• GPS location — for nearest-listing ranking (only when the app is open)
          {'\n'}• Offers you place + orders you complete
        </Section>

        <Section title="Why we collect it" titleKn="ಏಕೆ ಸಂಗ್ರಹಿಸುತ್ತೇವೆ">
          • Sign-in via phone + OTP
          {'\n'}• Match you with farmer listings inside your sourcing radius
          {'\n'}• Notify you about offer acceptances, delivery status and rating requests
        </Section>

        <Section title="Who can see it" titleKn="ಯಾರು ನೋಡಬಹುದು">
          • YOU — always, everything under your account.
          {'\n'}• Farmers whose listings you offer on — see your shop name, shop type, and (after acceptance) your phone number.
          {'\n'}• Nobody else. We do not sell your data. We do not share it with any third party for marketing.
        </Section>

        <Section title="Where it's stored" titleKn="ಎಲ್ಲಿ ಸಂಗ್ರಹಿಸಲಾಗಿದೆ">
          Servers operated by us in India. Daily encrypted backups.
        </Section>

        <Section title="How long we keep it" titleKn="ಎಷ್ಟು ಕಾಲ ಇಡುತ್ತೇವೆ">
          Until you delete your account. Tap Profile → Delete my account
          to irreversibly remove your buyer profile, all offers, ratings
          you gave, and notification history within seconds.
        </Section>

        <Section title="Your rights" titleKn="ನಿಮ್ಮ ಹಕ್ಕುಗಳು">
          • ACCESS: everything about you is visible in the app.
          {'\n'}• EDIT: change shop name, type, sourcing radius any time from Profile.
          {'\n'}• DELETE: Profile → Delete my account. Irreversible.
          {'\n'}• EXPORT: email support@kisanshakti.in for a JSON dump within 7 days.
        </Section>

        <Section title="Permissions we ask for" titleKn="ಅನುಮತಿಗಳು">
          • LOCATION: for nearest-listing ranking (only while the app is open)
          {'\n'}• NOTIFICATIONS: for offer status, delivery updates
          {'\n\n'}
          You can revoke either in Android Settings → Apps → Mandi.
        </Section>

        <Section title="Contact" titleKn="ಸಂಪರ್ಕ">
          Privacy questions or takedown: support@kisanshakti.in.
          {'\n'}Response within 3 working days.
        </Section>

        <Text style={styles.footer}>
          By using Mandi you consent to the data practices described here.
          {'\n'}
          ಮಂಡಿ ಬಳಸುವುದರಿಂದ ನೀವು ಈ ಗೌಪ್ಯತಾ ಅಭ್ಯಾಸಗಳಿಗೆ ಸಮ್ಮತಿಸುತ್ತೀರಿ.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, titleKn, children }: { title: string; titleKn?: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {titleKn ? <Text style={styles.sectionTitleKn}>{titleKn}</Text> : null}
      <Text style={styles.body}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: COLORS.bgApp },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
    backgroundColor: COLORS.bgCard,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  title:   { fontSize: 17, fontWeight: '800', color: COLORS.textDark },
  scroll:  { padding: SPACING.xl, paddingBottom: 60 },
  updated: { fontSize: 11, color: COLORS.textMuted, marginBottom: 20 },
  section: { marginBottom: 22 },
  sectionTitle:   { fontSize: 14, fontWeight: '800', color: COLORS.textDark, marginBottom: 2 },
  sectionTitleKn: { fontSize: 12, fontWeight: '700', color: COLORS.textBody, marginBottom: 8 },
  body:    { fontSize: 12, color: COLORS.textBody, lineHeight: 18 },
  footer:  { marginTop: 20, fontSize: 11, fontWeight: '600', color: COLORS.textMuted, textAlign: 'center', lineHeight: 16 },
});
