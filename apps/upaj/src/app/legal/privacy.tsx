/**
 * Privacy Policy — plain-language, farmer-first, bilingual.
 *
 * Play Store requires this to be readable both in-app AND at a public URL
 * (put the same content on a static site and set the URL on the app
 * listing before submitting to review).
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
          To make KisanShakti work for you, we collect:
          {'\n'}• Phone number — to sign you in via OTP
          {'\n'}• Full name and village/district — shown to buyers when they see your listings
          {'\n'}• Farm details — total land, cattle, crops you grow
          {'\n'}• Plot GPS location — for weather forecasts and matching with nearby buyers
          {'\n'}• Crop listings and offers you create
          {'\n'}• Ledger entries you type (income/expense per plot)
          {'\n'}• Photos you upload (crops)
          {'\n'}• If paired: ESP32 sensor readings (soil moisture, temperature, humidity, rain, battery voltage)
          {'\n\n'}
          The disease-detection AI runs entirely on your phone — the leaf
          photo you scan never leaves the device.
          {'\n\n'}
          ರೋಗ ಪತ್ತೆ ಎಐ ಸಂಪೂರ್ಣವಾಗಿ ನಿಮ್ಮ ಫೋನ್‌ನಲ್ಲಿ ಚಲಿಸುತ್ತದೆ — ಎಲೆಯ ಫೋಟೋ ಸರ್ವರ್‌ಗೆ ಹೋಗುವುದಿಲ್ಲ.
        </Section>

        <Section title="Why we collect it" titleKn="ಏಕೆ ಸಂಗ್ರಹಿಸುತ್ತೇವೆ">
          • Sign-in and identity verification (phone + OTP)
          {'\n'}• Match your listings with buyers within your delivery radius
          {'\n'}• Show accurate weather and irrigation advice for your plot
          {'\n'}• Persist your ledger, plots, cycles and sensor history so you can see them from any device
          {'\n'}• Send you notifications about offers, deliveries and payments (in-app)
        </Section>

        <Section title="Who can see it" titleKn="ಯಾರು ನೋಡಬಹುದು">
          • YOU — always, everything under your account.
          {'\n'}• Buyers who view your listings — see your name, village, listing details and (only after a completed sale) your phone number.
          {'\n'}• Nobody else. We do not sell your data. We do not share it with any third party for marketing.
          {'\n'}• Backend engineers (currently one person) may see rows during debugging but never export or share them.
        </Section>

        <Section title="Where it's stored" titleKn="ಎಲ್ಲಿ ಸಂಗ್ರಹಿಸಲಾಗಿದೆ">
          Data lives on servers we operate in India. Backup snapshots are
          taken daily and encrypted at rest. Uploaded photos are kept on
          the same servers, not on a third-party CDN.
        </Section>

        <Section title="How long we keep it" titleKn="ಎಷ್ಟು ಕಾಲ ಇಡುತ್ತೇವೆ">
          Until you delete your account. Once you tap "Delete my account" in
          the Profile screen, your farmer profile, listings, offers, plots,
          ledger, sensor devices and readings, notifications and stored
          crops are irreversibly removed within seconds. Photos you uploaded
          are removed alongside the listing they belong to.
        </Section>

        <Section title="Your rights" titleKn="ನಿಮ್ಮ ಹಕ್ಕುಗಳು">
          • RIGHT TO ACCESS: everything we store about you is visible in the
          app — no separate request needed.
          {'\n'}• RIGHT TO EDIT: change your profile, delete listings, edit
          ledger entries any time.
          {'\n'}• RIGHT TO DELETE: tap Profile → Delete my account. Immediate,
          irreversible cascade.
          {'\n'}• RIGHT TO EXPORT: email support@kisanshakti.in and we will
          send a JSON dump of your data within 7 days.
        </Section>

        <Section title="Children" titleKn="ಮಕ್ಕಳಿಗೆ">
          KisanShakti is not intended for anyone under 18. We do not
          knowingly collect data from minors.
        </Section>

        <Section title="Permissions we ask for" titleKn="ಅನುಮತಿಗಳು">
          • LOCATION: for accurate weather + nearby-market matching
          {'\n'}• CAMERA / GALLERY: only when you tap "add a photo" for a listing or disease scan
          {'\n'}• BLUETOOTH / NEARBY DEVICES: only when you tap Pair on the Weather tab to connect your ESP32
          {'\n'}• NOTIFICATIONS: to alert you about new offers, delivery status, and weather warnings
          {'\n\n'}
          You can revoke any of these in Android Settings → Apps → KisanShakti.
          The relevant feature will stop working but the rest of the app keeps functioning.
        </Section>

        <Section title="Contact" titleKn="ಸಂಪರ್ಕ">
          Privacy questions or takedown requests: support@kisanshakti.in.
          {'\n'}We respond within 3 working days.
        </Section>

        <Text style={styles.footer}>
          By using KisanShakti you consent to the data practices described here.
          {'\n'}
          ಕಿಸಾನ್‌ಶಕ್ತಿ ಬಳಸುವುದರಿಂದ ನೀವು ಈ ಗೌಪ್ಯತಾ ಅಭ್ಯಾಸಗಳಿಗೆ ಸಮ್ಮತಿಸುತ್ತೀರಿ.
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
  footer: {
    marginTop: 20, fontSize: 11, fontWeight: '600', color: COLORS.textMuted,
    textAlign: 'center', lineHeight: 16,
  },
});
