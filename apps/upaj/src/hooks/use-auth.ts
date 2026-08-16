import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  token:       'auth_token',
  farmerId:    'farmer_id',
  farmerName:  'farmer_name',
  phone:       'farmer_phone',
} as const;

// Bump this to force all existing users back to the login screen — useful
// when we ship UI changes that only appear post-login and users don't have
// a logout button in the older APK they've already installed.
const AUTH_VERSION_KEY = 'auth_version';
const CURRENT_AUTH_VERSION = '2';

interface AuthState {
  token:       string | null;
  farmerId:    string | null;
  farmerName:  string | null;
  phone:       string | null;
  isLoading:   boolean;
  isAuthenticated: boolean;
}

interface UseAuth extends AuthState {
  signIn: (token: string, farmerId: string, name: string, phone: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export function useAuth(): UseAuth {
  const [state, setState] = useState<AuthState>({
    token:           null,
    farmerId:        null,
    farmerName:      null,
    phone:           null,
    isLoading:       true,
    isAuthenticated: false,
  });

  useEffect(() => {
    (async () => {
      try {
        // One-time forced logout when AUTH_VERSION changes
        const storedVersion = await AsyncStorage.getItem(AUTH_VERSION_KEY);
        if (storedVersion !== CURRENT_AUTH_VERSION) {
          await AsyncStorage.multiRemove([
            KEYS.token, KEYS.farmerId, KEYS.farmerName, KEYS.phone,
          ]);
          await AsyncStorage.setItem(AUTH_VERSION_KEY, CURRENT_AUTH_VERSION);
          setState({
            token: null, farmerId: null, farmerName: null, phone: null,
            isLoading: false, isAuthenticated: false,
          });
          return;
        }

        const pairs = await AsyncStorage.multiGet([
          KEYS.token,
          KEYS.farmerId,
          KEYS.farmerName,
          KEYS.phone,
        ]);

        const map: Record<string, string | null> = {};
        for (const [key, value] of pairs) {
          map[key] = value;
        }

        const token = map[KEYS.token];

        setState({
          token,
          farmerId:        map[KEYS.farmerId],
          farmerName:      map[KEYS.farmerName],
          phone:           map[KEYS.phone],
          isLoading:       false,
          isAuthenticated: !!token,
        });
      } catch {
        setState(prev => ({ ...prev, isLoading: false }));
      }
    })();
  }, []);

  const signIn = useCallback(
    async (token: string, farmerId: string, name: string, phone: string) => {
      await AsyncStorage.multiSet([
        [KEYS.token,      token],
        [KEYS.farmerId,   farmerId],
        [KEYS.farmerName, name],
        [KEYS.phone,      phone],
      ]);

      setState({
        token,
        farmerId,
        farmerName:      name,
        phone,
        isLoading:       false,
        isAuthenticated: true,
      });
    },
    [],
  );

  const signOut = useCallback(async () => {
    await AsyncStorage.multiRemove([
      KEYS.token,
      KEYS.farmerId,
      KEYS.farmerName,
      KEYS.phone,
    ]);

    setState({
      token:           null,
      farmerId:        null,
      farmerName:      null,
      phone:           null,
      isLoading:       false,
      isAuthenticated: false,
    });
  }, []);

  return { ...state, signIn, signOut };
}
