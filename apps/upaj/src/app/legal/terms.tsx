/**
 * Terms of Service — plain, farmer-first prose in English + Kannada.
 *
 * Play Store requires this to be reachable from inside the app AND linked
 * from the Play listing. We render inline (rather than opening a website)
 * so the terms travel with the APK even offline.
 *
 * Keep the language simple. Real farmers will read this on a 5-inch screen.
 * If you're a lawyer reviewing this file: yes, we know it's not exhaustive.
 * File jurisdictional carve-outs into the version you sign off on before
 * public launch.
 */
import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { COLORS, SPACING, RADII } from '../../constants/theme';

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

        <Section title="1. What KisanShakti is" titleKn="೧. ಕಿಸಾನ್‌ಶಕ್ತಿ ಏನು">
          KisanShakti (the “app”) helps farmers in Karnataka manage crop listings,
          check live mandi prices, monitor field conditions via optional ESP32
          sensors, and communicate with buyers. The app is provided free of
          charge for farmers during the beta period.
          {'\n\n'}
          ಕಿಸಾನ್‌ಶಕ್ತಿ ಕರ್ನಾಟಕದ ರೈತರಿಗೆ ಬೆಳೆ ಪಟ್ಟಿ, ಮಾರುಕಟ್ಟೆ ದರ, ಹೊಲದ ಸಂವೇದಕ
          ಮಾಹಿತಿ ಮತ್ತು ಖರೀದಿದಾರರೊಂದಿಗೆ ಸಂವಹನಕ್ಕೆ ಸಹಾಯ ಮಾಡುತ್ತದೆ.
        </Section>

        <Section title="2. Who can use it" titleKn="೨. ಬಳಸಬಹುದಾದವರು">
          You must be at least 18 years old and be a farmer, farm worker, or
          registered agricultural buyer operating in India. By signing in with
          your phone number you confirm the number belongs to you.
        </Section>

        <Section title="3. Market prices are informational" titleKn="೩. ಮಾರುಕಟ್ಟೆ ದರಗಳು ಮಾಹಿತಿ ಮಾತ್ರ">
          Prices shown in the app come from public sources such as AGMARKNET
          (data.gov.in) and Karnataka's Krishi Marata Vahini. They are best-
          effort snapshots — actual prices at any mandi may differ. KisanShakti
          is not liable for trading decisions you make based on these numbers.
          {'\n\n'}
          Weather forecasts come from Open-Meteo and OpenWeather. Agri-advisory
          messages (irrigation, fungal risk, spray windows) are rule-based
          suggestions — always trust your own field observations first.
        </Section>

        <Section title="4. Your listings and offers" titleKn="೪. ನಿಮ್ಮ ಪಟ್ಟಿ ಮತ್ತು ಆಫರ್‌ಗಳು">
          You are responsible for the accuracy of any crop listing you create
          (quantity, price, location, photos). Buyers who make offers you
          accept are responsible for pickup and payment. Any dispute between
          farmer and buyer is between those parties — the app is a
          discovery/introduction tool, not an escrow service.
        </Section>

        <Section title="5. Sensor data" titleKn="೫. ಸಂವೇದಕ ಡೇಟಾ">
          If you pair a KisanShakti ESP32 sensor, the device pushes soil
          moisture, temperature, humidity, rain and battery readings to our
          servers so you can view them from anywhere. The data is stored under
          your account and only you can read it. See the Privacy Policy for
          detail.
        </Section>

        <Section title="6. Acceptable use" titleKn="೬. ಸ್ವೀಕಾರಾರ್ಹ ಬಳಕೆ">
          You may not: attempt to access other farmers' or buyers' data;
          submit deliberately fabricated listings or offers; reverse-engineer
          the sensor firmware to inject false readings; overload the app or
          backend with automated requests; or use the platform for anything
          not directly related to legitimate farming trade.
        </Section>

        <Section title="7. Suspension and termination" titleKn="೭. ಖಾತೆ ಅಮಾನತು">
          We may suspend accounts we believe are being used to abuse the
          platform. You can delete your account at any time from the Profile
          screen — this is irreversible and removes all your listings, offers,
          plots, ledger and sensor data.
        </Section>

        <Section title="8. Warranty disclaimer" titleKn="೮. ಖಾತ್ರಿ ನಿರಾಕರಣೆ">
          The app is provided "as is". While we work hard to keep it accurate
          and available, we make no guarantee that prices, weather, or
          sensor readings will be error-free or that the app will always be
          reachable.
        </Section>

        <Section title="9. Contact and governing law" titleKn="೯. ಸಂಪರ್ಕ ಮತ್ತು ಕಾನೂನು">
          These terms are governed by the laws of India. Questions or
          disputes: reach us via the Profile → Report a problem link or
          email support@kisanshakti.in.
        </Section>

        <Text style={styles.footer}>
          By continuing to use KisanShakti, you agree to these terms.
          {'\n'}
          ಕಿಸಾನ್‌ಶಕ್ತಿಯನ್ನು ಬಳಸುವುದರಿಂದ ನೀವು ಈ ನಿಯಮಗಳಿಗೆ ಸಮ್ಮತಿಸುತ್ತೀರಿ.
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
