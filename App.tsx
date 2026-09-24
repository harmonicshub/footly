/**
 * FOOTLY — MOBILE APP SHELL (React Native / Expo)
 * ----------------------------------------------
 * Structural only. Screens are stubs; what matters here is the shape:
 * auth gate, providers, navigation, and the two pieces of state that
 * every screen touches (session and bet slip).
 *
 * Constraint driving every decision below: the median Footly user is on
 * a ₦60,000 Android phone on patchy 4G. That rules out heavy state
 * libraries, chatty polling, and blocking on the network for anything
 * the user can already see.
 */

import React, { createContext, useContext, useEffect, useMemo, useReducer, useState, useCallback } from "react";
import { View, Text, ActivityIndicator, StyleSheet, StatusBar, Pressable } from "react-native";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";
import NetInfo from "@react-native-community/netinfo";

import { api, setAuthToken } from "./api";
import { RealtimeProvider } from "./realtime";

/* ================================================================== */
/* Theme                                                               */
/* ================================================================== */

export const C = {
  base: "#07100F", surface: "#0E1B19", raised: "#152826", line: "#1E3532",
  teal: "#12E0B8", tealDeep: "#0A8C74", amber: "#FFB020", red: "#FF5A5A",
  text: "#E6F2EF", muted: "#6E8A85",
};

const navTheme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    primary: C.teal, background: C.base, card: C.surface,
    text: C.text, border: C.line, notification: C.amber,
  },
};

/* ================================================================== */
/* Session                                                             */
/* ================================================================== */

type Session = {
  userId: string;
  displayName: string;
  kycTier: "tier_0" | "tier_1" | "tier_2" | "tier_3";
  balanceKobo: number;
  bonusKobo: number;
};

type SessionState =
  | { status: "loading" }
  | { status: "anon" }
  | { status: "authed"; session: Session };

const SessionCtx = createContext<{
  state: SessionState;
  signIn: (phone: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshBalance: () => Promise<void>;
}>(null as never);

export const useSession = () => useContext(SessionCtx);

const TOKEN_KEY = "footly.token";

function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  /* Restore on cold start. SecureStore, not AsyncStorage — the token
     is a bearer credential to someone's money. */
  useEffect(() => {
    (async () => {
      try {
        const token = await SecureStore.getItemAsync(TOKEN_KEY);
        if (!token) return setState({ status: "anon" });
        setAuthToken(token);
        const me = await api.get<Session>("/me");
        setState({ status: "authed", session: me });
      } catch {
        await SecureStore.deleteItemAsync(TOKEN_KEY);
        setState({ status: "anon" });
      }
    })();
  }, []);

  const signIn = useCallback(async (phone: string, password: string) => {
    const res = await api.post<{ token: string; user: Session }>("/auth/login", { phone, password });
    await SecureStore.setItemAsync(TOKEN_KEY, res.token);
    setAuthToken(res.token);
    setState({ status: "authed", session: res.user });
  }, []);

  const signOut = useCallback(async () => {
    await api.post("/auth/logout", {}).catch(() => {});
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setAuthToken(null);
    setState({ status: "anon" });
  }, []);

  /* Balance is pushed over the socket. This is the fallback for when
     the socket is down — called on app foreground and after placement. */
  const refreshBalance = useCallback(async () => {
    setState((s) => {
      if (s.status !== "authed") return s;
      api.get<{ cashKobo: number; bonusKobo: number }>("/wallet/balance")
        .then((b) => setState((cur) =>
          cur.status === "authed"
            ? { ...cur, session: { ...cur.session, balanceKobo: b.cashKobo, bonusKobo: b.bonusKobo } }
            : cur
        ))
        .catch(() => {});
      return s;
    });
  }, []);

  const value = useMemo(() => ({ state, signIn, signOut, refreshBalance }),
    [state, signIn, signOut, refreshBalance]);

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

/* ================================================================== */
/* Bet slip                                                            */
/* ================================================================== */

export type SlipLeg = {
  marketId: string; outcomeId: string; eventId: string;
  match: string; market: string; label: string;
  price: number; version: number;
  /** Set when the price moves under the punter. Surfaced, never silent. */
  priceChanged?: { from: number; to: number };
  suspended?: boolean;
};

type SlipAction =
  | { type: "toggle"; leg: SlipLeg }
  | { type: "remove"; outcomeId: string }
  | { type: "clear" }
  | { type: "priceUpdate"; outcomeId: string; price: number; version: number }
  | { type: "suspend"; marketId: string; suspended: boolean }
  | { type: "load"; legs: SlipLeg[] };

function slipReducer(legs: SlipLeg[], a: SlipAction): SlipLeg[] {
  switch (a.type) {
    case "toggle": {
      if (legs.some((l) => l.outcomeId === a.leg.outcomeId)) {
        return legs.filter((l) => l.outcomeId !== a.leg.outcomeId);
      }
      // One selection per market — replace rather than stack.
      return [...legs.filter((l) => l.marketId !== a.leg.marketId), a.leg];
    }
    case "remove": return legs.filter((l) => l.outcomeId !== a.outcomeId);
    case "clear": return [];
    case "load": return a.legs;
    case "priceUpdate":
      return legs.map((l) =>
        l.outcomeId === a.outcomeId && l.price !== a.price
          ? { ...l, priceChanged: { from: l.price, to: a.price }, price: a.price, version: a.version }
          : l
      );
    case "suspend":
      return legs.map((l) => (l.marketId === a.marketId ? { ...l, suspended: a.suspended } : l));
    default: return legs;
  }
}

const SlipCtx = createContext<{
  legs: SlipLeg[];
  dispatch: React.Dispatch<SlipAction>;
  totalOdds: number;
  sameMatchLegs: number;
}>(null as never);

export const useSlip = () => useContext(SlipCtx);

function SlipProvider({ children }: { children: React.ReactNode }) {
  const [legs, dispatch] = useReducer(slipReducer, []);

  const totalOdds = useMemo(() => legs.reduce((a, l) => a * l.price, 1), [legs]);
  const sameMatchLegs = useMemo(() => {
    const c: Record<string, number> = {};
    legs.forEach((l) => (c[l.eventId] = (c[l.eventId] ?? 0) + 1));
    return Object.values(c).filter((n) => n > 1).length;
  }, [legs]);

  /* Survive an app kill mid-slip. Losing a 12-leg acca to a memory
     eviction is the kind of thing people uninstall over. */
  useEffect(() => {
    SecureStore.setItemAsync("footly.slip", JSON.stringify(legs)).catch(() => {});
  }, [legs]);

  useEffect(() => {
    SecureStore.getItemAsync("footly.slip")
      .then((raw) => { if (raw) dispatch({ type: "load", legs: JSON.parse(raw) }); })
      .catch(() => {});
  }, []);

  return (
    <SlipCtx.Provider value={{ legs, dispatch, totalOdds, sameMatchLegs }}>
      {children}
    </SlipCtx.Provider>
  );
}

/* ================================================================== */
/* Connectivity banner                                                 */
/* ================================================================== */

function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => NetInfo.addEventListener((s) => setOffline(!s.isConnected)), []);
  if (!offline) return null;
  return (
    <View style={s.offline}>
      <Text style={s.offlineText}>No connection. Odds shown may be out of date.</Text>
    </View>
  );
}

