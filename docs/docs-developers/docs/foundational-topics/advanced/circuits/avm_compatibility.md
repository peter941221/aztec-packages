---
title: AVM Cryptographic Compatibility
sidebar_position: 3
description: Which Noir cryptographic primitives work in public (AVM) functions vs private, and workarounds for unsupported operations.
tags: [protocol, circuits]
---

Private and public functions in Aztec use different execution models. Private functions compile to ACIR circuits and have access to the full Noir standard library. Public functions compile to AVM bytecode via the transpiler, which supports only a specific set of cryptographic operations.

## Compatibility Table

| Noir Primitive | Private (ACIR) | Public (AVM) | Notes |
|---|---|---|---|
| Poseidon2 Permutation | Supported | Supported | `POSEIDON2` opcode |
| SHA-256 Compression | Supported | Supported | `SHA256COMPRESSION` opcode |
| Keccak f1600 | Supported | Supported | `KECCAKF1600` opcode |
| Embedded Curve Add | Supported | Supported | `ECADD` opcode (Grumpkin curve) |
| Multi-Scalar Multiplication | Supported | Supported | Decomposes to `ECADD` operations |
| ToRadix | Supported | Supported | `TORADIXBE` opcode |
| ECDSA secp256k1 | Supported | **Not supported** | Transpiler panics |
| ECDSA secp256r1 | Supported | **Not supported** | Transpiler panics |
| AES-128 Encrypt | Supported | **Not supported** | Transpiler panics |
| Blake2s | Supported | **Not supported** | Transpiler panics |
| Blake3 | Supported | **Not supported** | Transpiler panics |

## Why the Difference

Private functions are compiled to ACIR (Abstract Circuit Intermediate Representation), which supports the full set of Noir standard library blackbox functions. These are evaluated as part of the zk-SNARK proof generation on the user's device.

Public functions are compiled to AVM bytecode via the transpiler. The AVM has a fixed instruction set with specific opcodes for each supported cryptographic operation. Operations that don't have a corresponding AVM opcode cannot be transpiled.

## What Error Will I See?

If you use an unsupported blackbox function in a `#[external("public")]` function, the transpiler will panic at compile time with:

```
Transpiler doesn't know how to process <BlackBoxOp>
```

For example, using ECDSA verification in a public function produces:

```
Transpiler doesn't know how to process EcdsaSecp256k1
```

## Signature Verification in Public: Workarounds

Since ECDSA signature verification is not available in public functions, use the **Authentication Registry** pattern:

1. Verify signatures in a **private** function (where all Noir primitives are available)
2. Store approval hashes in the **Auth Registry** (a shared public contract)
3. Consume the approvals in **public** functions

This is exactly how public authwits work. See [Authentication Witnesses](../authwit.md) for the full pattern.

:::tip Schnorr signatures
The [`noir-lang/schnorr`](https://github.com/noir-lang/schnorr) library implements Schnorr verification in pure Noir using embedded curve operations (ECADD, MSM), which are supported in the AVM. This means Schnorr verification may work in public functions. However, the standard Aztec account contracts only use Schnorr in private functions, and the recommended pattern remains verifying signatures in private via the Auth Registry.
:::

## ISA Reference

For the complete list of AVM opcodes, see the [AVM ISA Quick Reference](https://github.com/AztecProtocol/aztec-packages/blob/next/yarn-project/simulator/docs/avm/avm-isa-quick-reference.md).

## Related Pages

- [Public Execution (AVM)](./public_execution.md) – How the AVM executes public functions
- [Authentication Witnesses](../authwit.md) – The Auth Registry pattern for public authorization
- [Call Types](../../../foundational-topics/call_types.md) – How private and public functions interact
- [Private Kernel](./private_kernel.md) – How private functions are processed
