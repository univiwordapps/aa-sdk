import type { Address } from "@aa-sdk/core";
import { AlchemySignerStatus } from "@account-kit/signer";
import { hydrate as wagmi_hydrate } from "@wagmi/core";
import { reconnect } from "./actions/reconnect.js";
import {
  convertSignerStatusToState,
  createDefaultAccountState,
  defaultAccountState,
} from "./store/store.js";
import type { AccountState, StoreState, StoredState } from "./store/types.js";
import {
  type AlchemyAccountsConfig,
  type SupportedAccountTypes,
} from "./types.js";

export type HydrateResult = {
  onMount: () => Promise<void>;
};

/**
 * Will hydrate the client store with the provided initial state if one is provided.
 *
 * @example
 * ```ts
 * import { hydrate, cookieToInitialState } from "@account-kit/core";
 * import { config } from "./config";
 *
 * const initialState = cookieToInitialState(document.cookie);
 * const { onMount } = hydrate(config, initialState);
 * // call onMount once your component has mounted
 * ```
 *
 * @param {AlchemyAccountsConfig} config the config containing the client store
 * @param {StoredState} initialState optional param detailing the initial ClientState
 * @returns {{ onMount: () => Promise<void> }} an object containing an onMount function that can be called when your component first renders on the client
 */
export function hydrate(
  config: AlchemyAccountsConfig,
  initialState?: StoredState
): HydrateResult {
  const initialAlchemyState =
    initialState != null && "alchemy" in initialState
      ? initialState.alchemy
      : initialState;

  if (initialAlchemyState && !config.store.persist.hasHydrated()) {
    const { accountConfigs, signerStatus, ...rest } = initialAlchemyState;
    const shouldReconnectAccounts =
      signerStatus.isConnected || signerStatus.isAuthenticating;

    // If the persisted chainId is not in the config, we should fall back to the default chain.
    const configuredChains = Array.from(
      config.store.getInitialState().connections.keys()
    );
    const chain = configuredChains.includes(rest.chain.id)
      ? rest.chain
      : config.store.getInitialState().chain;

    config.store.setState({
      ...rest,
      chain,
      user: initialAlchemyState.user,
      accountConfigs,
      signerStatus: convertSignerStatusToState(
        AlchemySignerStatus.INITIALIZING,
        undefined
      ),
      accounts: hydrateAccountState(
        accountConfigs,
        shouldReconnectAccounts,
        config
      ),
    });
  } else if (!config.store.persist.hasHydrated()) {
    config.store.setState({
      ...config.store.getInitialState(),
      user: undefined,
    });
  }

  const initialWagmiState =
    initialState != null && "wagmi" in initialState
      ? initialState.wagmi
      : undefined;

  const { onMount: wagmi_onMount } = wagmi_hydrate(
    config._internal.wagmiConfig,
    {
      initialState: initialWagmiState,
      reconnectOnMount: (initialWagmiState?.connections?.size ?? 0) > 0,
    }
  );

  return {
    async onMount() {
      if (config._internal.ssr) {
        await config.store.persist.rehydrate();
      }

      await wagmi_onMount();

      await reconnect(config);
    },
  };
}

const reconnectingState = <T extends SupportedAccountTypes>(
  address: Address
): AccountState<T> => ({
  status: "RECONNECTING",
  account: {
    address,
  },
});

const hydrateAccountState = (
  accountConfigs: StoreState["accountConfigs"],
  shouldReconnectAccounts: boolean,
  config: AlchemyAccountsConfig
): StoreState["accounts"] => {
  const chains = Array.from(config.store.getState().connections.entries())
    .map(([_, cnx]) => cnx)
    .map((cnx) => cnx.chain);
  const initialState = createDefaultAccountState(chains);
  const activeChainId = config.store.getState().chain.id;

  return Object.entries(accountConfigs).reduce((acc, [chainKey, config]) => {
    const chainId = Number(chainKey);
    const isActiveChain = chainId === activeChainId;
    const shouldReconnect = shouldReconnectAccounts && isActiveChain;
    acc[chainId] = {
      LightAccount:
        shouldReconnect && config.LightAccount?.accountAddress
          ? reconnectingState(config.LightAccount.accountAddress)
          : defaultAccountState(),
      MultiOwnerModularAccount:
        shouldReconnect && config.MultiOwnerModularAccount?.accountAddress
          ? reconnectingState(config.MultiOwnerModularAccount.accountAddress)
          : defaultAccountState(),
      MultiOwnerLightAccount:
        shouldReconnect && config.MultiOwnerLightAccount?.accountAddress
          ? reconnectingState(config.MultiOwnerLightAccount.accountAddress)
          : defaultAccountState(),
      ModularAccountV2:
        shouldReconnect && config.ModularAccountV2?.accountAddress
          ? reconnectingState(config.ModularAccountV2.accountAddress)
          : defaultAccountState(),
    };

    return acc;
  }, initialState);
};
