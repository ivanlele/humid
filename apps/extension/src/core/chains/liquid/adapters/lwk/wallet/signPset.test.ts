import { beforeEach, describe, expect, mock, test } from "bun:test";

let inputCount = 3;
let ownedIndexes = [2];
let signedIndexes: number[] = [];
let blinded = false;
let signedSource = "";
let preparationError: Error | null = null;
let signingError: Error | null = null;

class TestPset {
  constructor(private readonly source: string) {}
  inputs() {
    return Array.from({ length: inputCount }, () => ({}));
  }
  signatures() {
    const snapshot = [...signedIndexes];
    return Array.from({ length: inputCount }, (_, index) => ({
      hasSignature: () => (snapshot.includes(index) ? ["signature"] : []),
    }));
  }
  toString() {
    return this.source;
  }
}

mock.module("../loadLwkWasm", () => ({
  loadLwkWasm: async () => ({ Pset: TestPset }),
}));
mock.module("../sync-worker/createSyncWorkerClient", () => ({
  getSyncWorkerClient: () => ({}),
}));
const { signPset } = await import("./signPset");

const account = {
  implementation: {
    wollet: {
      blind: () => {
        if (preparationError) throw preparationError;
        blinded = true;
        return new TestPset("wallet-blinded");
      },
      psetDetails: () => {
        throw new Error("Output #2 is not blinded");
      },
    },
    signer: {
      sign: (pset: TestPset) => {
        if (signingError) throw signingError;
        signedSource = pset.toString();
        signedIndexes = [...ownedIndexes];
        return pset;
      },
    },
  },
} as never;

beforeEach(() => {
  inputCount = 3;
  ownedIndexes = [2];
  signedIndexes = [];
  blinded = false;
  signedSource = "";
  preparationError = null;
  signingError = null;
});

describe("mixed-input PSET signing", () => {
  test("preserves prepared covenant inputs and signs only the requested wallet input", async () => {
    const result = await signPset(account, {
      broadcast: false,
      pset: "finalized-covenants",
      signInputs: [{ address: "wallet-address", index: 2, sighashTypes: [1] }],
    });
    expect(blinded).toBe(false);
    expect(signedSource).toBe("finalized-covenants");
    expect(result.pset).toBe("finalized-covenants");
    expect(signedIndexes).toEqual([2]);
  });

  test("prepares wallet-only funding without rejecting an explicit owned output", async () => {
    inputCount = 2;
    ownedIndexes = [0, 1];
    await signPset(account, {
      broadcast: false,
      pset: "funding",
      signInputs: [
        { address: "wallet-address", index: 0, sighashTypes: [1] },
        { address: "wallet-address", index: 1, sighashTypes: [1] },
      ],
    });
    expect(blinded).toBe(true);
    expect(signedSource).toBe("wallet-blinded");
  });

  test("refuses a signature added to an unrequested input", async () => {
    ownedIndexes = [0, 2];
    await expect(
      signPset(account, {
        broadcast: false,
        pset: "prepared",
        signInputs: [
          { address: "wallet-address", index: 2, sighashTypes: [1] },
        ],
      }),
    ).rejects.toThrow("input the request did not list");
  });

  test("reports the preparation stage and underlying wallet error", async () => {
    inputCount = 1;
    preparationError = new Error("Missing wallet UTXO");
    await expect(
      signPset(account, {
        broadcast: false,
        pset: "funding",
        signInputs: [
          { address: "wallet-address", index: 0, sighashTypes: [1] },
        ],
      }),
    ).rejects.toThrow("Stage: prepare. Missing wallet UTXO");
  });

  test("reports a signing failure separately from preparation", async () => {
    signingError = new Error("Missing key origin");
    await expect(
      signPset(account, {
        broadcast: false,
        pset: "prepared",
        signInputs: [
          { address: "wallet-address", index: 2, sighashTypes: [1] },
        ],
      }),
    ).rejects.toThrow("Stage: sign. Missing key origin");
  });
});
