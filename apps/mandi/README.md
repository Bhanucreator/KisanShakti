# Mandi — the buyer app · ಮಂಡಿ

Kannada + English React Native app for agricultural buyers, traders,
wholesalers, and retail shopkeepers to source crops directly from
Karnataka farmers on KisanShakti.

Built on Expo SDK 54 / React Native. Same backend as the farmer app
([Upaj](../upaj/README.md)) — see [../../backend/README.md](../../backend/README.md).

---

## Screens

| Tab | What it does |
|---|---|
| **Discover** | Nearby crop listings within the buyer's sourcing radius (default 25 km), category filter chips, search bar (300 ms debounced), pull-to-refresh, notification bell |
| **Requests** | Pending offers the buyer has made; the farmer's status (PENDING / ACCEPTED / REJECTED) |
| **Orders** | Accepted offers (in-delivery + completed). Delivery OTP entry lives here; ratings for completed farmers |
| **Profile** | Shop identity, trade stats (total spent, orders completed, crops bought), sourcing radius, Terms, Privacy, Sign out, Delete-my-account |

Plus:
- Phone OTP login → JWT session (dev-stub OTP auto-fills)
- Onboarding: shop name, shop type (Retail / Wholesale / Processing), sourcing radius
- Full-bleed crop-detail hero with photo carousel (`crop-detail.tsx`)

---

## Run in dev

```bash
npm install
export EXPO_PUBLIC_API_URL=http://10.0.2.2:8000    # Android emulator
npx expo start --clear
```

For real phones on the same WiFi or mobile data, see
[../upaj/README.md#run-in-dev](../upaj/README.md#run-in-dev) — same story.

---

## Project layout

```
src/
├── app/
│   ├── _layout.tsx             # Auth gate + splash
│   ├── login.tsx               # OTP + shop profile
│   ├── (tabs)/
│   │   ├── index.tsx           # Discover
│   │   ├── requests.tsx        # Pending offers
│   │   ├── orders.tsx          # Accepted + completed
│   │   └── profile.tsx         # Shop settings + Delete account
│   ├── crop-detail.tsx         # Photo carousel + farmer info + make-offer sheet
│   ├── chat.tsx                # (placeholder for future in-app messaging)
│   └── legal/
│       ├── terms.tsx           # Terms of Service (buyer-tuned)
│       └── privacy.tsx         # Privacy Policy (buyer-tuned)
├── components/                 # Small shared UI bits
├── constants/theme.ts          # Colors + spacing
├── hooks/use-auth.ts           # AsyncStorage-backed auth state
└── lib/api.ts                  # All backend calls
```

---

## Discover ranking

Listings are ranked server-side by a combined score:
- **60 % distance** — nearer wins, capped at the buyer's `sourcing_radius_km`
- **40 % price fairness** — closer to the crop's AGMARKNET benchmark wins

Buyers can override via category chips (Tomato / Onion / Ragi / …) or
free-text search. Both apply on top of the radius filter.

---

## Offer flow

1. Buyer taps a listing card → `/crop-detail`
2. Fills out **Make Offer** sheet: price/kg + quantity + optional note
3. Backend validates the price is within ±5 % of AGMARKNET benchmark
4. Offer submitted → PENDING
5. Farmer accepts on Upaj → sibling offers on the same listing are
   auto-rejected → buyer sees ACCEPTED in the Requests tab
6. Farmer generates a 4-digit delivery OTP → shares with buyer at
   pickup
7. Buyer enters the OTP in the Orders tab → offer moves to COMPLETED
   → sale posts to the farmer's ledger automatically → rating prompt
   appears on the buyer's side

---

## Rate limits (server-enforced)

Buyers are capped at **20 offers per 5 minutes** to prevent flooding
farmer listings with lowball noise. 21st offer returns 429 with a
wait-time message.

---

## Build APK

Same EAS flow as Upaj. See [../upaj/README.md#build-apk-for-internal-testing](../upaj/README.md#build-apk-for-internal-testing).

---

## Deleting an account (Play Store policy)

Profile → **Delete my account** → double-confirm → cascade removes:
- Buyer profile row
- All offers the buyer made
- All ratings the buyer gave
- Notification history

Irreversible. Backend endpoint: `DELETE /api/v1/buyers/me`.
