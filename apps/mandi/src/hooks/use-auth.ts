import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  TOKEN:     'auth_token',
  BUYER_ID:  'buyer_id',
  NAME:      'buyer_name',
  PHONE:     'buyer_phone',
  SHOP_TYPE: 'buyer_shop_type',
} as const;

interface AuthState {
  token:           string | null;
  buyerId:         string | null;
  buyerName:       string | null;
  phone:           string | null;
  shopType:        string | null;
  isLoading:       boolean;
  isAuthenticated: boolean;
}

interface UseAuthReturn extends AuthState {
  signIn:  (token: string, buyerId: string, name: string, phone: string, shopType: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const [state, setState] = useState<AuthState>({
    token:           null,
    buyerId:         null,
    buyerName:       null,
    phone:           null,
    shopType:        null,
    isLoading:       true,
    isAuthenticated: false,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadStoredAuth() {
      try {
        const [token, buyerId, buyerName, phone, shopType] = await AsyncStorage.multiGet([
          KEYS.TOKEN,
          KEYS.BUYER_ID,
          KEYS.NAME,
          KEYS.PHONE,
          KEYS.SHOP_TYPE,
        ]);

        if (cancelled) return;

        const storedToken = token[1];

        setState({
          token:           storedToken,
          buyerId:         buyerId[1],
          buyerName:       buyerName[1],
          phone:           phone[1],
          shopType:        shopType[1],
          isLoading:       false,
          isAuthenticated: storedToken !== null,
        });
      } catch {
        if (!cancelled) {
          setState(prev => ({ ...prev, isLoading: false }));
        }
      }
    }

    loadStoredAuth();
    return () => { cancelled = true; };
  }, []);

  const signIn = useCallback(async (
    token: string,
    buyerId: string,
    name: string,
    phone: string,
    shopType: string,
  ) => {
    await AsyncStorage.multiSet([
      [KEYS.TOKEN,     token],
      [KEYS.BUYER_ID,  buyerId],
      [KEYS.NAME,      name],
      [KEYS.PHONE,     phone],
      [KEYS.SHOP_TYPE, shopType],
    ]);

    setState({
      token,
      buyerId,
      buyerName:       name,
      phone,
      shopType,
      isLoading:       false,
      isAuthenticated: true,
    });
  }, []);

  const signOut = useCallback(async () => {
    await AsyncStorage.multiRemove([
      KEYS.TOKEN,
      KEYS.BUYER_ID,
      KEYS.NAME,
      KEYS.PHONE,
      KEYS.SHOP_TYPE,
    ]);

    setState({
      token:           null,
      buyerId:         null,
      buyerName:       null,
      phone:           null,
      shopType:        null,
      isLoading:       false,
      isAuthenticated: false,
    });
  }, []);

  return { ...state, signIn, signOut };
}
