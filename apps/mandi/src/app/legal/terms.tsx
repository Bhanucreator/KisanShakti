/**
 * Terms of Service — Mandi (buyer app). Mirrors Upaj's terms with the
 * copy tuned for buyers/traders. Play requires this reachable in-app.
 */
import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { COLORS, SPACING } from '../../constants/theme';

export default function TermsScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={22} color={COLORS.textDark} />
        </TouchableOpacity>
        <Text style={styles.title}>Terms of Service</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.updated}>Last updated: 14 September 2026</Text>

        <Section title="1. What Mandi is" titleKn="೧. ಮಂಡಿ ಏನು">
          Mandi (the "app") lets registered agricultural buyers browse crop
          listings posted by farmers on KisanShakti, make offers, and
          coordinate pickup/delivery. The app is free during the beta.
        </Section>

        <Section title="2. Who can use it" titleKn="೨. ಬಳಸಬಹುದಾದವರು">
          You must be at least 18 years old and be a legitimate agricultural
          buyer, trader, or retailer operating in India. By signing in with
          your phone number you confirm the number belongs to you.
        </Section>

        <Section title="3. Listings are farmer-authored" titleKn="೩. ಪಟ್ಟಿಗಳು ರೈತ-ರಚಿತ">
          Crop details, prices, quantities and photos are posted by the
          farmer. Verify quality, quantity and price at pickup. Mandi
          surfaces farmer reputation (ratings + past sales) but is not a
          quality-inspection service.
        </Section>

        <Section title="4. Your offers" titleKn="೪. ನಿಮ್ಮ ಆಫರ್‌ಗಳು">
          When a farmer accepts your offer, you commit to picking up the
          crop at the agreed price. Withdrawing an accepted offer without
          reason will affect your reputation with farmers.
        </Section>

        <Section title="5. Delivery + OTP" titleKn="೫. ವಿತರಣೆ + ಒಟಿಪಿ">
          On delivery, enter the 4-digit OTP the farmer shares — this
          confirms both parties are physically present and the goods
          changed hands. Payment terms are between you and the farmer;
          Mandi does not currently handle payments.
        </Section>

        <Section title="6. Acceptable use" titleKn="೬. ಸ್ವೀಕಾರಾರ್ಹ ಬಳಕೆ">
          You may not: attempt to access other buyers' or farmers' data;
          spam farmers with lowball offers to distort a listing; scrape
          the app or backend; or misrepresent your business.
        </Section>

        <Section title="7. Suspension and termination" titleKn="೭. ಖಾತೆ ಅಮಾನತು">
          We may suspend buyer accounts we believe are abusing the platform.
          You can delete your account any time from Profile → Delete my
          account — irreversible and removes all your offers and history.
        </Section>

        <Section title="8. Warranty disclaimer" titleKn="೮. ಖಾತ್ರಿ ನಿರಾಕರಣೆ">
          The app is provided "as is". Prices, availability and listing
          contents are provided by farmers or aggregated from public
          government feeds — we do not guarantee accuracy.
        </Section>

        <Section title="9. Governing law" titleKn="೯. ಕಾನೂನು">
          These terms are governed by the laws of India.
          Contact: support@kisanshakti.in.
        </Section>

        <Text style={styles.footer}>
          By continuing to use Mandi, you agree to these terms.
          {'\n'}
          ಮಂಡಿ ಬಳಸುವುದರಿಂದ ನೀವು ಈ ನಿಯಮಗಳಿಗೆ ಸಮ್ಮತಿಸುತ್ತೀರಿ.
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
