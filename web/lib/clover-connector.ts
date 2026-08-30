"use client";

/**
 * Thin wrapper around Clover's official `remote-pay-cloud` SDK (confirmed
 * genuinely official -- unlike the Ecommerce side, which had no real SDK at
 * all -- so this is used directly rather than hand-rolled, a deliberate
 * exception to this project's usual "no third-party dependency" default).
 *
 * This is what actually pays for an online order: the browser opens a
 * managed WebSocket connection to Clover's cloud relay, which forwards a
 * sale request to the kiosk's Flex device (running the "Cloud Pay Display"
 * app), the customer taps/inserts their card right there, and the result
 * comes back over the same connection. No card ever touches this site.
 *
 * There is no sandbox simulator for this (confirmed via Clover's own
 * community/docs) -- everything here is written and can be exercised up to
 * `initializeConnection()`, but the actual sale() round trip can only be
 * proven against real hardware (a purchased Dev Kit, or the real kiosk Flex
 * under an explicit, owner-supervised test -- see the migration plan's
 * Phase 7). Treat anything below the connect() call as unverified until
 * that happens.
 *
 * Verified live against the SDK's actual source (not just its docs):
 *   - WebSocketCloudCloverDeviceConfigurationBuilder(applicationId, deviceId,
 *     merchantId, accessToken) -- exact constructor param order.
 *   - Its cloverServer default is "https://www.clover.com/" already, which
 *     matches this session's hard-won finding that the production host is
 *     what actually works for this account, sandbox.dev.clover.com does not
 *     -- so no override is needed here.
 *   - CloverConnectorFactoryBuilder.createICloverConnectorFactory() with NO
 *     config returns the browser-compatible factory (the VERSION_12 config
 *     option is explicitly documented in the SDK's own source as NOT
 *     browser-dependent, i.e. for Node use, not this "use client" context).
 *   - remotepay.SaleRequest's setAmount/setExternalId are real methods
 *     (inherited from BaseTransactionRequest, confirmed in the installed
 *     package source).
 *   - remotepay.ICloverConnectorListener is a plain constructable object
 *     with no-op default methods -- override the ones needed.
 */

// Typed `any` via types/remote-pay-cloud.d.ts (the package's own shipped
// types are broken -- see that file's comment). Used against the runtime
// shape confirmed live against the installed package's actual source (see
// this file's header comment).
import cloverSdk from "remote-pay-cloud";
const {
  CloverConnectorFactoryBuilder,
  WebSocketCloudCloverDeviceConfigurationBuilder,
  remotepay,
} = cloverSdk;

export type SaleResult =
  | { success: true; paymentId: string; amountCents: number }
  | { success: false; reason: string };

// Neither onDeviceReady/onDeviceError nor onSaleResponse is guaranteed to
// ever fire -- an offline/unpaired/unreachable Flex just leaves the
// connect()/sale() Promise pending forever, which (found during review, no
// hardware needed to see it) left the checkout button stuck on "Connecting
// to the kiosk terminal..."/"Waiting on terminal..." with no error and no
// way for a customer or staff member to recover short of reloading the
// page. sale() gets the longer budget -- unlike connect(), a real card tap
// + PIN + processing round trip can legitimately take a while (the existing
// UI copy already says "this can take up to a minute").
const CONNECT_TIMEOUT_MS = 30_000;
const SALE_TIMEOUT_MS = 120_000;

export type CloverConnectorHandle = {
  connect: () => Promise<void>;
  sale: (amountCents: number, externalId: string) => Promise<SaleResult>;
  disconnect: () => void;
};

/**
 * Builds a connector for one checkout attempt. `accessToken` and `deviceId`
 * must come from the server (see web/lib/clover.ts's listDevices() and the
 * OAuth flow in app/api/webhooks/clover-oauth-capture/route.ts) -- passed in
 * as props to the client component, not baked into a NEXT_PUBLIC_* env var,
 * since an access token is a real credential, not a public identifier the
 * way a Square/Clover application id is.
 */
export function createCloverConnector(params: {
  merchantId: string;
  deviceId: string;
  accessToken: string;
  remoteApplicationId: string;
}): CloverConnectorHandle {
  const configBuilder = new WebSocketCloudCloverDeviceConfigurationBuilder(
    params.remoteApplicationId,
    params.deviceId,
    params.merchantId,
    params.accessToken
  );
  configBuilder.setFriendlyId("Perfumery at The Fashion District storefront checkout");
  const config = configBuilder.build();

  const factory = CloverConnectorFactoryBuilder.createICloverConnectorFactory();
  const connector = factory.createICloverConnector(config);

  let readyResolve: (() => void) | null = null;
  let readyReject: ((err: Error) => void) | null = null;
  let saleResolve: ((result: SaleResult) => void) | null = null;

  const listener = Object.assign(new remotepay.ICloverConnectorListener(), {
    onDeviceReady: () => {
      readyResolve?.();
      readyResolve = readyReject = null;
    },
    onDeviceError: (event: { message?: string }) => {
      readyReject?.(new Error(event?.message ?? "Clover device error"));
      readyResolve = readyReject = null;
    },
    onSaleResponse: (response: {
      getSuccess: () => boolean;
      getReason?: () => string;
      getPayment?: () => { getId: () => string; getAmount: () => number } | null;
    }) => {
      if (!saleResolve) return;
      if (response.getSuccess()) {
        const payment = response.getPayment?.();
        saleResolve({
          success: true,
          paymentId: payment?.getId() ?? "",
          amountCents: payment?.getAmount() ?? 0,
        });
      } else {
        saleResolve({ success: false, reason: response.getReason?.() ?? "Payment declined" });
      }
      saleResolve = null;
    },
  });
  connector.addCloverConnectorListener(listener);

  return {
    connect() {
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          readyResolve = readyReject = null;
          reject(
            new Error(
              "Couldn't reach the terminal at the kiosk -- check that it's powered on and connected."
            )
          );
        }, CONNECT_TIMEOUT_MS);
        readyResolve = () => {
          clearTimeout(timer);
          resolve();
        };
        readyReject = (err) => {
          clearTimeout(timer);
          reject(err);
        };
        connector.initializeConnection();
      });
    },

    sale(amountCents, externalId) {
      return new Promise<SaleResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          saleResolve = null;
          reject(
            new Error(
              "The terminal didn't respond in time. Please try again or ask a staff member for help."
            )
          );
        }, SALE_TIMEOUT_MS);
        saleResolve = (result) => {
          clearTimeout(timer);
          resolve(result);
        };
        const saleRequest = new remotepay.SaleRequest();
        saleRequest.setExternalId(externalId);
        saleRequest.setAmount(amountCents);
        connector.sale(saleRequest);
      });
    },

    disconnect() {
      connector.dispose();
    },
  };
}
