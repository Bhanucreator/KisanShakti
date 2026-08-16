import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Switch, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';

const SHOP_TYPES = [
  { key: 'KIRANA',     label: 'Kirana Store',  labelKn: 'ಕಿರಾಣಾ ಅಂಗಡಿ', icon: '🏪' },
  { key: 'RESTAURANT', label: 'Restaurant',    labelKn: 'ಹೋಟೆಲ್',       icon: '🍽️' },
  { key: 'WHOLESALER', label: 'Wholesaler',    labelKn: 'ಸಗಟು ವ್ಯಾಪಾರ',  icon: '🏭' },
  { key: 'CANTEEN',    label: 'Canteen',       labelKn: 'ಕ್ಯಾಂಟೀನ್',     icon: '🥘' },
];

const RADIUS_OPTIONS = [5, 10, 15, 25];

const API_BASE = 'http://10.0.2.2:8000';

export default function OnboardingScreen() {
  const [shopType, setShopType]     = useState<string | null>(null);
  const [radius, setRadius]         = useState(10);
  const [notifications, setNotif]   = useState(true);
  const [loading, setLoading]       = useState(false);

  const saveAndContinue = async () => {
    if (!shopType) { Alert.alert('Please select your business type'); return; }
    setLoading(true);
    try {
      await AsyncStorage.setItem('buyer_prefs', JSON.stringify({ shopType, radius, notifications }));
      // POST to backend to persist preferences
      await fetch(`${API_BASE}/api/v1/buyers/preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_type: shopType, sourcing_radius_km: radius }),
      }).catch(() => {}); // non-blocking, offline-safe
      router.replace('/(tabs)');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>

        {/* Hero */}
        <View style={styles.hero}>
          <Text style={styles.logo}>🌿 KisanShakti Mandi</Text>
          <Text style={styles.heroTitle}>Welcome, Buyer!</Text>
          <Text style={styles.heroSubtitle}>ಸ್ವಾಗತ! ನಿಮ್ಮ ಆದ್ಯತೆಗಳನ್ನು ಹೊಂದಿಸಿ.</Text>
          <Text style={styles.heroCaption}>Set your preferences to discover fresh produce near you.</Text>
        </View>

        {/* Business Type */}
        <Text style={styles.sectionTitle}>Business Type · ವ್ಯವಹಾರ ವಿಧ</Text>
        <View style={styles.shopGrid}>
          {SHOP_TYPES.map((s) => (
            <TouchableOpacity
              key={s.key}
              style={[styles.shopCard, shopType === s.key && styles.shopCardSelected]}
              onPress={() => setShopType(s.key)}
            >
              <Text style={styles.shopIcon}>{s.icon}</Text>
              <Text style={[styles.shopLabel, shopType === s.key && styles.shopLabelSelected]}>{s.label}</Text>
              <Text style={[styles.shopLabelKn, shopType === s.key && styles.shopLabelSelected]}>{s.labelKn}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Sourcing Radius */}
        <Text style={styles.sectionTitle}>Sourcing Radius · ಸರಬರಾಜು ದೂರ</Text>
        <View style={styles.radiusRow}>
          {RADIUS_OPTIONS.map((r) => (
            <TouchableOpacity
              key={r}
              style={[styles.radiusBtn, radius === r && styles.radiusBtnSelected]}
              onPress={() => setRadius(r)}
            >
              <Text style={[styles.radiusBtnText, radius === r && styles.radiusBtnTextSel]}>{r}</Text>
              <Text style={[styles.radiusBtnKm, radius === r && styles.radiusBtnTextSel]}>km</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.radiusHint}>
          You'll see listings within <Text style={{ fontWeight: '700' }}>{radius} km</Text> of your location.
        </Text>

        {/* Notifications */}
        <View style={styles.notifRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.notifLabel}>New Listing Alerts</Text>
            <Text style={styles.notifLabelKn}>ಹೊಸ ಪಟ್ಟಿ ಎಚ್ಚರಿಕೆಗಳು</Text>
          </View>
          <Switch
            value={notifications}
            onValueChange={setNotif}
            trackColor={{ true: '#1B4332' }}
            thumbColor={notifications ? '#2D6A4F' : '#D1D5DB'}
          />
        </View>

        {/* CTA */}
        <TouchableOpacity
          style={[styles.ctaBtn, (!shopType || loading) && styles.ctaBtnDisabled]}
          onPress={saveAndContinue}
          disabled={!shopType || loading}
        >
          <Text style={styles.ctaBtnText}>
            {loading ? 'Saving…' : '✅  Start Sourcing · ಮುಂದುವರಿಯಿರಿ'}
          </Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:                   { flex: 1, backgroundColor: '#F8F9FA' },
  scroll:                 { padding: 24, paddingBottom: 48 },

  hero:                   { alignItems: 'center', marginBottom: 32 },
  logo:                   { fontSize: 15, fontWeight: '600', color: '#2D6A4F', marginBottom: 16 },
  heroTitle:              { fontSize: 30, fontWeight: '800', color: '#1B4332' },
  heroSubtitle:           { fontSize: 14, color: '#2D6A4F', marginTop: 4 },
  heroCaption:            { fontSize: 13, color: '#6B7280', textAlign: 'center', marginTop: 8, lineHeight: 20 },

  sectionTitle:           { fontSize: 15, fontWeight: '700', color: '#1B4332', marginBottom: 12 },

  shopGrid:               { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 24 },
  shopCard:               { width: '46%', backgroundColor: '#FFF', borderRadius: 16, padding: 16, alignItems: 'center', borderWidth: 2, borderColor: '#E5E7EB', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  shopCardSelected:       { borderColor: '#1B4332', backgroundColor: '#F0FDF4' },
  shopIcon:               { fontSize: 32, marginBottom: 8 },
  shopLabel:              { fontSize: 13, fontWeight: '700', color: '#374151', textAlign: 'center' },
  shopLabelSelected:      { color: '#1B4332' },
  shopLabelKn:            { fontSize: 11, color: '#9CA3AF', marginTop: 2, textAlign: 'center' },

  radiusRow:              { flexDirection: 'row', gap: 10, marginBottom: 10 },
  radiusBtn:              { flex: 1, backgroundColor: '#FFF', borderWidth: 2, borderColor: '#E5E7EB', borderRadius: 12, padding: 12, alignItems: 'center' },
  radiusBtnSelected:      { borderColor: '#1B4332', backgroundColor: '#1B4332' },
  radiusBtnText:          { fontSize: 22, fontWeight: '800', color: '#374151' },
  radiusBtnTextSel:       { color: '#FFF' },
  radiusBtnKm:            { fontSize: 11, color: '#9CA3AF', marginTop: 2 },
  radiusHint:             { fontSize: 12, color: '#6B7280', marginBottom: 24 },

  notifRow:               { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 14, padding: 16, marginBottom: 28, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  notifLabel:             { fontSize: 14, fontWeight: '700', color: '#1B4332' },
  notifLabelKn:           { fontSize: 11, color: '#9CA3AF', marginTop: 2 },

  ctaBtn:                 { backgroundColor: '#1B4332', borderRadius: 16, padding: 20, alignItems: 'center' },
  ctaBtnDisabled:         { opacity: 0.5 },
  ctaBtnText:             { color: '#FFF', fontWeight: '800', fontSize: 17 },
});
