import {
  WALLET_RPC_ERROR_REASONS,
  WalletRpcResourceUnavailableError,
} from "@/core/wallet-rpc/errors";

import type {
  LiquidWalletAccount,
  LiquidWalletBackend,
} from "../../../application/backends/LiquidWalletBackend";
import { loadLwkWasm } from "../loadLwkWasm";
import { getSyncWorkerClient } from "../sync-worker/createSyncWorkerClient";
import { getLwkImplementation } from "./getLwkImplementation";

export async function signPset(
  account: LiquidWalletAccount,
  params: Parameters<LiquidWalletBackend["signPset"]>[1],
) {
  const implementation = getLwkImplementation(account);
  let stage = "parse";

  try {
    const lwk = await loadLwkWasm();
    const pset = new lwk.Pset(params.pset);
    const inputCount = pset.inputs().length;

    for (const input of params.signInputs) {
      if (input.index >= inputCount) {
        throw new WalletRpcResourceUnavailableError(
          "Requested PSET input index is out of range.",
          {
            inputCount,
            requestedIndex: input.index,
          },
          WALLET_RPC_ERROR_REASONS.INVALID_PSET_REQUEST,
        );
      }
    }

    const requestedIndexes = new Set(
      params.signInputs.map((requested) => requested.index),
    );
    const hasUnrequestedInputs = pset
      .inputs()
      .some((_, index) => !requestedIndexes.has(index));
    stage = "prepare";
    const preparedPset = hasUnrequestedInputs
      ? pset
      : implementation.wollet.blind(pset);
    stage = "inspect prepared inputs";
    const signaturesBefore = countSignaturesPerInput(preparedPset);

    stage = "sign";
    let signedPset = implementation.signer.sign(preparedPset);

    stage = "inspect signed inputs";
    const overSignedIndex = countSignaturesPerInput(signedPset).findIndex(
      (count, index) =>
        count > (signaturesBefore[index] ?? 0) && !requestedIndexes.has(index),
    );

    if (overSignedIndex !== -1) {
      throw new WalletRpcResourceUnavailableError(
        "Refusing to sign a Liquid PSET input the request did not list.",
        {
          overSignedInputIndex: overSignedIndex,
          requestedInputIndexes: [...requestedIndexes],
        },
        WALLET_RPC_ERROR_REASONS.INVALID_PSET_REQUEST,
      );
    }

    let txid: string | undefined;

    if (params.broadcast) {
      stage = "finalize";
      signedPset = implementation.wollet.finalize(signedPset);
      stage = "broadcast";
      const broadcast = await getSyncWorkerClient().broadcast({
        chain: account.chain,
        psetBase64: signedPset.toString(),
      });
      txid = broadcast.txid;
    }

    return {
      pset: signedPset.toString(),
      txid,
    };
  } catch (error) {
    if (error instanceof WalletRpcResourceUnavailableError) {
      throw error;
    }

    console.error("[liquid] signPset failed", error);

    const detail =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unknown wallet error";
    const failure = new WalletRpcResourceUnavailableError(
      `${
        params.broadcast
          ? "Could not sign and broadcast the Liquid PSET."
          : "Could not sign the Liquid PSET."
      } Stage: ${stage}. ${detail}`,
      { stage },
      params.broadcast
        ? WALLET_RPC_ERROR_REASONS.WALLET_PSET_BROADCAST_FAILED
        : WALLET_RPC_ERROR_REASONS.WALLET_PSET_SIGNING_FAILED,
    );
    failure.cause = error;
    throw failure;
  }
}

function countSignaturesPerInput(details: {
  signatures: () => Array<{ hasSignature: () => unknown }>;
}): number[] {
  return details.signatures().map((inputSignatures) => {
    const signatures = inputSignatures.hasSignature();

    return Array.isArray(signatures) ? signatures.length : 0;
  });
}