/* ================================================================== */
/* Navigation                                                          */
/* ================================================================== */

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// Stubs — replace with the real screens.
const Screen = (name: string) => () => (
  <View style={s.stub}><Text style={s.stubText}>{name}</Text></View>
);

const HomeScreen = Screen("Home");
const SportsScreen = Screen("Sports");
const MyBetsScreen = Screen("My bets");
const WalletScreen = Screen("Wallet");
const AccountScreen = Screen("Account");
const EventScreen = Screen("Market board");
const BetSlipScreen = Screen("Bet slip");
const DepositScreen = Screen("Deposit");
const WithdrawScreen = Screen("Withdraw");
const KycScreen = Screen("Verify account");

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.teal,
        tabBarInactiveTintColor: C.muted,
        tabBarStyle: { backgroundColor: C.surface, borderTopColor: C.line },
        // Lazy tabs — do not fetch five screens' data on launch.
        lazy: true,
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Sports" component={SportsScreen} />
      <Tab.Screen name="My bets" component={MyBetsScreen} />
      <Tab.Screen name="Wallet" component={WalletScreen} />
      <Tab.Screen name="Account" component={AccountScreen} />
    </Tab.Navigator>
  );
}

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Welcome" component={Screen("Welcome")} />
      <Stack.Screen name="Login" component={Screen("Login")} />
      <Stack.Screen name="Register" component={Screen("Register")} />
      <Stack.Screen name="VerifyPhone" component={Screen("Verify phone")} />
    </Stack.Navigator>
  );
}

/**
 * Browsing is public. Odds, fixtures and booking codes render without
 * an account — the auth wall goes up at placement, not at the door.
 * A punter who cannot see your prices without signing up will just
 * open a competitor instead.
 */
function AppStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={Tabs} />
      <Stack.Screen name="Event" component={EventScreen} />
      <Stack.Screen name="BetSlip" component={BetSlipScreen}
        options={{ presentation: "modal", animation: "slide_from_bottom" }} />
      <Stack.Screen name="Deposit" component={DepositScreen} options={{ presentation: "modal" }} />
      <Stack.Screen name="Withdraw" component={WithdrawScreen} options={{ presentation: "modal" }} />
      <Stack.Screen name="Kyc" component={KycScreen} />
      <Stack.Screen name="Auth" component={AuthStack} options={{ presentation: "modal" }} />
    </Stack.Navigator>
  );
}

/* ================================================================== */
/* Root                                                                */
/* ================================================================== */

function Root() {
  const { state } = useSession();

  if (state.status === "loading") {
    return (
      <View style={s.splash}>
        <Text style={s.wordmark}>FOOT<Text style={{ color: C.teal }}>LY</Text></Text>
        <ActivityIndicator color={C.teal} style={{ marginTop: 18 }} />
      </View>
    );
  }

  return (
    <>
      <OfflineBanner />
      <AppStack />
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={C.base} />
      <SessionProvider>
        <RealtimeProvider>
          <SlipProvider>
            <NavigationContainer theme={navTheme}>
              <Root />
            </NavigationContainer>
          </SlipProvider>
        </RealtimeProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}

/* ================================================================== */

const s = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.base },
  wordmark: { color: C.text, fontSize: 34, fontWeight: "700", letterSpacing: -0.5 },
  stub: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.base },
  stubText: { color: C.muted, fontSize: 15 },
  offline: { backgroundColor: C.amber, paddingVertical: 6, paddingHorizontal: 14 },
  offlineText: { color: C.base, fontSize: 12.5, fontWeight: "600", textAlign: "center" },
});
