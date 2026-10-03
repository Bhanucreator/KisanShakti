/**
 * useAuth — offline-first auth backed by local SQLite.
 *
 * The farmer profile (with auth token) lives in `farmer_profile` in the local
 * SQLite DB. This means the user stays signed in even without internet, and
 * the profile survives reinstall (via device backup, on OS-supported paths).
 *
 * `isAuthenticated = onboarded && token exists`
 * `isOnboarded` alone indicates profile-collection is complete (post-OTP).
 */

import { useState, useEffect, useCallback } from 'react';
import {
  getFarmerProfile,
  upsertFarmerProfile,
  signOutLocal,
  FarmerProfile,
} from '../lib/local-db';

// Bump this to force existing users to redo onboarding
const AUTH_MIGRATION_KEY = 'auth_migration';
const CURRENT_MIGRATION = '3';

interface AuthState {
  profile:         FarmerProfile | null;
  token:           string | null;
  farmerId:        string | null;
  farmerName:      string | null;
  phone:           string | null;
  isLoading:       boolean;
  isAuthenticated: boolean;   // has token + onboarded
  isOnboarded:     boolean;   // has profile with name+location
}

interface UseAuth extends AuthState {
  signIn: (input: {
    token: string;
    server_id: string;
    phone: string;
    name?: string;
  }) => Promise<void>;
  updateProfile: (updates: Partial<{
    name: string;
    location_name: string;
    latitude: number;
    longitude: number;
    total_land_ha: number;
    cattle_count: number;
    onboarded: boolean;
  }>) => Promise<void>;
  signOut: () => Promise<void>;
  reload:  () => Promise<void>;
}

const EMPTY: AuthState = {
  profile: null, token: null, farmerId: null, farmerName: null, phone: null,
  isLoading: true, isAuthenticated: false, isOnboarded: false,
};

export function useAuth(): UseAuth {
  const [state, setState] = useState<AuthState>(EMPTY);

  const reload = useCallback(async () => {
    try {
      const profile = await getFarmerProfile();
      if (!profile) {
        setState({ ...EMPTY, isLoading: false });
        return;
      }
      setState({
        profile,
        token:           profile.auth_token,
        farmerId:        profile.server_id ?? profile.id,
        farmerName:      profile.name || null,
        phone:           profile.phone,
        isLoading:       false,
        isAuthenticated: !!profile.auth_token && profile.onboarded,
        isOnboarded:     profile.onboarded,
      });
    } catch (e) {
      console.error('[useAuth] reload failed:', e);
      setState({ ...EMPTY, isLoading: false });
    }
  }, []);

  useEffect(() => {
    (async () => {
      // One-time migration: clear any legacy AsyncStorage auth left over
      // from the pre-SQLite build so users start fresh.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        const v = await AsyncStorage.getItem(AUTH_MIGRATION_KEY);
        if (v !== CURRENT_MIGRATION) {
          await AsyncStorage.multiRemove([
            'auth_token', 'farmer_id', 'farmer_name', 'farmer_phone', 'auth_version',
          ]);
          await AsyncStorage.setItem(AUTH_MIGRATION_KEY, CURRENT_MIGRATION);
        }
      } catch {}
      await reload();
    })();
  }, [reload]);

  const signIn = useCallback(async (input: {
    token: string; server_id: string; phone: string; name?: string;
  }) => {
    // Preserve existing local data if this phone is already registered on
    // this device — only inject token + server_id. Existing name, location,
    // land, crops, onboarded flag stay untouched.
    const existing = await getFarmerProfile();
    const isSamePhone = existing?.phone === input.phone;

    await upsertFarmerProfile({
      phone:      input.phone,
      server_id:  input.server_id,
      auth_token: input.token,
      // Only set name / onboarded if this is a fresh device or new phone
      ...(isSamePhone
        ? {}
        : { name: input.name ?? '', onboarded: false }),
    });
    await reload();
  }, [reload]);

  const updateProfile = useCallback(async (updates: any) => {
    const current = await getFarmerProfile();
    if (!current) return;
    await upsertFarmerProfile({
      phone: current.phone,
      ...updates,
    });
    await reload();
  }, [reload]);

  const signOut = useCallback(async () => {
    // Clear per-user AsyncStorage caches so the NEXT farmer to sign in on
    // this device doesn't see the previous farmer's last disease scan,
    // cached crop suggestions, dismissed banners, etc. This is critical
    // on shared devices (family farm phone, community demo phone).
    try {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      await AsyncStorage.multiRemove([
        'disease:last_scan_v1',
      ]);
      // Also wipe the physical scan photos we saved to documentDirectory
      // so the image files don't linger for the next user to Read.
      try {
        const FileSystem = require('expo-file-system');
        const dir = FileSystem.documentDirectory;
        if (dir) {
          const files = await FileSystem.readDirectoryAsync(dir);
          await Promise.all(
            files
              .filter((f: string) => f.startsWith('scan_') && f.endsWith('.jpg'))
              .map((f: string) => FileSystem.deleteAsync(`${dir}${f}`, { idempotent: true }))
          );
        }
      } catch (_) { /* best-effort cleanup */ }
    } catch (e) {
      console.warn('[useAuth] per-user cache clear failed:', e);
    }
    await signOutLocal();
    await reload();
  }, [reload]);

  return { ...state, signIn, updateProfile, signOut, reload };
}
